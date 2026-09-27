import {
  type HealthCheckRecord,
  type IncidentEvidence,
  type IncidentKind,
  type VersionChange,
  percentile,
} from '@mcp-hub/core';

export interface DetectedIncident {
  kind: IncidentKind;
  title: string;
  evidence: IncidentEvidence[];
}

export interface DetectionThresholds {
  /** Consecutive failing checks before an incident opens. */
  consecutiveFailures: number;
  /** Multiple of the baseline p95 that counts as a latency spike. */
  latencyMultiplier: number;
  /** Minimum baseline sample size before latency is judged at all. */
  minimumBaselineSamples: number;
  /** Fraction of recent checks that timed out. */
  timeoutRate: number;
}

export const DEFAULT_THRESHOLDS: DetectionThresholds = {
  consecutiveFailures: 3,
  latencyMultiplier: 3,
  minimumBaselineSamples: 10,
  timeoutRate: 0.3,
};

/**
 * Incident detection over recorded health checks.
 *
 * Every incident carries the measurements that produced it and nothing else.
 * MCP Hub deliberately does not infer a root cause: "tool discovery failures
 * increased" is a fact, "the upstream API is down" would be a guess, and a
 * wrong guess in an incident timeline is worse than no guess.
 *
 * `checks` must be ordered newest first.
 */
export function detectIncidents(
  checks: readonly HealthCheckRecord[],
  thresholds: DetectionThresholds = DEFAULT_THRESHOLDS,
): DetectedIncident[] {
  if (checks.length === 0) return [];
  const incidents: DetectedIncident[] = [];
  const newest = checks[0];
  if (!newest) return [];

  // --- repeated failures --------------------------------------------------
  let consecutive = 0;
  for (const check of checks) {
    if (check.status === 'failing') consecutive += 1;
    else break;
  }
  if (consecutive >= thresholds.consecutiveFailures) {
    const lastError = checks.find((c) => c.errorMessage)?.errorMessage ?? null;
    incidents.push({
      kind: 'repeated_failures',
      title: `${consecutive} consecutive failed health checks`,
      evidence: [
        {
          label: 'Consecutive failures',
          value: String(consecutive),
          source: 'health_checks',
          observedAt: newest.checkedAt,
        },
        ...(lastError
          ? [
              {
                label: 'Most recent error',
                value: lastError.slice(0, 200),
                source: 'health_checks' as const,
                observedAt: newest.checkedAt,
              },
            ]
          : []),
      ],
    });
  }

  // --- timeout spike ------------------------------------------------------
  const recent = checks.slice(0, 10);
  const timeouts = recent.filter((c) => c.timedOut).length;
  if (recent.length >= 5 && timeouts / recent.length >= thresholds.timeoutRate) {
    incidents.push({
      kind: 'timeout_spike',
      title: `${timeouts} of the last ${recent.length} checks timed out`,
      evidence: [
        {
          label: 'Timeouts in the last 10 checks',
          value: `${timeouts}/${recent.length}`,
          source: 'health_checks',
          observedAt: newest.checkedAt,
        },
      ],
    });
  }

  // --- latency spike ------------------------------------------------------
  const latencies = checks
    .map((c) => c.latencyMs)
    .filter((value): value is number => typeof value === 'number');
  if (latencies.length >= thresholds.minimumBaselineSamples + 3) {
    const recentLatencies = latencies.slice(0, 3);
    const baseline = latencies.slice(3);
    const recentAvg = recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length;
    const baselineP95 = percentile(baseline, 95);
    if (baselineP95 && baselineP95 > 0 && recentAvg > baselineP95 * thresholds.latencyMultiplier) {
      incidents.push({
        kind: 'latency_spike',
        title: `Latency rose to ${Math.round(recentAvg)}ms`,
        evidence: [
          {
            label: 'Recent average latency',
            value: `${Math.round(recentAvg)}ms`,
            source: 'health_checks',
            observedAt: newest.checkedAt,
          },
          {
            label: 'Baseline p95 latency',
            value: `${Math.round(baselineP95)}ms`,
            source: 'health_checks',
            observedAt: checks[checks.length - 1]?.checkedAt ?? newest.checkedAt,
          },
          {
            label: 'Baseline sample size',
            value: String(baseline.length),
            source: 'health_checks',
            observedAt: newest.checkedAt,
          },
        ],
      });
    }
  }

  // --- capability loss ----------------------------------------------------
  const previousWithTools = checks.slice(1).find((c) => typeof c.toolCount === 'number');
  if (
    typeof newest.toolCount === 'number' &&
    previousWithTools?.toolCount != null &&
    newest.toolCount < previousWithTools.toolCount
  ) {
    incidents.push({
      kind: 'tool_removed',
      title: `Tool count dropped from ${previousWithTools.toolCount} to ${newest.toolCount}`,
      evidence: [
        {
          label: 'Tools discovered now',
          value: String(newest.toolCount),
          source: 'health_checks',
          observedAt: newest.checkedAt,
        },
        {
          label: 'Tools discovered previously',
          value: String(previousWithTools.toolCount),
          source: 'health_checks',
          observedAt: previousWithTools.checkedAt,
        },
      ],
    });
  }

  return incidents;
}

/**
 * Incident kinds that the latest evidence no longer supports.
 *
 * An incident is closed when re-running detection over the current window
 * stops producing it — the same rule that opened it, applied in reverse — so
 * an incident can never linger after the condition has cleared.
 */
export function resolvableKinds(
  checks: readonly HealthCheckRecord[],
  thresholds: DetectionThresholds = DEFAULT_THRESHOLDS,
): IncidentKind[] {
  const detectable: IncidentKind[] = [
    'repeated_failures',
    'timeout_spike',
    'latency_spike',
    'tool_removed',
  ];
  if (checks.length === 0) return [];
  const stillOpen = new Set(detectIncidents(checks, thresholds).map((incident) => incident.kind));
  return detectable.filter((kind) => !stillOpen.has(kind));
}

/** Turns a breaking version change into an incident an operator should see. */
export function incidentFromVersionChanges(
  changes: readonly VersionChange[],
  observedAt: Date,
): DetectedIncident | null {
  const breaking = changes.filter((change) => change.breaking);
  if (breaking.length === 0) return null;
  return {
    kind: breaking.some((c) => c.kind === 'tool_removed') ? 'tool_removed' : 'schema_change',
    title: `${breaking.length} breaking capability change${breaking.length === 1 ? '' : 's'} detected`,
    evidence: breaking.slice(0, 6).map((change) => ({
      label: change.subject,
      value: change.detail,
      source: 'versions' as const,
      observedAt,
    })),
  };
}

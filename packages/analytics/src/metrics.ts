import {
  type HealthStatus,
  type Id,
  type OverviewMetrics,
  type SeriesSet,
  type TimeWindow,
  type ToolUsageRow,
} from '@mcp-hub/core';
import type {
  AnalyticsRepository,
  GovernanceRepository,
  RegistryRepository,
} from '@mcp-hub/database';
import { densify } from './window.js';

export interface DashboardData {
  metrics: OverviewMetrics;
  series: {
    requests: SeriesSet;
    health: SeriesSet;
  };
  topTools: ToolUsageRow[];
  failuresByServer: Array<{ serverId: Id<'server'>; serverSlug: string; failures: number; total: number }>;
  /** True when the organization has no events at all, so the UI shows an empty state. */
  isEmpty: boolean;
}

/**
 * Assembles the overview dashboard.
 *
 * Every number here is an aggregate over rows the product wrote. When an
 * organization has produced no events, the result is explicitly empty —
 * nothing is interpolated, extrapolated or invented to make a chart look busy.
 */
export async function buildDashboard(
  organizationId: Id<'organization'>,
  window: TimeWindow,
  repositories: {
    registry: RegistryRepository;
    governance: GovernanceRepository;
    analytics: AnalyticsRepository;
  },
): Promise<DashboardData> {
  const [health, toolCount, toolsByRisk, invocations, openIncidents, findings, requestSeries, healthSeries, topTools, failures, validationRuns] =
    await Promise.all([
      repositories.registry.countServersByHealth(organizationId),
      repositories.registry.countTools(organizationId),
      repositories.registry.countToolsByRisk(organizationId),
      repositories.analytics.invocationTotals(organizationId, window),
      repositories.governance.countOpenIncidents(organizationId),
      repositories.governance.countSecurityFindings(organizationId),
      repositories.analytics.invocationSeries(organizationId, window),
      repositories.analytics.healthSeries(organizationId, window),
      repositories.analytics.topTools(organizationId, window, 8),
      repositories.analytics.failuresByServer(organizationId, window, 8),
      repositories.governance.listValidationRuns(organizationId, null, 50),
    ]);

  const totalServers = (Object.values(health) as number[]).reduce((a, b) => a + b, 0);
  const errorRate =
    invocations.total === 0
      ? 0
      : Math.round(((invocations.failed + invocations.denied) / invocations.total) * 10000) / 100;

  const metrics: OverviewMetrics = {
    servers: {
      total: totalServers,
      healthy: health.healthy,
      degraded: health.degraded,
      failing: health.failing,
      unknown: health.unknown,
    },
    tools: { total: toolCount, bySensitivity: toolsByRisk },
    invocations: {
      total: invocations.total,
      succeeded: invocations.succeeded,
      failed: invocations.failed,
      denied: invocations.denied,
      errorRate,
      p50LatencyMs: invocations.p50LatencyMs,
      p95LatencyMs: invocations.p95LatencyMs,
    },
    incidents: { open: openIncidents, resolvedInWindow: 0 },
    security: { openFindings: findings.total, criticalFindings: findings.errors },
    validation: {
      runs: validationRuns.length,
      failing: validationRuns.filter((run) => run.outcome === 'error').length,
    },
  };

  return {
    metrics,
    series: {
      requests: densifySeries(requestSeries, window),
      health: densifySeries(healthSeries, window),
    },
    topTools,
    failuresByServer: failures,
    isEmpty: totalServers === 0 && invocations.total === 0,
  };
}

function densifySeries(series: SeriesSet, window: TimeWindow): SeriesSet {
  const out: SeriesSet = {};
  for (const [name, points] of Object.entries(series)) out[name] = densify(points, window);
  return out;
}

/** Rolls a server's recent checks into the status shown on cards and lists. */
export function deriveHealthStatus(
  recent: ReadonlyArray<{ status: HealthStatus }>,
): HealthStatus {
  if (recent.length === 0) return 'unknown';
  const [latest] = recent;
  if (!latest) return 'unknown';
  if (latest.status === 'healthy') {
    const lastThree = recent.slice(0, 3);
    const anyFailure = lastThree.some((check) => check.status !== 'healthy');
    return anyFailure ? 'degraded' : 'healthy';
  }
  return latest.status;
}

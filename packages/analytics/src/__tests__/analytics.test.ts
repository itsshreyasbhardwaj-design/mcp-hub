import { describe, expect, it } from 'vitest';
import type { HealthCheckRecord, Id } from '@mcp-hub/core';
import { bucketSecondsFor, densify, resolveWindow } from '../window.js';
import {
  DEFAULT_THRESHOLDS,
  detectIncidents,
  incidentFromVersionChanges,
  resolvableKinds,
} from '../incidents.js';
import { deriveHealthStatus } from '../metrics.js';

const NOW = new Date('2026-09-28T12:00:00.000Z');

function check(overrides: Partial<HealthCheckRecord> = {}): HealthCheckRecord {
  return {
    id: `hcheck_${Math.random().toString(36).slice(2)}` as Id<'healthCheck'>,
    organizationId: 'org_1' as Id<'organization'>,
    serverId: 'srv_1' as Id<'server'>,
    versionId: null,
    status: 'healthy',
    latencyMs: 200,
    toolCount: 5,
    initialized: true,
    timedOut: false,
    errorCode: null,
    errorMessage: null,
    checkedAt: NOW,
    ...overrides,
  };
}

/** Newest first, as the detector expects. */
function series(count: number, overrides: Partial<HealthCheckRecord> = {}): HealthCheckRecord[] {
  return Array.from({ length: count }, (_, index) =>
    check({ checkedAt: new Date(NOW.getTime() - index * 60_000), ...overrides }),
  );
}

describe('time windows', () => {
  it('resolves the named ranges', () => {
    for (const range of ['24h', '7d', '30d', '90d'] as const) {
      const window = resolveWindow({ range, now: NOW });
      expect(window.to).toEqual(NOW);
      expect(window.from.getTime()).toBeLessThan(NOW.getTime());
      expect(window.bucketSeconds).toBeGreaterThan(0);
    }
  });

  it('keeps every series to a readable number of points', () => {
    for (const range of ['24h', '7d', '30d', '90d'] as const) {
      const window = resolveWindow({ range, now: NOW });
      const points = (window.to.getTime() - window.from.getTime()) / (window.bucketSeconds * 1000);
      expect(points, range).toBeLessThanOrEqual(300);
      expect(points, range).toBeGreaterThan(10);
    }
  });

  it('widens the bucket as the span grows', () => {
    expect(bucketSecondsFor(60 * 60 * 1000)).toBeLessThan(
      bucketSecondsFor(7 * 24 * 60 * 60 * 1000),
    );
  });

  it('accepts a custom range', () => {
    const window = resolveWindow({
      from: '2026-09-01T00:00:00Z',
      to: '2026-09-08T00:00:00Z',
      now: NOW,
    });
    expect(window.range).toBe('custom');
  });

  it('rejects nonsense ranges instead of guessing', () => {
    expect(() => resolveWindow({ range: 'all-time', now: NOW })).toThrow();
    expect(() => resolveWindow({ range: 'custom', now: NOW })).toThrow();
    expect(() =>
      resolveWindow({ from: '2026-09-08T00:00:00Z', to: '2026-09-01T00:00:00Z' }),
    ).toThrow();
    expect(() => resolveWindow({ from: 'not-a-date' })).toThrow();
    expect(() =>
      resolveWindow({ from: '2020-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }),
    ).toThrow(/366 days/);
  });

  it('fills gaps with explicit zeros rather than skipping them', () => {
    const window = { from: new Date(NOW.getTime() - 3600_000), to: NOW, bucketSeconds: 600 };
    const dense = densify(
      [{ bucket: new Date(NOW.getTime() - 1200_000).toISOString(), value: 7 }],
      window,
    );
    expect(dense.length).toBeGreaterThan(5);
    expect(dense.filter((point) => point.value === 0).length).toBe(dense.length - 1);
    expect(dense.some((point) => point.value === 7)).toBe(true);
  });
});

describe('incident detection', () => {
  it('opens nothing when everything is healthy', () => {
    expect(detectIncidents(series(20))).toEqual([]);
  });

  it('opens on consecutive failures and carries the evidence', () => {
    const checks = [
      ...series(3, { status: 'failing', errorMessage: 'connection refused' }),
      ...series(10),
    ];
    const incidents = detectIncidents(checks);
    const failure = incidents.find((incident) => incident.kind === 'repeated_failures');
    expect(failure).toBeDefined();
    expect(failure?.evidence.some((item) => item.value === '3')).toBe(true);
    expect(failure?.evidence.every((item) => item.source && item.observedAt)).toBe(true);
  });

  it('does not open below the threshold', () => {
    const checks = [...series(2, { status: 'failing' }), ...series(10)];
    expect(detectIncidents(checks).some((i) => i.kind === 'repeated_failures')).toBe(false);
  });

  it('opens on a timeout spike', () => {
    const checks = [...series(5, { timedOut: true, status: 'failing' }), ...series(5)];
    expect(detectIncidents(checks).some((i) => i.kind === 'timeout_spike')).toBe(true);
  });

  it('opens on a latency spike against a stable baseline', () => {
    const checks = [...series(3, { latencyMs: 4000 }), ...series(20, { latencyMs: 200 })];
    const spike = detectIncidents(checks).find((i) => i.kind === 'latency_spike');
    expect(spike).toBeDefined();
    expect(spike?.evidence.some((item) => item.label === 'Baseline p95 latency')).toBe(true);
  });

  it('will not call a latency spike without enough baseline', () => {
    const checks = [...series(3, { latencyMs: 4000 }), ...series(4, { latencyMs: 200 })];
    expect(detectIncidents(checks).some((i) => i.kind === 'latency_spike')).toBe(false);
  });

  it('notices tools disappearing', () => {
    const checks = [
      check({ toolCount: 3 }),
      check({ toolCount: 8 }),
      ...series(5, { toolCount: 8 }),
    ];
    const removal = detectIncidents(checks).find((i) => i.kind === 'tool_removed');
    expect(removal?.title).toMatch(/8 to 3/);
  });

  it('never states a cause it did not measure', () => {
    const checks = [
      ...series(4, { status: 'failing', errorMessage: 'ECONNREFUSED' }),
      ...series(10),
    ];
    for (const incident of detectIncidents(checks)) {
      expect(incident.title).not.toMatch(/because|caused by|due to|probably|likely/i);
      for (const item of incident.evidence) {
        expect(['health_checks', 'invocations', 'versions', 'validation']).toContain(item.source);
      }
    }
  });

  it('honours custom thresholds', () => {
    const checks = [...series(2, { status: 'failing' }), ...series(10)];
    const incidents = detectIncidents(checks, { ...DEFAULT_THRESHOLDS, consecutiveFailures: 2 });
    expect(incidents.some((i) => i.kind === 'repeated_failures')).toBe(true);
  });

  it('closes an incident once the condition clears', () => {
    const failing = [...series(4, { status: 'failing' }), ...series(10)];
    expect(resolvableKinds(failing)).not.toContain('repeated_failures');

    const recovered = series(12);
    expect(resolvableKinds(recovered)).toContain('repeated_failures');
    expect(resolvableKinds(recovered)).toContain('timeout_spike');
  });

  it('resolves nothing when there is no evidence either way', () => {
    expect(resolvableKinds([])).toEqual([]);
  });

  it('raises an incident from breaking capability changes', () => {
    const incident = incidentFromVersionChanges(
      [
        {
          kind: 'tool_removed',
          path: 'tools.x',
          subject: 'x',
          before: 'x',
          after: null,
          breaking: true,
          rule: 'tool.removed',
          detail: 'Tool "x" no longer exists.',
        },
      ],
      NOW,
    );
    expect(incident?.kind).toBe('tool_removed');
    expect(incident?.evidence[0]?.source).toBe('versions');
  });

  it('raises nothing when no change was breaking', () => {
    expect(
      incidentFromVersionChanges(
        [
          {
            kind: 'tool_added',
            path: 'tools.y',
            subject: 'y',
            before: null,
            after: 'y',
            breaking: false,
            rule: 'tool.added',
            detail: 'added',
          },
        ],
        NOW,
      ),
    ).toBeNull();
  });
});

describe('rolled-up health status', () => {
  it('is unknown with no checks', () => {
    expect(deriveHealthStatus([])).toBe('unknown');
  });

  it('is healthy only when the recent run is clean', () => {
    expect(
      deriveHealthStatus([{ status: 'healthy' }, { status: 'healthy' }, { status: 'healthy' }]),
    ).toBe('healthy');
  });

  it('is degraded when a recent check failed even though the latest passed', () => {
    expect(
      deriveHealthStatus([{ status: 'healthy' }, { status: 'failing' }, { status: 'healthy' }]),
    ).toBe('degraded');
  });

  it('reports the latest failure directly', () => {
    expect(deriveHealthStatus([{ status: 'failing' }, { status: 'healthy' }])).toBe('failing');
  });
});

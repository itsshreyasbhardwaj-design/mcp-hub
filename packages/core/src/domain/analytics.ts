import type { Id } from '../ids.js';

/**
 * Append-only fact table. Every dashboard number is derived from these rows —
 * nothing in MCP Hub renders a metric that has no event behind it.
 */
export const EVENT_TYPES = [
  'server.registered',
  'server.updated',
  'server.deleted',
  'version.published',
  'version.deprecated',
  'capabilities.discovered',
  'validation.completed',
  'compatibility.completed',
  'health.checked',
  'incident.opened',
  'incident.resolved',
  'tool.invoked',
  'approval.requested',
  'approval.decided',
  'permission.denied',
  'apikey.created',
  'apikey.revoked',
  'search.performed',
  'assistant.answered',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface AnalyticsEvent {
  id: Id<'event'>;
  organizationId: Id<'organization'>;
  type: EventType;
  serverId: Id<'server'> | null;
  versionId: Id<'version'> | null;
  toolName: string | null;
  environmentId: Id<'environment'> | null;
  actorUserId: Id<'user'> | null;
  /** Numeric payload used by rollups (latency, counts). */
  value: number | null;
  status: string | null;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}

export type TimeRange = '24h' | '7d' | '30d' | '90d' | 'custom';

export interface TimeWindow {
  from: Date;
  to: Date;
  /** Bucket width in seconds, chosen to keep series under ~200 points. */
  bucketSeconds: number;
}

export interface TimeSeriesPoint {
  bucket: string;
  value: number;
}

export interface SeriesSet {
  [seriesName: string]: TimeSeriesPoint[];
}

export interface OverviewMetrics {
  servers: { total: number; healthy: number; degraded: number; failing: number; unknown: number };
  tools: { total: number; bySensitivity: Record<string, number> };
  invocations: {
    total: number;
    succeeded: number;
    failed: number;
    denied: number;
    errorRate: number;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
  };
  incidents: { open: number; resolvedInWindow: number };
  security: { openFindings: number; criticalFindings: number };
  validation: { runs: number; failing: number };
}

export interface ToolUsageRow {
  serverId: Id<'server'>;
  serverSlug: string;
  toolName: string;
  calls: number;
  errors: number;
  errorRate: number;
  p95LatencyMs: number | null;
}

export interface MetricSnapshot {
  id: Id<'snapshot'>;
  organizationId: Id<'organization'>;
  serverId: Id<'server'> | null;
  metric: string;
  window: string;
  value: number;
  capturedAt: Date;
}

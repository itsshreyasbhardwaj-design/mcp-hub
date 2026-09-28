import {
  type AnalyticsEvent,
  type EventType,
  type Id,
  type SeriesSet,
  type TimeSeriesPoint,
  type TimeWindow,
  type ToolUsageRow,
  newId,
} from '@mcp-hub/core';
import type { SqlExecutor } from '../driver.js';
import { Params, WhereBuilder } from '../sqlutil.js';

export interface RecordEventInput {
  organizationId: Id<'organization'>;
  type: EventType;
  serverId?: Id<'server'> | null;
  versionId?: Id<'version'> | null;
  toolName?: string | null;
  environmentId?: Id<'environment'> | null;
  actorUserId?: Id<'user'> | null;
  value?: number | null;
  status?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}

/**
 * Analytics reads only ever aggregate rows that some part of the product
 * actually wrote. There is no synthetic data path: an empty database produces
 * empty charts, and the UI renders an empty state rather than a plausible one.
 */
export class AnalyticsRepository {
  constructor(private readonly db: SqlExecutor) {}

  async record(input: RecordEventInput): Promise<void> {
    await this.db.query(
      `insert into analytics_events (
         id, organization_id, type, server_id, version_id, tool_name,
         environment_id, actor_user_id, value, status, metadata, occurred_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        newId('event'),
        input.organizationId,
        input.type,
        input.serverId ?? null,
        input.versionId ?? null,
        input.toolName ?? null,
        input.environmentId ?? null,
        input.actorUserId ?? null,
        input.value ?? null,
        input.status ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.occurredAt ?? new Date(),
      ],
    );
  }

  async recordMany(inputs: readonly RecordEventInput[]): Promise<void> {
    for (const input of inputs) await this.record(input);
  }

  async listEvents(
    organizationId: Id<'organization'>,
    options: { types?: EventType[]; serverId?: Id<'server'> | null; since?: Date; limit: number },
  ): Promise<AnalyticsEvent[]> {
    const params = new Params();
    const where = new WhereBuilder(params).eq('organization_id', organizationId);
    where.in('type', options.types);
    where.eq('server_id', options.serverId ?? undefined);
    where.gte('occurred_at', options.since);
    const limitParam = params.add(options.limit);
    const { rows } = await this.db.query(
      `select * from analytics_events ${where.sql} order by occurred_at desc limit ${limitParam}`,
      params.all,
    );
    return rows.map((row) => ({
      id: String(row['id']) as Id<'event'>,
      organizationId: String(row['organization_id']) as Id<'organization'>,
      type: row['type'] as EventType,
      serverId: (row['server_id'] as Id<'server'> | null) ?? null,
      versionId: (row['version_id'] as Id<'version'> | null) ?? null,
      toolName: (row['tool_name'] as string | null) ?? null,
      environmentId: (row['environment_id'] as Id<'environment'> | null) ?? null,
      actorUserId: (row['actor_user_id'] as Id<'user'> | null) ?? null,
      value: row['value'] == null ? null : Number(row['value']),
      status: (row['status'] as string | null) ?? null,
      metadata: (row['metadata'] as Record<string, unknown>) ?? {},
      occurredAt:
        row['occurred_at'] instanceof Date
          ? row['occurred_at']
          : new Date(String(row['occurred_at'])),
    }));
  }

  /** Invocation counts bucketed over a window; the requests/errors charts. */
  async invocationSeries(
    organizationId: Id<'organization'>,
    window: TimeWindow,
    filter: { serverId?: Id<'server'> | null; toolName?: string | null } = {},
  ): Promise<SeriesSet> {
    const params = new Params();
    const org = params.add(organizationId);
    const from = params.add(window.from);
    const to = params.add(window.to);
    const bucket = `${params.add(window.bucketSeconds)}::double precision`;
    const where = new WhereBuilder(params);
    where.eq('server_id', filter.serverId ?? undefined);
    where.eq('tool_name', filter.toolName ?? undefined);
    const extra = where.isEmpty ? '' : ` and ${where.sql.replace(/^where /, '')}`;

    const { rows } = await this.db.query<{
      bucket: Date;
      total: number;
      succeeded: number;
      failed: number;
      denied: number;
      avg_latency: number | null;
      p95_latency: number | null;
    }>(
      `select
         to_timestamp(floor(extract(epoch from created_at) / ${bucket}) * ${bucket}) as bucket,
         count(*)::int as total,
         count(*) filter (where status = 'success')::int as succeeded,
         count(*) filter (where status in ('error','timeout'))::int as failed,
         count(*) filter (where status in ('denied','blocked'))::int as denied,
         avg(duration_ms) filter (where status = 'success')::float as avg_latency,
         percentile_cont(0.95) within group (order by duration_ms)::float as p95_latency
       from tool_invocations
       where organization_id = ${org} and created_at >= ${from} and created_at <= ${to}${extra}
       group by 1 order by 1 asc`,
      params.all,
    );

    const toPoints = (pick: (r: (typeof rows)[number]) => number | null): TimeSeriesPoint[] =>
      rows.map((r) => ({
        bucket: (r.bucket instanceof Date ? r.bucket : new Date(String(r.bucket))).toISOString(),
        value: Math.round((pick(r) ?? 0) * 100) / 100,
      }));

    return {
      total: toPoints((r) => r.total),
      succeeded: toPoints((r) => r.succeeded),
      failed: toPoints((r) => r.failed),
      denied: toPoints((r) => r.denied),
      avgLatencyMs: toPoints((r) => r.avg_latency),
      p95LatencyMs: toPoints((r) => r.p95_latency),
    };
  }

  async invocationTotals(
    organizationId: Id<'organization'>,
    window: TimeWindow,
    filter: { serverId?: Id<'server'> | null } = {},
  ): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    denied: number;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
  }> {
    const params = new Params();
    const where = new WhereBuilder(params)
      .eq('organization_id', organizationId)
      .gte('created_at', window.from)
      .lte('created_at', window.to);
    where.eq('server_id', filter.serverId ?? undefined);
    const { rows } = await this.db.query<{
      total: number;
      succeeded: number;
      failed: number;
      denied: number;
      p50: number | null;
      p95: number | null;
    }>(
      `select count(*)::int as total,
              count(*) filter (where status = 'success')::int as succeeded,
              count(*) filter (where status in ('error','timeout'))::int as failed,
              count(*) filter (where status in ('denied','blocked'))::int as denied,
              percentile_cont(0.5) within group (order by duration_ms)::float as p50,
              percentile_cont(0.95) within group (order by duration_ms)::float as p95
         from tool_invocations ${where.sql}`,
      params.all,
    );
    const row = rows[0];
    return {
      total: row?.total ?? 0,
      succeeded: row?.succeeded ?? 0,
      failed: row?.failed ?? 0,
      denied: row?.denied ?? 0,
      p50LatencyMs: row?.p50 == null ? null : Math.round(row.p50),
      p95LatencyMs: row?.p95 == null ? null : Math.round(row.p95),
    };
  }

  async topTools(
    organizationId: Id<'organization'>,
    window: TimeWindow,
    limit: number,
  ): Promise<ToolUsageRow[]> {
    const { rows } = await this.db.query<{
      server_id: string;
      server_slug: string;
      tool_name: string;
      calls: number;
      errors: number;
      p95: number | null;
    }>(
      `select i.server_id, s.slug as server_slug, i.tool_name,
              count(*)::int as calls,
              count(*) filter (where i.status in ('error','timeout'))::int as errors,
              percentile_cont(0.95) within group (order by i.duration_ms)::float as p95
         from tool_invocations i
         join servers s on s.id = i.server_id
        where i.organization_id = $1 and i.created_at >= $2 and i.created_at <= $3
        group by i.server_id, s.slug, i.tool_name
        order by calls desc
        limit $4`,
      [organizationId, window.from, window.to, limit],
    );
    return rows.map((row) => ({
      serverId: row.server_id as Id<'server'>,
      serverSlug: row.server_slug,
      toolName: row.tool_name,
      calls: row.calls,
      errors: row.errors,
      errorRate: row.calls === 0 ? 0 : Math.round((row.errors / row.calls) * 10000) / 100,
      p95LatencyMs: row.p95 == null ? null : Math.round(row.p95),
    }));
  }

  async failuresByServer(
    organizationId: Id<'organization'>,
    window: TimeWindow,
    limit: number,
  ): Promise<
    Array<{ serverId: Id<'server'>; serverSlug: string; failures: number; total: number }>
  > {
    const { rows } = await this.db.query<{
      server_id: string;
      slug: string;
      failures: number;
      total: number;
    }>(
      `select i.server_id, s.slug,
              count(*) filter (where i.status in ('error','timeout'))::int as failures,
              count(*)::int as total
         from tool_invocations i
         join servers s on s.id = i.server_id
        where i.organization_id = $1 and i.created_at >= $2 and i.created_at <= $3
        group by i.server_id, s.slug
       having count(*) filter (where i.status in ('error','timeout')) > 0
        order by failures desc
        limit $4`,
      [organizationId, window.from, window.to, limit],
    );
    return rows.map((r) => ({
      serverId: r.server_id as Id<'server'>,
      serverSlug: r.slug,
      failures: r.failures,
      total: r.total,
    }));
  }

  /** Health status over time, used by the fleet health chart. */
  async healthSeries(organizationId: Id<'organization'>, window: TimeWindow): Promise<SeriesSet> {
    const { rows } = await this.db.query<{
      bucket: Date;
      healthy: number;
      degraded: number;
      failing: number;
      avg_latency: number | null;
    }>(
      `select to_timestamp(floor(extract(epoch from checked_at) / $4::double precision) * $4::double precision) as bucket,
              count(*) filter (where status = 'healthy')::int as healthy,
              count(*) filter (where status = 'degraded')::int as degraded,
              count(*) filter (where status = 'failing')::int as failing,
              avg(latency_ms)::float as avg_latency
         from health_checks
        where organization_id = $1 and checked_at >= $2 and checked_at <= $3
        group by 1 order by 1 asc`,
      [organizationId, window.from, window.to, window.bucketSeconds],
    );
    const toPoints = (pick: (r: (typeof rows)[number]) => number | null): TimeSeriesPoint[] =>
      rows.map((r) => ({
        bucket: (r.bucket instanceof Date ? r.bucket : new Date(String(r.bucket))).toISOString(),
        value: Math.round((pick(r) ?? 0) * 100) / 100,
      }));
    return {
      healthy: toPoints((r) => r.healthy),
      degraded: toPoints((r) => r.degraded),
      failing: toPoints((r) => r.failing),
      avgLatencyMs: toPoints((r) => r.avg_latency),
    };
  }

  async versionAdoption(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
    window: TimeWindow,
  ): Promise<Array<{ version: string; calls: number }>> {
    const { rows } = await this.db.query<{ version: string; calls: number }>(
      `select v.version, count(*)::int as calls
         from tool_invocations i
         join server_versions v on v.id = i.version_id
        where i.organization_id = $1 and i.server_id = $2
          and i.created_at >= $3 and i.created_at <= $4
        group by v.version order by calls desc`,
      [organizationId, serverId, window.from, window.to],
    );
    return rows;
  }

  async snapshot(input: {
    organizationId: Id<'organization'>;
    serverId: Id<'server'> | null;
    metric: string;
    window: string;
    value: number;
  }): Promise<void> {
    await this.db.query(
      `insert into metric_snapshots (id, organization_id, server_id, metric, window_label, value)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        newId('snapshot'),
        input.organizationId,
        input.serverId,
        input.metric,
        input.window,
        input.value,
      ],
    );
  }
}

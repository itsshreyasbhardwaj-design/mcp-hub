import { type Id } from '@mcp-hub/core';
import { contextLogger } from '@mcp-hub/observability';
import type { JobRecord } from '@mcp-hub/database';
import {
  checkServerHealth,
  reindexOrganization,
  reindexServer,
  runValidation,
  type AppContext,
} from '@mcp-hub/api';

export type JobHandler = (context: AppContext, job: JobRecord) => Promise<Record<string, unknown>>;

/**
 * Job handlers.
 *
 * Each one is idempotent: the queue guarantees at-least-once delivery, so a
 * handler that ran twice must produce the same end state. Health checks
 * append a row (so a duplicate is visible but harmless), and indexing rebuilds
 * from current state rather than applying a delta.
 */
export const handlers: Record<string, JobHandler> = {
  /** Enqueues a health check for every server whose interval has elapsed. */
  'health.scan': async (context) => {
    const due = await context.repositories.registry.listServersDueForHealthCheck(100);
    let queued = 0;
    for (const server of due) {
      const job = await context.repositories.jobs.enqueue({
        kind: 'health.check',
        organizationId: server.organizationId,
        payload: { serverId: server.id },
        dedupeKey: `health:${server.id}`,
        priority: 5,
      });
      if (job) queued += 1;
    }
    return { due: due.length, queued };
  },

  'health.check': async (context, job) => {
    const serverId = job.payload['serverId'] as Id<'server'> | undefined;
    if (!serverId || !job.organizationId) return { skipped: 'missing serverId' };
    const server = await context.repositories.registry.findServerById(job.organizationId, serverId);
    if (!server) return { skipped: 'server no longer exists' };
    if (server.isDemo) return { skipped: 'demo server' };

    const outcome = await checkServerHealth(context, job.organizationId, server);
    return {
      status: outcome.status,
      latencyMs: outcome.check.latencyMs,
      incidentsOpened: outcome.incidentsOpened,
      incidentsResolved: outcome.incidentsResolved,
    };
  },

  'search.reindex-server': async (context, job) => {
    const serverId = job.payload['serverId'] as Id<'server'> | undefined;
    if (!serverId || !job.organizationId) return { skipped: 'missing serverId' };
    return { documents: await reindexServer(context, job.organizationId, serverId) };
  },

  'search.reindex-organization': async (context, job) => {
    if (!job.organizationId) return { skipped: 'missing organizationId' };
    return { ...(await reindexOrganization(context, job.organizationId)) };
  },

  /** Re-validates a server on a schedule so stale metadata surfaces itself. */
  'validation.run': async (context, job) => {
    const serverId = job.payload['serverId'] as Id<'server'> | undefined;
    if (!serverId || !job.organizationId) return { skipped: 'missing serverId' };
    const run = await runValidation(
      context,
      {
        kind: 'system',
        userId: null,
        organizationId: job.organizationId,
        role: 'admin',
        scopes: ['validation:run', 'servers:read'],
        displayName: 'worker',
      },
      serverId,
    );
    return { outcome: run.outcome, errors: run.errorCount, warnings: run.warningCount };
  },

  /** Expires stale approvals and sessions, and trims the finished job table. */
  'housekeeping.sweep': async (context) => {
    const [approvals, sessions, jobs] = await Promise.all([
      context.repositories.governance.expireStaleApprovals(),
      context.repositories.sessions.purgeExpired(),
      context.repositories.jobs.purgeCompleted(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
    ]);
    contextLogger().debug('Housekeeping complete', { approvals, sessions, jobs });
    return { expiredApprovals: approvals, purgedSessions: sessions, purgedJobs: jobs };
  },

  /** Captures point-in-time metrics so long-range charts stay cheap. */
  'analytics.snapshot': async (context, job) => {
    if (!job.organizationId) return { skipped: 'missing organizationId' };
    const window = {
      from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      to: new Date(),
      bucketSeconds: 3600,
    };
    const totals = await context.repositories.analytics.invocationTotals(
      job.organizationId,
      window,
    );
    for (const [metric, value] of [
      ['invocations.total', totals.total],
      ['invocations.failed', totals.failed],
      ['latency.p95', totals.p95LatencyMs ?? 0],
    ] as const) {
      await context.repositories.analytics.snapshot({
        organizationId: job.organizationId,
        serverId: null,
        metric,
        window: '24h',
        value,
      });
    }
    return { snapshots: 3, invocations: totals.total };
  },
};

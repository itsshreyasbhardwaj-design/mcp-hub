#!/usr/bin/env node
/**
 * The MCP Hub worker.
 *
 * It claims jobs from the PostgreSQL queue with a lease, so several workers
 * can run against one database without double-processing, and a worker that
 * dies mid-job releases its work when the lease expires.
 *
 * Recurring work (health scans, housekeeping) is enqueued by the worker
 * itself with a dedupe key, which means the schedule survives restarts
 * without a separate scheduler process or a cron entry.
 */
import { randomUUID } from 'node:crypto';
import { getConfig } from '@mcp-hub/config';
import { getDatabase } from '@mcp-hub/database';
import { buildContext } from '@mcp-hub/api';
import { logger, runWithContext } from '@mcp-hub/observability';
import { handlers } from './handlers.js';

const config = getConfig();
const workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
const LEASE_MS = 120_000;

const RECURRING: Array<{ kind: string; everyMs: number }> = [
  { kind: 'health.scan', everyMs: 60_000 },
  { kind: 'housekeeping.sweep', everyMs: 15 * 60_000 },
];

let running = true;

async function main(): Promise<void> {
  const db = await getDatabase();
  const context = buildContext(db, config);

  logger.info('Worker started', {
    workerId,
    concurrency: config.queue.concurrency,
    pollIntervalMs: config.queue.pollIntervalMs,
    handlers: Object.keys(handlers).length,
  });

  if (config.queue.driver !== 'database') {
    logger.warn(
      'MCP_HUB_QUEUE_DRIVER is not "database"; this worker only implements the database queue.',
      { driver: config.queue.driver },
    );
  }

  const scheduleRecurring = async (): Promise<void> => {
    for (const task of RECURRING) {
      await context.repositories.jobs.enqueue({
        kind: task.kind,
        dedupeKey: `recurring:${task.kind}`,
        priority: 1,
      });
    }
  };
  await scheduleRecurring();
  const recurringTimer = setInterval(() => {
    void scheduleRecurring().catch((err: unknown) => {
      logger.error('Failed to schedule recurring work', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, 60_000);

  while (running) {
    let claimed = 0;
    try {
      const jobs = await context.repositories.jobs.claim(
        workerId,
        config.queue.concurrency,
        LEASE_MS,
      );
      claimed = jobs.length;

      await Promise.all(
        jobs.map((job) =>
          runWithContext(
            {
              route: `job:${job.kind}`,
              ...(job.organizationId ? { organizationId: job.organizationId } : {}),
            },
            async () => {
              const started = performance.now();
              const handler = handlers[job.kind];
              if (!handler) {
                await context.repositories.jobs.fail(
                  job.id,
                  `No handler for "${job.kind}".`,
                  60_000,
                );
                return;
              }
              try {
                const result = await handler(context, job);
                await context.repositories.jobs.complete(job.id, result);
                logger.info('Job completed', {
                  kind: job.kind,
                  durationMs: Math.round(performance.now() - started),
                  ...result,
                });
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                // Exponential backoff, capped, so a persistently broken server
                // does not spin the worker.
                const delay = Math.min(30_000 * 2 ** job.attempts, 15 * 60_000);
                await context.repositories.jobs.fail(job.id, message, delay);
                logger.warn('Job failed', {
                  kind: job.kind,
                  attempt: job.attempts,
                  retryInMs: delay,
                  error: message,
                });
              }
            },
          ),
        ),
      );
    } catch (err) {
      logger.error('Worker loop error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (claimed === 0) await sleep(config.queue.pollIntervalMs);
  }

  clearInterval(recurringTimer);
  logger.info('Worker stopped', { workerId });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('Worker draining', { signal });
    running = false;
  });
}

main().catch((err: unknown) => {
  logger.error('Worker crashed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

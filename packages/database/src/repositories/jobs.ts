import { type Id, newId } from '@mcp-hub/core';
import type { SqlExecutor } from '../driver.js';

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobRecord {
  id: Id<'job'>;
  organizationId: Id<'organization'> | null;
  kind: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lastError: string | null;
  result: Record<string, unknown> | null;
  createdAt: Date;
}

export interface EnqueueInput {
  kind: string;
  payload?: Record<string, unknown>;
  organizationId?: Id<'organization'> | null;
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  /** Prevents duplicate pending work for the same logical task. */
  dedupeKey?: string | null;
}

function toJob(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row['id']) as Id<'job'>,
    organizationId: (row['organization_id'] as Id<'organization'> | null) ?? null,
    kind: String(row['kind']),
    payload: (row['payload'] as Record<string, unknown>) ?? {},
    status: row['status'] as JobStatus,
    priority: Number(row['priority'] ?? 0),
    attempts: Number(row['attempts'] ?? 0),
    maxAttempts: Number(row['max_attempts'] ?? 3),
    runAt: row['run_at'] instanceof Date ? row['run_at'] : new Date(String(row['run_at'])),
    lastError: (row['last_error'] as string | null) ?? null,
    result: (row['result'] as Record<string, unknown> | null) ?? null,
    createdAt:
      row['created_at'] instanceof Date ? row['created_at'] : new Date(String(row['created_at'])),
  };
}

/**
 * Durable queue in PostgreSQL. Workers claim jobs with a lease
 * (`FOR UPDATE SKIP LOCKED`), so several worker processes can run against the
 * same database without double-processing, and a crashed worker's jobs become
 * claimable again once the lease expires.
 */
export class JobRepository {
  constructor(private readonly db: SqlExecutor) {}

  async enqueue(input: EnqueueInput): Promise<JobRecord | null> {
    const { rows } = await this.db.query(
      `insert into jobs (id, organization_id, kind, payload, priority, run_at, max_attempts, dedupe_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (dedupe_key) where dedupe_key is not null and status in ('pending','running')
       do nothing
       returning *`,
      [
        newId('job'),
        input.organizationId ?? null,
        input.kind,
        JSON.stringify(input.payload ?? {}),
        input.priority ?? 0,
        input.runAt ?? new Date(),
        input.maxAttempts ?? 3,
        input.dedupeKey ?? null,
      ],
    );
    return rows[0] ? toJob(rows[0]) : null;
  }

  /** Atomically claims up to `limit` runnable jobs for `workerId`. */
  async claim(workerId: string, limit: number, leaseMs: number): Promise<JobRecord[]> {
    const { rows } = await this.db.query(
      `update jobs set
         status = 'running',
         attempts = attempts + 1,
         locked_at = now(),
         locked_by = $1,
         lock_expires_at = now() + make_interval(secs => $2::double precision),
         updated_at = now()
       where id in (
         select id from jobs
          where (status = 'pending' and run_at <= now())
             or (status = 'running' and lock_expires_at < now())
          order by priority desc, run_at asc
          limit $3
          for update skip locked
       )
       returning *`,
      [workerId, leaseMs / 1000, limit],
    );
    return rows.map(toJob);
  }

  async complete(jobId: Id<'job'>, result: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `update jobs set status = 'succeeded', result = $2, locked_by = null,
                       lock_expires_at = null, updated_at = now()
        where id = $1`,
      [jobId, JSON.stringify(result)],
    );
  }

  /** Reschedules with backoff, or marks failed once attempts are exhausted. */
  async fail(jobId: Id<'job'>, error: string, retryDelayMs: number): Promise<void> {
    await this.db.query(
      `update jobs set
         status = case when attempts >= max_attempts then 'failed' else 'pending' end,
         run_at = case when attempts >= max_attempts then run_at
                       else now() + make_interval(secs => $3::double precision) end,
         last_error = $2,
         locked_by = null,
         lock_expires_at = null,
         updated_at = now()
       where id = $1`,
      [jobId, error.slice(0, 2000), retryDelayMs / 1000],
    );
  }

  async listRecent(limit: number, organizationId?: Id<'organization'> | null): Promise<JobRecord[]> {
    const { rows } = organizationId
      ? await this.db.query(
          'select * from jobs where organization_id = $1 order by created_at desc limit $2',
          [organizationId, limit],
        )
      : await this.db.query('select * from jobs order by created_at desc limit $1', [limit]);
    return rows.map(toJob);
  }

  async stats(): Promise<Record<JobStatus, number>> {
    const { rows } = await this.db.query<{ status: JobStatus; count: number }>(
      'select status, count(*)::int as count from jobs group by status',
    );
    const out: Record<JobStatus, number> = {
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const row of rows) out[row.status] = row.count;
    return out;
  }

  /** Housekeeping: keeps the table small on long-running deployments. */
  async purgeCompleted(olderThan: Date): Promise<number> {
    const result = await this.db.query(
      `delete from jobs where status in ('succeeded','cancelled') and updated_at < $1`,
      [olderThan],
    );
    return result.rowCount;
  }
}

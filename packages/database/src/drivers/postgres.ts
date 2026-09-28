import type { QueryResult, SqlDriver, SqlExecutor } from '../driver.js';
import { DatabaseError } from '../driver.js';

interface PgClientLike {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  release?(): void;
}

interface PgPoolLike extends PgClientLike {
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
}

function wrap(client: PgClientLike): SqlExecutor {
  return {
    async query<T>(text: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
      try {
        const result = await client.query(text, [...params]);
        return { rows: result.rows as T[], rowCount: result.rowCount ?? result.rows.length };
      } catch (err) {
        throw new DatabaseError(
          err instanceof Error ? err.message : 'Query failed',
          text.slice(0, 500),
          err,
        );
      }
    },
    async exec(text: string): Promise<void> {
      try {
        await client.query(text);
      } catch (err) {
        throw new DatabaseError(
          err instanceof Error ? err.message : 'Script failed',
          text.slice(0, 500),
          err,
        );
      }
    },
  };
}

/** Real PostgreSQL over `pg`. Used whenever DATABASE_URL is set. */
export async function createPostgresDriver(options: {
  connectionString: string;
  poolSize: number;
  statementTimeoutMs: number;
}): Promise<SqlDriver> {
  const pg = await import('pg');
  const Pool = pg.default?.Pool ?? pg.Pool;
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.poolSize,
    statement_timeout: options.statementTimeoutMs,
    application_name: 'mcp-hub',
  }) as unknown as PgPoolLike;

  await pool.query('select 1');

  // Assigned on both branches below.
  let trigram: boolean;
  try {
    await pool.query('create extension if not exists pg_trgm');
    trigram = true;
  } catch {
    const probe = await pool.query("select 1 from pg_extension where extname = 'pg_trgm'");
    trigram = probe.rows.length > 0;
  }

  const base = wrap(pool);
  return {
    kind: 'postgres',
    capabilities: { trigram },
    query: base.query,
    exec: base.exec,
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn(wrap(client));
        await client.query('commit');
        return result;
      } catch (err) {
        try {
          await client.query('rollback');
        } catch {
          // The connection is already broken; the pool will discard it.
        }
        throw err;
      } finally {
        client.release?.();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { QueryResult, SqlDriver, SqlExecutor } from '../driver.js';
import { DatabaseError } from '../driver.js';

interface PGliteLike {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  exec(text: string): Promise<unknown>;
  transaction<T>(fn: (tx: PGliteLike) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function wrap(client: PGliteLike): SqlExecutor {
  return {
    async query<T>(text: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
      try {
        const result = await client.query<T>(text, [...params]);
        return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
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
        await client.exec(text);
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

/**
 * Embedded PostgreSQL. Boots in-process with no Docker, no service and no
 * credentials, which is what makes `pnpm dev` and the integration suite work
 * on a laptop with an empty environment.
 */
export async function createPgliteDriver(options: {
  dataDir: string;
  /** Skips the filesystem entirely; used by the test suite. */
  inMemory?: boolean;
}): Promise<SqlDriver> {
  const { PGlite } = await import('@electric-sql/pglite');

  let trigram = false;
  const extensions: Record<string, unknown> = {};
  try {
    const mod = await import('@electric-sql/pglite/contrib/pg_trgm');
    extensions['pg_trgm'] = mod.pg_trgm;
    trigram = true;
  } catch {
    // Trigram search is an enhancement; the search provider degrades to a
    // deterministic JavaScript scorer when the extension is unavailable.
  }

  let dataDir: string | undefined;
  if (!options.inMemory) {
    dataDir = resolve(options.dataDir);
    mkdirSync(dataDir, { recursive: true });
  }

  // PGlite's constructor option type varies between builds; the shape passed
  // here is stable across 0.3–0.5 and is verified by the smoke query below.
  const client = new PGlite({
    ...(dataDir ? { dataDir } : {}),
    extensions,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any) as unknown as PGliteLike;

  await client.query('select 1');
  if (trigram) {
    try {
      await client.exec('create extension if not exists pg_trgm;');
    } catch {
      trigram = false;
    }
  }

  const base = wrap(client);
  return {
    kind: 'pglite',
    capabilities: { trigram },
    query: base.query,
    exec: base.exec,
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      return client.transaction(async (tx) => fn(wrap(tx)));
    },
    async close() {
      await client.close();
    },
  };
}

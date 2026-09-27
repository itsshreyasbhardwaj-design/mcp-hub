import { getConfig } from '@mcp-hub/config';
import { logger } from '@mcp-hub/observability';
import type { SqlDriver } from './driver.js';
import { createPgliteDriver } from './drivers/pglite.js';
import { createPostgresDriver } from './drivers/postgres.js';
import { runMigrations } from './migrate.js';

export interface ConnectOptions {
  /** Overrides the environment; used by tests and the CLI. */
  driver?: 'pglite' | 'postgres';
  connectionString?: string | null;
  dataDir?: string;
  inMemory?: boolean;
  /** Runs pending migrations as part of connecting. Defaults to true. */
  migrate?: boolean;
}

export async function connect(options: ConnectOptions = {}): Promise<SqlDriver> {
  const config = getConfig();
  const kind = options.driver ?? config.database.driver;
  const started = performance.now();

  const driver =
    kind === 'postgres'
      ? await createPostgresDriver({
          connectionString: options.connectionString ?? config.database.url ?? '',
          poolSize: config.database.poolSize,
          statementTimeoutMs: config.database.statementTimeoutMs,
        })
      : await createPgliteDriver({
          dataDir: options.dataDir ?? config.database.embeddedPath,
          ...(options.inMemory ? { inMemory: true } : {}),
        });

  if (options.migrate !== false) {
    const result = await runMigrations(driver);
    if (result.applied.length > 0) {
      logger.info('Database migrations applied', { migrations: result.applied });
    }
  }

  logger.debug('Database ready', {
    driver: driver.kind,
    trigram: driver.capabilities.trigram,
    durationMs: Math.round(performance.now() - started),
  });
  return driver;
}

// Next.js dev-mode hot reloading re-evaluates modules; the connection is
// cached on globalThis so a single embedded database is shared across reloads.
const GLOBAL_KEY = Symbol.for('mcp-hub.database');
interface GlobalCache {
  promise?: Promise<SqlDriver>;
}
const globalCache = globalThis as unknown as Record<symbol, GlobalCache | undefined>;

/** Process-wide database handle. Connects (and migrates) on first use. */
export function getDatabase(): Promise<SqlDriver> {
  const cache = (globalCache[GLOBAL_KEY] ??= {});
  cache.promise ??= connect().catch((err: unknown) => {
    delete cache.promise;
    throw err;
  });
  return cache.promise;
}

export async function closeDatabase(): Promise<void> {
  const cache = globalCache[GLOBAL_KEY];
  if (!cache?.promise) return;
  const driver = await cache.promise;
  delete cache.promise;
  await driver.close();
}

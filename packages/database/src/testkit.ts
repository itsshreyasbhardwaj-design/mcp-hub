import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetConfigCache } from '@mcp-hub/config';
import type { SqlDriver } from './driver.js';
import { createPgliteDriver } from './drivers/pglite.js';
import { runMigrations } from './migrate.js';

/**
 * Spins up a fully migrated, in-memory PostgreSQL for a single test file.
 * Because PGlite is real PostgreSQL, integration tests exercise the same SQL,
 * constraints and index behaviour that production does.
 */
export async function createTestDatabase(): Promise<SqlDriver> {
  process.env['NODE_ENV'] = 'test';
  process.env['MCP_HUB_DATA_DIR'] ??= mkdtempSync(join(tmpdir(), 'mcp-hub-test-'));
  resetConfigCache();
  const driver = await createPgliteDriver({ dataDir: '', inMemory: true });
  await runMigrations(driver);
  return driver;
}

/** Deterministic-ish unique suffix for slugs and names inside tests. */
export function uniq(prefix = 't'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

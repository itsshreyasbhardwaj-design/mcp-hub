import { createHash } from 'node:crypto';
import type { SqlDriver } from './driver.js';
import { migrations } from './migrations/index.js';

const LEDGER = `
create table if not exists schema_migrations (
  id          text primary key,
  name        text not null,
  checksum    text not null,
  applied_at  timestamptz not null default now()
);`;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies pending migrations inside a transaction and records a checksum for
 * each. An already-applied migration whose SQL has changed is a hard error:
 * silently diverging schemas are worse than a failed boot.
 */
export async function runMigrations(driver: SqlDriver): Promise<MigrationResult> {
  await driver.exec(LEDGER);
  const existing = await driver.query<{ id: string; checksum: string }>(
    'select id, checksum from schema_migrations',
  );
  const applied = new Map(existing.rows.map((row) => [row.id, row.checksum]));

  const result: MigrationResult = { applied: [], skipped: [] };

  for (const migration of migrations) {
    const checksum = createHash('sha256').update(migration.sql).digest('hex');
    const previous = applied.get(migration.id);
    if (previous) {
      if (previous !== checksum) {
        throw new Error(
          `Migration ${migration.id} has already been applied but its contents changed. ` +
            'Create a new migration instead of editing an applied one.',
        );
      }
      result.skipped.push(migration.id);
      continue;
    }

    await driver.transaction(async (tx) => {
      await tx.exec(migration.sql);
      await tx.query(
        'insert into schema_migrations (id, name, checksum) values ($1, $2, $3)',
        [migration.id, migration.name, checksum],
      );
    });
    result.applied.push(migration.id);
  }

  return result;
}

/** Drops every table the migrations own. Used by `pnpm db:reset` and tests. */
export async function dropAll(driver: SqlDriver): Promise<void> {
  await driver.exec('drop schema if exists public cascade; create schema public;');
}

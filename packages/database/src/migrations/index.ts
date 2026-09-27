import { migration0001Init } from './0001_init.js';

export interface Migration {
  id: string;
  name: string;
  sql: string;
}

/**
 * Migrations are plain SQL embedded in TypeScript so they ship inside the
 * published package and survive any bundler, with no file-copy build step.
 * They run in array order, exactly once, inside a transaction.
 */
export const migrations: readonly Migration[] = [migration0001Init];

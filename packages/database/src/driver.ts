/**
 * The only SQL surface the rest of the application sees.
 *
 * Two implementations back it: `pg` against a real PostgreSQL (Supabase,
 * RDS, self-hosted) and PGlite — PostgreSQL compiled to WebAssembly — for
 * local development and tests. Both speak the same dialect, so there is
 * exactly one set of migrations and one set of queries.
 */
export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface SqlExecutor {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
  /**
   * Runs a script that may contain several statements. Parameters are not
   * supported here by design — this path exists only for migrations, whose
   * SQL is authored in-repo and never contains user input.
   */
  exec(text: string): Promise<void>;
}

export interface SqlDriver extends SqlExecutor {
  readonly kind: 'pglite' | 'postgres';
  /** True when pg_trgm loaded successfully, enabling trigram fuzzy search. */
  readonly capabilities: { trigram: boolean };
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class DatabaseError extends Error {
  readonly query: string;
  override readonly cause: unknown;
  /** The underlying PostgreSQL SQLSTATE, preserved so callers can branch on it. */
  readonly code: string | null;

  constructor(message: string, query: string, cause: unknown) {
    super(message);
    this.name = 'DatabaseError';
    this.query = query;
    this.cause = cause;
    this.code =
      cause && typeof cause === 'object' && typeof (cause as { code?: unknown }).code === 'string'
        ? (cause as { code: string }).code
        : null;
  }
}

/** Postgres unique-violation SQLSTATE. */
export const UNIQUE_VIOLATION = '23505';
export const FOREIGN_KEY_VIOLATION = '23503';

export function pgErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === UNIQUE_VIOLATION;
}

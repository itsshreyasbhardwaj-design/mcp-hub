import { HubError } from './errors.js';

export interface PageRequest {
  /** Opaque cursor returned by a previous page. */
  cursor?: string | undefined;
  limit: number;
}

export interface Page<T> {
  data: T[];
  /** Cursor for the next page, or null when the collection is exhausted. */
  nextCursor: string | null;
  /** Total matching rows, when the query can produce it cheaply. */
  total?: number;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function normalizeLimit(raw: unknown, fallback = DEFAULT_PAGE_SIZE): number {
  if (raw == null || raw === '') return fallback;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) {
    throw HubError.badRequest('`limit` must be a positive integer.', { limit: raw });
  }
  return Math.min(Math.trunc(n), MAX_PAGE_SIZE);
}

/** Cursors are base64url of `<sortValue>|<id>`; opaque to clients, stable under inserts. */
export function encodeCursor(sortValue: string | number | Date, id: string): string {
  const raw = sortValue instanceof Date ? sortValue.toISOString() : String(sortValue);
  return Buffer.from(`${raw}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { sortValue: string; id: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw HubError.badRequest('Malformed pagination cursor.');
  }
  const sep = decoded.lastIndexOf('|');
  if (sep <= 0) throw HubError.badRequest('Malformed pagination cursor.');
  return { sortValue: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
}

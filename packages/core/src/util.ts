import { createHash } from 'node:crypto';

/**
 * Deterministic JSON serialisation with sorted object keys. Used wherever a
 * structure must hash identically across processes (schema fingerprints,
 * approval argument hashes, change detection).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) !== Date.prototype) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Stable fingerprint of a JSON Schema, used to detect schema drift. */
export function fingerprint(value: unknown): string {
  return sha256(stableStringify(value));
}

export function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, Math.max(0, max - 1))}…`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Percentile over an unsorted numeric sample. Returns null for empty input. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp(Math.ceil((p / 100) * sorted.length) - 1, 0, sorted.length - 1);
  return sorted[idx] ?? null;
}

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function groupBy<T, K extends string>(items: readonly T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const k = key(item);
    (out[k] ??= []).push(item);
  }
  return out;
}

/** Rejects after `ms`, used to bound every outbound operation. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

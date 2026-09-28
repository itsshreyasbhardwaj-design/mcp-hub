import { type TimeRange, type TimeWindow, HubError } from '@mcp-hub/core';

const RANGE_MS: Record<Exclude<TimeRange, 'custom'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

/** Bucket widths chosen to keep every series around 100–200 points. */
const BUCKETS: Array<[maxSpanMs: number, bucketSeconds: number]> = [
  [2 * 60 * 60 * 1000, 60],
  [12 * 60 * 60 * 1000, 300],
  [2 * 24 * 60 * 60 * 1000, 900],
  [8 * 24 * 60 * 60 * 1000, 3600],
  [40 * 24 * 60 * 60 * 1000, 6 * 3600],
  [Number.POSITIVE_INFINITY, 24 * 3600],
];

export function bucketSecondsFor(spanMs: number): number {
  for (const [maxSpan, seconds] of BUCKETS) {
    if (spanMs <= maxSpan) return seconds;
  }
  return 24 * 3600;
}

export interface ResolveWindowInput {
  range?: string | null;
  from?: string | Date | null;
  to?: string | Date | null;
  now?: Date;
}

/**
 * Turns a requested range into a concrete window with a bucket width. Custom
 * ranges are validated here so no caller has to reason about clock skew or
 * inverted bounds.
 */
export function resolveWindow(input: ResolveWindowInput = {}): TimeWindow & { range: TimeRange } {
  const now = input.now ?? new Date();

  if (input.from || input.to) {
    const from = toDate(input.from, 'from') ?? new Date(now.getTime() - RANGE_MS['24h']);
    const to = toDate(input.to, 'to') ?? now;
    if (from.getTime() >= to.getTime()) {
      throw HubError.badRequest('`from` must be earlier than `to`.');
    }
    const span = to.getTime() - from.getTime();
    if (span > 366 * 24 * 60 * 60 * 1000) {
      throw HubError.badRequest('A custom range may not exceed 366 days.');
    }
    return { from, to, bucketSeconds: bucketSecondsFor(span), range: 'custom' };
  }

  const range = (input.range ?? '24h') as TimeRange;
  if (range === 'custom') {
    throw HubError.badRequest('range=custom requires `from` and `to`.');
  }
  const span = RANGE_MS[range];
  if (span === undefined) {
    throw HubError.badRequest(
      `Unknown range "${range}". Use 24h, 7d, 30d, 90d or a custom from/to.`,
    );
  }
  return {
    from: new Date(now.getTime() - span),
    to: now,
    bucketSeconds: bucketSecondsFor(span),
    range,
  };
}

function toDate(value: string | Date | null | undefined, field: string): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw HubError.badRequest(`\`${field}\` is not a valid ISO 8601 timestamp.`);
  }
  return date;
}

/**
 * Fills gaps in a sparse series so charts do not imply continuity where there
 * is no data. Missing buckets become explicit zeros rather than being skipped.
 */
export function densify(
  points: ReadonlyArray<{ bucket: string; value: number }>,
  window: TimeWindow,
): Array<{ bucket: string; value: number }> {
  const byBucket = new Map(points.map((p) => [new Date(p.bucket).getTime(), p.value]));
  const step = window.bucketSeconds * 1000;
  const start = Math.floor(window.from.getTime() / step) * step;
  const end = Math.floor(window.to.getTime() / step) * step;
  const out: Array<{ bucket: string; value: number }> = [];
  for (let t = start; t <= end; t += step) {
    out.push({ bucket: new Date(t).toISOString(), value: byBucket.get(t) ?? 0 });
  }
  return out;
}

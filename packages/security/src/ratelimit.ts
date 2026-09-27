export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** Unix ms at which the current window resets. */
  resetAt: number;
  limit: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window rate limiter.
 *
 * The in-memory implementation is correct for a single process and is what a
 * self-hosted single-node deployment runs. Multi-instance deployments should
 * supply a shared store through the same interface — the limiter is
 * intentionally a small interface rather than a hard dependency on Redis.
 */
export interface RateLimitStore {
  hit(key: string, windowMs: number, limit: number): Promise<RateLimitDecision>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  async hit(key: string, windowMs: number, limit: number): Promise<RateLimitDecision> {
    const now = Date.now();
    this.sweep(now);
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
      limit,
    };
  }

  /** Bounded memory: expired buckets are dropped at most once a minute. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  reset(): void {
    this.buckets.clear();
  }
}

/** Process-wide limiter used by the API layer. */
export const rateLimitStore: RateLimitStore = new MemoryRateLimitStore();

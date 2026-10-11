/**
 * Fixed-window rate limiting, in memory.
 *
 * The CMS is a single process by design, so an in-memory counter is
 * sufficient and avoids a Redis dependency. The trade-off is deliberate:
 * counters reset on restart. Mica checks no passwords; the identity provider
 * does, with its own limits, so a restart-and-retry loop gains little.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfter: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
  /** Forgets a key — called after a successful login. */
  reset(key: string): void;
  size(): number;
  stop(): void;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  /** How often expired buckets are swept. */
  sweepMs?: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, options.sweepMs ?? Math.max(options.windowMs, 60_000));

  // A sweep timer must not keep the process alive on shutdown.
  sweep.unref?.();

  return {
    check(key) {
      const now = Date.now();
      const bucket = buckets.get(key);

      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + options.windowMs });
        return { allowed: true, remaining: options.limit - 1, retryAfter: 0 };
      }

      bucket.count++;
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);

      if (bucket.count > options.limit) {
        return { allowed: false, remaining: 0, retryAfter };
      }

      return { allowed: true, remaining: options.limit - bucket.count, retryAfter };
    },

    reset(key) {
      buckets.delete(key);
    },

    size() {
      return buckets.size;
    },

    stop() {
      clearInterval(sweep);
      buckets.clear();
    },
  };
}

/**
 * In-memory fixed-window rate limiter (per process). Enough for a single API instance;
 * move to Redis when running several instances.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  /** Seconds to wait if the key is over the limit, else 0. Does not count. */
  check(key: string, now = Date.now()): number {
    const e = this.hits.get(key);
    if (!e || e.resetAt <= now) return 0;
    return e.count >= this.limit ? Math.ceil((e.resetAt - now) / 1000) : 0;
  }

  /** Count one (failed) attempt. */
  hit(key: string, now = Date.now()): void {
    const e = this.hits.get(key);
    if (!e || e.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.gc(now);
    } else e.count++;
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  private gc(now: number) {
    if (this.hits.size < 10_000) return;
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}

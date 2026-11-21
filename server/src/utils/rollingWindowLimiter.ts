/**
 * In-memory rolling-window limiter keyed by an authenticated identity.
 *
 * Per process, reset on restart, no timers (passive eviction). Allowed requests
 * are recorded; refused requests are not. Used by US-035 / #407 typing signals.
 */

export interface RollingWindowResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class RollingWindowLimiter {
  private readonly store = new Map<string, number[]>();

  constructor(
    readonly max: number,
    readonly windowMs: number,
    private readonly sweepThreshold = 5_000
  ) {}

  private recent(timestamps: number[], now: number): number[] {
    return timestamps.filter((ts) => now - ts < this.windowMs && ts <= now);
  }

  /** Checks and, when allowed, records one request for this key. */
  consume(rawKey: string, now = Date.now()): RollingWindowResult {
    if (this.store.size > this.sweepThreshold) {
      for (const [key, timestamps] of this.store) {
        if (this.recent(timestamps, now).length === 0) this.store.delete(key);
      }
    }

    const key = rawKey.trim().toLowerCase();
    const timestamps = this.recent(this.store.get(key) ?? [], now);
    if (timestamps.length >= this.max) {
      this.store.set(key, timestamps);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((timestamps[0]! + this.windowMs - now) / 1000)),
      };
    }
    timestamps.push(now);
    this.store.set(key, timestamps);
    return { allowed: true, remaining: this.max - timestamps.length, retryAfterSeconds: 0 };
  }

  reset(): void {
    this.store.clear();
  }
}

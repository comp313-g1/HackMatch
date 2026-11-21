/**
 * US-035 / #405 — rolling-minute limiter for reaction mutations (#404 policy,
 * sections 4 and 10: 30 per participant per rolling minute, in-memory).
 *
 * One bucket per authenticated participant, shared by the public-channel,
 * team-channel, and direct-message reaction routes, so switching routes cannot
 * bypass it. Every accepted add/remove request uses one unit, including a
 * request that turns out to be an idempotent no-op: the server does the same
 * authorization and write work either way, and charging only real changes would
 * let a client repeat no-op requests without limit.
 *
 * Like the existing OTP limiter, state is per process, resets on restart, and
 * is evicted passively (no timers). Rejected requests do not consume units.
 */

import {
  REACTION_RATE_LIMIT_MAX,
  REACTION_RATE_LIMIT_WINDOW_MS,
} from '../db/chatReactionModel.js';

export interface ReactionRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const store = new Map<string, number[]>();
/** Above this many tracked participants, idle buckets are swept on the next call. */
const SWEEP_THRESHOLD = 5_000;

function recent(timestamps: number[], now: number): number[] {
  return timestamps.filter((ts) => now - ts < REACTION_RATE_LIMIT_WINDOW_MS && ts <= now);
}

function sweep(now: number): void {
  for (const [key, timestamps] of store) {
    if (recent(timestamps, now).length === 0) store.delete(key);
  }
}

/** Checks and, when allowed, records one reaction mutation for this participant. */
export function consumeReactionMutation(participantId: string, now = Date.now()): ReactionRateLimitResult {
  if (store.size > SWEEP_THRESHOLD) sweep(now);

  const key = participantId.trim().toLowerCase();
  const timestamps = recent(store.get(key) ?? [], now);

  if (timestamps.length >= REACTION_RATE_LIMIT_MAX) {
    store.set(key, timestamps);
    const oldest = timestamps[0]!;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + REACTION_RATE_LIMIT_WINDOW_MS - now) / 1000)),
    };
  }

  timestamps.push(now);
  store.set(key, timestamps);
  return {
    allowed: true,
    remaining: REACTION_RATE_LIMIT_MAX - timestamps.length,
    retryAfterSeconds: 0,
  };
}

/** Clears all limiter state (tests only). */
export function _resetReactionRateLimiter(): void {
  store.clear();
}

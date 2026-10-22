/**
 * In-memory sliding-window rate limiter for verification / OTP / reset sends (FR-081).
 *
 * FR-081 proposed default: 1 send / 60s and 5 / rolling hour.
 * Production keeps that unless overridden. Local/test use a looser default so
 * accidental double-mounts and OTP retries are less painful.
 *
 * Override anytime with:
 *   OTP_RATE_LIMIT_COOLDOWN_MS
 *   OTP_RATE_LIMIT_MAX_PER_HOUR
 *   OTP_RATE_LIMIT_STRICT=true  (force FR-081 defaults outside production)
 *
 * Implemented with passive TTL eviction during access to eliminate un-ref'd timers
 * or event-loop leaks in long-running node processes and Vitest environments.
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

interface RateLimitRecord {
  lastSentAt: number;
  timestamps: number[];
}

const FR081_COOLDOWN_MS = 60 * 1000;
const FR081_MAX_PER_HOUR = 5;
/** Local/dev defaults — still limited, but usable while iterating on MFA. */
const RELAXED_COOLDOWN_MS = 15 * 1000;
const RELAXED_MAX_PER_HOUR = 20;

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const forceStrict =
  process.env.OTP_RATE_LIMIT_STRICT === 'true' || process.env.NODE_ENV === 'production';

export const COOLDOWN_MS = envPositiveInt(
  'OTP_RATE_LIMIT_COOLDOWN_MS',
  forceStrict ? FR081_COOLDOWN_MS : RELAXED_COOLDOWN_MS
);
export const WINDOW_MS = 60 * 60 * 1000; // 1 hour rolling window
export const MAX_REQUESTS_PER_WINDOW = envPositiveInt(
  'OTP_RATE_LIMIT_MAX_PER_HOUR',
  forceStrict ? FR081_MAX_PER_HOUR : RELAXED_MAX_PER_HOUR
);

// In-memory store mapping `${purpose}:${normalizedIdentifier}` to RateLimitRecord
const store = new Map<string, RateLimitRecord>();

function getStorageKey(purpose: string, identifier: string): string {
  return `${purpose.trim().toLowerCase()}:${identifier.trim().toLowerCase()}`;
}

/**
 * Evaluates whether an action is permitted under dual-tier rate limits.
 * Does not mutate state or record an attempt.
 */
export function checkRateLimit(
  purpose: string,
  identifier: string,
  now = Date.now()
): RateLimitResult {
  const key = getStorageKey(purpose, identifier);
  const record = store.get(key);

  if (!record) {
    return { allowed: true };
  }

  // Passive cleanup: filter timestamps older than rolling window
  const validTimestamps = record.timestamps.filter((ts) => now - ts < WINDOW_MS);
  record.timestamps = validTimestamps;

  // If no recent timestamps and cooldown has elapsed, evict key to prevent memory leaks
  if (validTimestamps.length === 0 && now - record.lastSentAt >= COOLDOWN_MS) {
    store.delete(key);
    return { allowed: true };
  }

  // 1. Cooldown between consecutive sends
  const timeSinceLastSend = now - record.lastSentAt;
  let cooldownRetrySeconds = 0;
  if (timeSinceLastSend < COOLDOWN_MS) {
    cooldownRetrySeconds = Math.ceil((COOLDOWN_MS - timeSinceLastSend) / 1000);
  }

  // 2. Cap per rolling hour
  let windowRetrySeconds = 0;
  if (validTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    const oldestTimestamp = validTimestamps[0]!;
    windowRetrySeconds = Math.ceil((WINDOW_MS - (now - oldestTimestamp)) / 1000);
  }

  const retryAfterSeconds = Math.max(cooldownRetrySeconds, windowRetrySeconds);

  if (retryAfterSeconds > 0) {
    return {
      allowed: false,
      retryAfterSeconds,
    };
  }

  return { allowed: true };
}

/**
 * Records an authorized dispatch event for the specified purpose and identifier.
 */
export function recordRateLimitSend(
  purpose: string,
  identifier: string,
  now = Date.now()
): void {
  const key = getStorageKey(purpose, identifier);
  let record = store.get(key);

  if (!record) {
    record = {
      lastSentAt: now,
      timestamps: [now],
    };
    store.set(key, record);
    return;
  }

  // Evict timestamps older than 1 hour and append current timestamp
  record.timestamps = record.timestamps.filter((ts) => now - ts < WINDOW_MS);
  record.timestamps.push(now);
  record.lastSentAt = now;
}

/**
 * Consolidated rate limiter API object matching the implementation plan.
 */
export const rateLimiter = {
  checkLimit: checkRateLimit,
  recordSend: recordRateLimitSend,
};

/**
 * Clears all rate limiter records (intended for test setup and teardown).
 */
export function _resetRateLimiter(): void {
  store.clear();
}

/**
 * In-memory sliding-window rate limiter enforcing FR-081:
 * "no more than one send per account/purpose per 60 seconds and 5 per rolling hour."
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

export const COOLDOWN_MS = 60 * 1000; // 60 seconds cooldown between consecutive sends
export const WINDOW_MS = 60 * 60 * 1000; // 3600 seconds (1 hour) rolling window
export const MAX_REQUESTS_PER_WINDOW = 5; // Max 5 sends per rolling hour

// In-memory store mapping `${purpose}:${normalizedIdentifier}` to RateLimitRecord
const store = new Map<string, RateLimitRecord>();

function getStorageKey(purpose: string, identifier: string): string {
  return `${purpose.trim().toLowerCase()}:${identifier.trim().toLowerCase()}`;
}

/**
 * Evaluates whether an action is permitted under FR-081 dual-tier rate limits.
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

  // 1. Enforce 60-second cooldown between consecutive sends
  const timeSinceLastSend = now - record.lastSentAt;
  let cooldownRetrySeconds = 0;
  if (timeSinceLastSend < COOLDOWN_MS) {
    cooldownRetrySeconds = Math.ceil((COOLDOWN_MS - timeSinceLastSend) / 1000);
  }

  // 2. Enforce 5 requests cap per rolling hour
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

import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkRateLimit,
  recordRateLimitSend,
  rateLimiter,
  _resetRateLimiter,
  COOLDOWN_MS,
  WINDOW_MS,
  MAX_REQUESTS_PER_WINDOW,
} from './rateLimiter.js';

describe('rateLimiter utility (FR-081)', () => {
  const purpose = 'verification';
  const email = 'user@example.com';
  const baseTime = 1_000_000;

  beforeEach(() => {
    _resetRateLimiter();
  });

  describe('Initial state and unrecorded identifiers', () => {
    it('allows requests when no send has occurred', () => {
      const result = checkRateLimit(purpose, email, baseTime);
      expect(result).toEqual({ allowed: true });
    });

    it('allows requests when checked via rateLimiter object wrapper', () => {
      const result = rateLimiter.checkLimit(purpose, email, baseTime);
      expect(result).toEqual({ allowed: true });
    });
  });

  describe('60-second cooldown enforcement (FR-081)', () => {
    it('blocks immediate subsequent requests with exact retryAfterSeconds', () => {
      recordRateLimitSend(purpose, email, baseTime);

      // Check immediately at t = 0
      const immediateResult = checkRateLimit(purpose, email, baseTime);
      expect(immediateResult.allowed).toBe(false);
      expect(immediateResult.retryAfterSeconds).toBe(60);

      // Check at t + 30.5 seconds
      const midResult = checkRateLimit(purpose, email, baseTime + 30_500);
      expect(midResult.allowed).toBe(false);
      expect(midResult.retryAfterSeconds).toBe(30);

      // Check at t + 59.1 seconds (should ceil to 1 second)
      const nearEndResult = checkRateLimit(purpose, email, baseTime + 59_100);
      expect(nearEndResult.allowed).toBe(false);
      expect(nearEndResult.retryAfterSeconds).toBe(1);
    });

    it('allows subsequent request exactly when 60-second cooldown has passed', () => {
      recordRateLimitSend(purpose, email, baseTime);

      const result = checkRateLimit(purpose, email, baseTime + COOLDOWN_MS);
      expect(result).toEqual({ allowed: true });
    });
  });

  describe('5 requests per rolling hour cap (FR-081)', () => {
    it('allows up to 5 requests spaced out by more than 60 seconds', () => {
      // 5 requests spaced 70 seconds apart:
      // t0: 0s, t1: 70s, t2: 140s, t3: 210s, t4: 280s
      for (let i = 0; i < MAX_REQUESTS_PER_WINDOW; i++) {
        const time = baseTime + i * 70_000;
        const check = checkRateLimit(purpose, email, time);
        expect(check.allowed).toBe(true);
        recordRateLimitSend(purpose, email, time);
      }

      // Check at t = 350s (70s after 5th request, cooldown passed)
      const sixthCheckTime = baseTime + 5 * 70_000;
      const sixthCheck = checkRateLimit(purpose, email, sixthCheckTime);

      expect(sixthCheck.allowed).toBe(false);
      // Oldest request was at baseTime (t = 0). Window is 3600s.
      // Expected retryAfterSeconds = ceil((3600s - 350s)) = 3250s
      expect(sixthCheck.retryAfterSeconds).toBe(3250);
    });

    it('unblocks the 6th request once the oldest request expires outside the rolling window', () => {
      // Record 5 requests at t0..t4
      for (let i = 0; i < MAX_REQUESTS_PER_WINDOW; i++) {
        const time = baseTime + i * 70_000;
        recordRateLimitSend(purpose, email, time);
      }

      // Time right after t0 expires: baseTime + WINDOW_MS + 1ms
      // At this point, t0 is evicted, leaving 4 requests in the window
      const postExpiryTime = baseTime + WINDOW_MS + 1;
      const result = checkRateLimit(purpose, email, postExpiryTime);

      expect(result.allowed).toBe(true);
    });
  });

  describe('Identifier and purpose normalization', () => {
    it('normalizes email with uppercase and leading/trailing whitespace', () => {
      recordRateLimitSend(purpose, '  User@Example.COM  ', baseTime);

      const check = checkRateLimit(purpose, 'user@example.com', baseTime + 10_000);
      expect(check.allowed).toBe(false);
      expect(check.retryAfterSeconds).toBe(50);
    });

    it('normalizes purpose string with whitespace and case variations', () => {
      recordRateLimitSend(' Verification ', email, baseTime);

      const check = checkRateLimit('verification', email, baseTime + 10_000);
      expect(check.allowed).toBe(false);
    });

    it('isolates different purposes for the same email', () => {
      recordRateLimitSend('verification', email, baseTime);

      const resetCheck = checkRateLimit('password-reset', email, baseTime);
      expect(resetCheck.allowed).toBe(true);

      const verificationCheck = checkRateLimit('verification', email, baseTime);
      expect(verificationCheck.allowed).toBe(false);
    });

    it('isolates different accounts under the same purpose', () => {
      recordRateLimitSend(purpose, 'user1@example.com', baseTime);

      const user2Check = checkRateLimit(purpose, 'user2@example.com', baseTime);
      expect(user2Check.allowed).toBe(true);

      const user1Check = checkRateLimit(purpose, 'user1@example.com', baseTime);
      expect(user1Check.allowed).toBe(false);
    });
  });

  describe('Passive eviction and memory hygiene', () => {
    it('passively evicts record from storage map after entire window and cooldown expire', () => {
      recordRateLimitSend(purpose, email, baseTime);

      // Querying at baseTime + WINDOW_MS + COOLDOWN_MS triggers passive eviction
      const afterWindowTime = baseTime + WINDOW_MS + COOLDOWN_MS + 1000;
      const result = checkRateLimit(purpose, email, afterWindowTime);

      expect(result.allowed).toBe(true);

      // Now recording a new send starts clean
      recordRateLimitSend(purpose, email, afterWindowTime);
      const immediateCheck = checkRateLimit(purpose, email, afterWindowTime);
      expect(immediateCheck.allowed).toBe(false);
      expect(immediateCheck.retryAfterSeconds).toBe(60);
    });
  });

  describe('Test isolation via _resetRateLimiter', () => {
    it('clears all recorded state', () => {
      recordRateLimitSend(purpose, email, baseTime);
      expect(checkRateLimit(purpose, email, baseTime).allowed).toBe(false);

      _resetRateLimiter();

      expect(checkRateLimit(purpose, email, baseTime).allowed).toBe(true);
    });
  });

  describe('rateLimiter namespace aliases', () => {
    it('supports rateLimiter.recordSend and rateLimiter.checkLimit seamlessly', () => {
      rateLimiter.recordSend(purpose, email, baseTime);
      const result = rateLimiter.checkLimit(purpose, email, baseTime + 10_000);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBe(50);
    });
  });
});

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

  describe('cooldown enforcement (FR-081)', () => {
    const cooldownSeconds = COOLDOWN_MS / 1000;

    it('blocks immediate subsequent requests with exact retryAfterSeconds', () => {
      recordRateLimitSend(purpose, email, baseTime);

      const immediateResult = checkRateLimit(purpose, email, baseTime);
      expect(immediateResult.allowed).toBe(false);
      expect(immediateResult.retryAfterSeconds).toBe(cooldownSeconds);

      const midOffsetMs = Math.floor(COOLDOWN_MS / 2) + 500;
      const midResult = checkRateLimit(purpose, email, baseTime + midOffsetMs);
      expect(midResult.allowed).toBe(false);
      expect(midResult.retryAfterSeconds).toBe(Math.ceil((COOLDOWN_MS - midOffsetMs) / 1000));

      const nearEndOffsetMs = COOLDOWN_MS - 900;
      const nearEndResult = checkRateLimit(purpose, email, baseTime + nearEndOffsetMs);
      expect(nearEndResult.allowed).toBe(false);
      expect(nearEndResult.retryAfterSeconds).toBe(1);
    });

    it('allows subsequent request exactly when cooldown has passed', () => {
      recordRateLimitSend(purpose, email, baseTime);

      const result = checkRateLimit(purpose, email, baseTime + COOLDOWN_MS);
      expect(result).toEqual({ allowed: true });
    });
  });

  describe('hourly cap (FR-081)', () => {
    const spacingMs = COOLDOWN_MS + 10_000;

    it('allows up to the configured max when spaced beyond the cooldown', () => {
      for (let i = 0; i < MAX_REQUESTS_PER_WINDOW; i++) {
        const time = baseTime + i * spacingMs;
        const check = checkRateLimit(purpose, email, time);
        expect(check.allowed).toBe(true);
        recordRateLimitSend(purpose, email, time);
      }

      const overflowCheckTime = baseTime + MAX_REQUESTS_PER_WINDOW * spacingMs;
      const overflowCheck = checkRateLimit(purpose, email, overflowCheckTime);

      expect(overflowCheck.allowed).toBe(false);
      const elapsedSeconds = (overflowCheckTime - baseTime) / 1000;
      expect(overflowCheck.retryAfterSeconds).toBe(Math.ceil(WINDOW_MS / 1000 - elapsedSeconds));
    });

    it('unblocks once the oldest request expires outside the rolling window', () => {
      for (let i = 0; i < MAX_REQUESTS_PER_WINDOW; i++) {
        const time = baseTime + i * spacingMs;
        recordRateLimitSend(purpose, email, time);
      }

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
      expect(check.retryAfterSeconds).toBe(Math.ceil((COOLDOWN_MS - 10_000) / 1000));
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
      expect(immediateCheck.retryAfterSeconds).toBe(COOLDOWN_MS / 1000);
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
      expect(result.retryAfterSeconds).toBe(Math.ceil((COOLDOWN_MS - 10_000) / 1000));
    });
  });
});

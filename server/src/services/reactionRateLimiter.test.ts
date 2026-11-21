/**
 * US-035 / #405 — reaction mutation limiter (#404 policy: 30 per participant per rolling minute).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetReactionRateLimiter, consumeReactionMutation } from './reactionRateLimiter.js';

const A = '10000000-0000-4000-8000-000000000001';
const B = '20000000-0000-4000-8000-000000000002';
const T0 = Date.parse('2026-11-12T12:00:00Z');

describe('consumeReactionMutation', () => {
  beforeEach(() => _resetReactionRateLimiter());

  it('allows exactly 30 in a rolling minute, then refuses with retry timing', () => {
    for (let i = 0; i < 30; i += 1) {
      expect(consumeReactionMutation(A, T0 + i * 100)).toMatchObject({ allowed: true, remaining: 29 - i });
    }
    const refused = consumeReactionMutation(A, T0 + 3_000);
    expect(refused).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 57 });
  });

  it('reopens one slot as each request leaves the 60-second window', () => {
    for (let i = 0; i < 30; i += 1) consumeReactionMutation(A, T0 + i * 1_000);
    expect(consumeReactionMutation(A, T0 + 59_999).allowed).toBe(false);
    expect(consumeReactionMutation(A, T0 + 60_000).allowed).toBe(true);
    expect(consumeReactionMutation(A, T0 + 60_001).allowed).toBe(false);
  });

  it('does not count refused requests against the caller', () => {
    for (let i = 0; i < 30; i += 1) consumeReactionMutation(A, T0);
    for (let i = 0; i < 100; i += 1) consumeReactionMutation(A, T0 + 1_000);
    expect(consumeReactionMutation(A, T0 + 60_000).allowed).toBe(true);
  });

  it('keeps participants independent and normalizes id case', () => {
    for (let i = 0; i < 30; i += 1) consumeReactionMutation(A, T0);
    expect(consumeReactionMutation(A.toUpperCase(), T0).allowed).toBe(false);
    expect(consumeReactionMutation(B, T0).allowed).toBe(true);
  });
});

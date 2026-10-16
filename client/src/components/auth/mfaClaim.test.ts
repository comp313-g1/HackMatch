import { describe, it, expect } from 'vitest';
import { hasCompletedMfa, describeSessionError, MFA_CLAIM } from './mfaClaim';

const AUTH_TIME = 1_792_000_000;

describe('hasCompletedMfa', () => {
  it.each([
    ['claim equals numeric auth_time', { auth_time: AUTH_TIME, [MFA_CLAIM]: AUTH_TIME }, true],
    ['claim equals string auth_time', { auth_time: String(AUTH_TIME), [MFA_CLAIM]: AUTH_TIME }, true],
    ['claim missing', { auth_time: AUTH_TIME }, false],
    ['claim from an earlier sign-in', { auth_time: AUTH_TIME, [MFA_CLAIM]: AUTH_TIME - 1 }, false],
    ['claim newer than sign-in', { auth_time: AUTH_TIME, [MFA_CLAIM]: AUTH_TIME + 1 }, false],
    ['claim stored as string', { auth_time: AUTH_TIME, [MFA_CLAIM]: String(AUTH_TIME) }, false],
    ['claim is boolean', { auth_time: AUTH_TIME, [MFA_CLAIM]: true }, false],
    ['auth_time missing', { [MFA_CLAIM]: AUTH_TIME }, false],
    ['auth_time not numeric', { auth_time: 'yesterday', [MFA_CLAIM]: AUTH_TIME }, false],
    ['empty claims', {}, false],
  ])('%s -> %s', (_label, claims, expected) => {
    expect(hasCompletedMfa(claims)).toBe(expected);
  });
});

describe('describeSessionError', () => {
  it('classifies network errors', () => {
    expect(describeSessionError({ code: 'auth/network-request-failed' }).kind).toBe('network');
  });

  it.each(['auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-disabled', 'auth/user-not-found'])(
    'treats %s as an ended session',
    (code) => {
      expect(describeSessionError({ code })).toEqual({
        kind: 'session-ended',
        message: 'Your session has ended. Please sign in again.',
      });
    }
  );

  it('falls back to a generic message', () => {
    expect(describeSessionError(new Error('boom')).kind).toBe('unknown');
    expect(describeSessionError(null).kind).toBe('unknown');
  });
});

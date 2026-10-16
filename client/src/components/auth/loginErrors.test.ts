import { describe, it, expect } from 'vitest';
import {
  validateLoginInput,
  describeLoginError,
  GENERIC_CREDENTIALS_ERROR,
  ACCOUNT_SUSPENDED_ERROR,
} from './loginErrors';

describe('validateLoginInput', () => {
  it('returns no errors for a well-formed email and any non-empty password', () => {
    expect(validateLoginInput('jane@example.com', 'x')).toEqual({});
  });

  it('requires both fields', () => {
    expect(validateLoginInput('', '')).toEqual({
      email: 'Email address is required.',
      password: 'Password is required.',
    });
  });

  it('rejects a malformed email', () => {
    expect(validateLoginInput('jane@', 'secret').email).toBe('Please enter a valid email address.');
  });
});

describe('describeLoginError', () => {
  it('does not reveal whether the account exists', () => {
    expect(describeLoginError({ code: 'auth/user-not-found' })).toEqual(
      describeLoginError({ code: 'auth/wrong-password' })
    );
    expect(describeLoginError({ code: 'auth/invalid-credential' }).message).toBe(
      GENERIC_CREDENTIALS_ERROR
    );
    expect(describeLoginError({ code: 'auth/missing-password' }).message).toBe(
      GENERIC_CREDENTIALS_ERROR
    );
  });

  it('classifies throttling, disabled, suspended and network errors', () => {
    expect(describeLoginError({ code: 'auth/too-many-requests' }).kind).toBe('throttled');
    expect(describeLoginError({ code: 'auth/user-disabled' }).kind).toBe('disabled');
    expect(describeLoginError({ code: 'ACCOUNT_DISABLED' }).kind).toBe('disabled');
    expect(describeLoginError({ code: 'ACCOUNT_SUSPENDED' })).toEqual({
      kind: 'suspended',
      message: ACCOUNT_SUSPENDED_ERROR,
    });
    expect(describeLoginError({ code: 'auth/network-request-failed' }).kind).toBe('network');
  });

  it('falls back to a generic message for unknown errors', () => {
    expect(describeLoginError(new Error('boom'))).toEqual({
      kind: 'unknown',
      message: 'Sign-in failed. Please try again.',
    });
    expect(describeLoginError(null).kind).toBe('unknown');
  });
});

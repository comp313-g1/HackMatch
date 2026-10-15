import { describe, it, expect } from 'vitest';
import {
  translateOAuthServerError,
  OAUTH_GENERIC_FAILURE_MESSAGE,
  type OAuthServerCode,
} from './oauthErrors';

describe('oauthErrors unit tests (US-002 AC 4 / S1-P2-04)', () => {
  it('translates REAUTHENTICATION_REQUIRED correctly', () => {
    expect(translateOAuthServerError('REAUTHENTICATION_REQUIRED')).toBe(
      'Recent reauthentication is required to link an external provider. Please sign in again.'
    );
  });

  it('translates EMAIL_MISMATCH correctly', () => {
    expect(translateOAuthServerError('EMAIL_MISMATCH')).toBe(
      'The provider account email does not match your registered account email.'
    );
  });

  it('translates PROVIDER_ALREADY_LINKED correctly', () => {
    expect(translateOAuthServerError('PROVIDER_ALREADY_LINKED')).toBe(
      'This provider account is already linked to another user.'
    );
  });

  it('translates PROVIDER_ALREADY_EXISTS correctly', () => {
    expect(translateOAuthServerError('PROVIDER_ALREADY_EXISTS')).toBe(
      'An account of this provider type is already linked to your profile.'
    );
  });

  it('translates existing auth codes correctly', () => {
    expect(translateOAuthServerError('PROVIDER_MISMATCH')).toBe(
      'The selected provider does not match your sign-in credential. Please try again.'
    );
    expect(translateOAuthServerError('INVALID_TOKEN')).toBe(
      'Your sign-in credential has expired. Please sign in again.'
    );
    expect(translateOAuthServerError('UNVERIFIED_PROVIDER_EMAIL')).toBe(
      'A verified provider email is required. Please sign up using email registration instead.'
    );
    expect(translateOAuthServerError('ADMIN_OAUTH_PROHIBITED')).toBe(
      'Public sign-in cannot be used for administrator accounts.'
    );
    expect(translateOAuthServerError('LINKING_REAUTHENTICATION_REQUIRED')).toBe(
      'This email is already registered. Please sign in with your password, then link this provider.'
    );
    expect(translateOAuthServerError('EMAIL_DELIVERY_FAILED')).toBe(
      "We couldn't send the verification email. Please try again."
    );
  });

  it('handles parameterized ACCOUNT_LOCKED and RATE_LIMITED error messages', () => {
    expect(translateOAuthServerError('ACCOUNT_LOCKED', 120)).toBe(
      'Your account is temporarily locked after too many failed attempts. Please try again in about 2 minutes.'
    );
    expect(translateOAuthServerError('ACCOUNT_LOCKED', 30)).toBe(
      'Your account is temporarily locked after too many failed attempts. Please try again in about 1 minute.'
    );
    expect(translateOAuthServerError('RATE_LIMITED', 45)).toBe(
      'Too many requests. Please try again in about 45 seconds.'
    );
    expect(translateOAuthServerError('RATE_LIMITED', 1)).toBe(
      'Too many requests. Please try again in about 1 second.'
    );
  });

  it('returns generic failure message for unknown or undefined codes', () => {
    expect(translateOAuthServerError(undefined)).toBe(OAUTH_GENERIC_FAILURE_MESSAGE);
    expect(translateOAuthServerError('UNKNOWN_ERROR_CODE')).toBe(OAUTH_GENERIC_FAILURE_MESSAGE);
  });

  it('verifies all OAuthServerCode union members are covered', () => {
    const codes: OAuthServerCode[] = [
      'PROVIDER_MISMATCH',
      'INVALID_TOKEN',
      'UNVERIFIED_PROVIDER_EMAIL',
      'ADMIN_OAUTH_PROHIBITED',
      'LINKING_REAUTHENTICATION_REQUIRED',
      'REAUTHENTICATION_REQUIRED',
      'EMAIL_MISMATCH',
      'PROVIDER_ALREADY_LINKED',
      'PROVIDER_ALREADY_EXISTS',
      'ACCOUNT_LOCKED',
      'RATE_LIMITED',
      'EMAIL_DELIVERY_FAILED',
    ];
    for (const code of codes) {
      const msg = translateOAuthServerError(code);
      expect(msg).not.toBe(OAUTH_GENERIC_FAILURE_MESSAGE);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GENERIC_PASSWORD_RECOVERY_CONFIRMATION,
  describePasswordRecoveryRequestError,
  requestPasswordReset,
} from './passwordRecoveryRequest';

describe('passwordRecoveryRequest (US-005 AC 1–2 / FR-011 / S1-P1-13)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exports a single generic confirmation string for known and unknown addresses', () => {
    expect(GENERIC_PASSWORD_RECOVERY_CONFIRMATION).toMatch(/if an account exists/i);
    expect(GENERIC_PASSWORD_RECOVERY_CONFIRMATION).toMatch(/google or github/i);
  });

  it('happy path: POSTs normalized email to /api/auth/password-reset', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ message: GENERIC_PASSWORD_RECOVERY_CONFIRMATION }),
    });

    await requestPasswordReset('  Jane@Example.com ');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'jane@example.com' }),
      })
    );
  });

  it('unknown address: uniform 200 is treated as success (generic confirmation)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ message: GENERIC_PASSWORD_RECOVERY_CONFIRMATION }),
    });

    await expect(requestPasswordReset('ghost@example.com')).resolves.toBeUndefined();
  });

  it('maps network and throttle failures for the error state', () => {
    expect(
      describePasswordRecoveryRequestError(
        Object.assign(new Error('net'), {
          kind: 'network',
          code: 'auth/network-request-failed',
          message: 'Network error. Please check your internet connection and try again.',
        })
      ).kind
    ).toBe('network');
    expect(
      describePasswordRecoveryRequestError(
        Object.assign(new Error('limit'), {
          kind: 'throttled',
          code: 'RATE_LIMITED',
          message: 'Too many reset requests. Please wait a few minutes before trying again.',
        })
      ).kind
    ).toBe('throttled');
  });

  it('throws throttled error on HTTP 429 RATE_LIMITED', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({
        error: 'Too many requests. Please wait before requesting another password reset email.',
        code: 'RATE_LIMITED',
        retryAfter: 60,
      }),
    });

    await expect(requestPasswordReset('jane@example.com')).rejects.toMatchObject({
      kind: 'throttled',
      code: 'RATE_LIMITED',
    });
  });

  it('throws invalid_email on HTTP 400 field errors', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'Validation failed',
        errors: { email: 'Please provide a valid email address.' },
      }),
    });

    await expect(requestPasswordReset('bad')).rejects.toMatchObject({
      kind: 'invalid_email',
      message: 'Please provide a valid email address.',
    });
  });

  it('throws network error when fetch fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(requestPasswordReset('jane@example.com')).rejects.toMatchObject({
      kind: 'network',
      code: 'auth/network-request-failed',
    });
  });
});

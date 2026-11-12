import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authFetch } from '../../config/authFetch';
import {
  AuthenticatorEnrollmentApiError,
  beginAuthenticatorEnrollment,
  confirmAuthenticatorEnrollment,
  getAuthenticatorEnrollmentStatus,
  parseBeginAuthenticatorEnrollment,
  parseConfirmAuthenticatorEnrollment,
  restartAuthenticatorEnrollment,
} from './authenticatorEnrollmentApi';

vi.mock('../../config/authFetch', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../config/authFetch')>();
  return { ...original, authFetch: vi.fn() };
});

const pendingResponse = {
  authenticator: {
    status: 'pending' as const,
    enrollmentId: 'enrollment_1234',
    expiresAt: '2026-11-11T18:10:00.000Z',
    issuer: 'HackMatch',
    accountLabel: 'HackMatch account',
    algorithm: 'SHA1' as const,
    digits: 6 as const,
    periodSeconds: 30 as const,
  },
  setup: {
    otpauthUri: 'otpauth://totp/HackMatch%3AHackMatch%20account?secret=OWNERONLY&issuer=HackMatch',
    manualEntryKey: 'OWNERONLY',
  },
  availableChallengeMethods: ['email_otp'] as ['email_otp'],
  emailOtpFallback: true as const,
};

const activeResponse = {
  authenticator: {
    status: 'active' as const,
    activatedAt: '2026-11-11T18:05:00.000Z',
  },
  availableChallengeMethods: ['authenticator_totp', 'email_otp'] as Array<
    'authenticator_totp' | 'email_otp'
  >,
  emailOtpFallback: true as const,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('authenticator enrollment API client (US-029 / #268)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts an owner-only begin request and validates the pending response', async () => {
    vi.mocked(authFetch).mockResolvedValue(json(pendingResponse, 201));

    await expect(beginAuthenticatorEnrollment()).resolves.toEqual(pendingResponse);
    expect(authFetch).toHaveBeenCalledWith(
      '/api/auth/mfa/authenticator/enrollment',
      expect.objectContaining({ method: 'POST', body: '{}' })
    );
  });

  it('posts only the enrollment id and six-digit code for confirmation', async () => {
    vi.mocked(authFetch).mockResolvedValue(json(activeResponse));

    await expect(
      confirmAuthenticatorEnrollment('enrollment_1234', '123456')
    ).resolves.toEqual(activeResponse);
    expect(authFetch).toHaveBeenCalledWith(
      '/api/auth/mfa/authenticator/enrollment/confirm',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ enrollmentId: 'enrollment_1234', code: '123456' }),
      })
    );
  });

  it('uses the dedicated owner-only restart endpoint to replace lost pending material', async () => {
    vi.mocked(authFetch).mockResolvedValue(json(pendingResponse, 201));

    await expect(restartAuthenticatorEnrollment()).resolves.toEqual(pendingResponse);
    expect(authFetch).toHaveBeenCalledWith(
      '/api/auth/mfa/authenticator/enrollment/restart',
      expect.objectContaining({ method: 'POST', body: '{}' })
    );
  });

  it('loads safe current status without requesting setup material', async () => {
    const status = {
      authenticator: { status: 'active', activatedAt: '2026-11-11T18:05:00.000Z' },
      availableChallengeMethods: ['authenticator_totp', 'email_otp'],
      emailOtpFallback: true,
    };
    vi.mocked(authFetch).mockResolvedValue(json(status));

    await expect(getAuthenticatorEnrollmentStatus()).resolves.toEqual(status);
    expect(authFetch).toHaveBeenCalledWith(
      '/api/auth/mfa/authenticator/enrollment',
      { method: 'GET' }
    );
  });

  it('rejects malformed success responses instead of accepting unsafe setup data', () => {
    expect(() =>
      parseBeginAuthenticatorEnrollment({
        ...pendingResponse,
        emailOtpFallback: false,
      })
    ).toThrowError(AuthenticatorEnrollmentApiError);
    expect(() =>
      parseConfirmAuthenticatorEnrollment({
        ...activeResponse,
        availableChallengeMethods: ['authenticator_totp'],
      })
    ).toThrowError(AuthenticatorEnrollmentApiError);
  });

  it('preserves safe server error codes and field errors without exposing arbitrary fields', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      json(
        {
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          errors: { code: 'A 6-digit authenticator code is required.', leaked: 42 },
          database: 'private detail',
        },
        400
      )
    );

    await expect(
      confirmAuthenticatorEnrollment('enrollment_1234', 'bad')
    ).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      fieldErrors: { code: 'A 6-digit authenticator code is required.' },
    });
  });

  it('maps network failures to a retryable safe error', async () => {
    vi.mocked(authFetch).mockRejectedValue(new Error('socket and secret internals'));

    await expect(beginAuthenticatorEnrollment()).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
      retryable: true,
      message: 'Network error. Check your connection and try again.',
    });
  });
});

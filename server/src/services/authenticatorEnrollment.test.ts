import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthenticatorEnrollmentError,
  _resetAuthenticatorEnrollmentProvider,
  _setAuthenticatorEnrollmentProvider,
  beginAuthenticatorEnrollment,
  confirmAuthenticatorEnrollment,
  type AuthenticatorEnrollmentProvider,
  type AuthenticatorOwnerContext,
} from './authenticatorEnrollment.js';

const owner: AuthenticatorOwnerContext = {
  participantId: 'part-1',
  firebaseUid: 'firebase-1',
  role: 'PART',
};

describe('authenticator enrollment service contract (US-029 / #266)', () => {
  afterEach(() => _resetAuthenticatorEnrollmentProvider());

  it('returns only approved owner enrollment material and keeps email OTP available', async () => {
    const provider = {
      begin: vi.fn().mockResolvedValue({
        enrollmentId: 'enrollment_123',
        expiresAt: '2026-11-11T18:10:00.000Z',
        otpauthUri: 'otpauth://totp/HackMatch%3Aaccount?secret=OWNERONLY&issuer=HackMatch',
        manualEntryKey: 'OWNERONLY',
        accountLabel: 'HackMatch account',
        databaseRow: { encryptedSecret: 'must-not-leak' },
      }),
      confirm: vi.fn(),
    } as unknown as AuthenticatorEnrollmentProvider;
    _setAuthenticatorEnrollmentProvider(provider);

    const result = await beginAuthenticatorEnrollment(owner);

    expect(provider.begin).toHaveBeenCalledWith(owner);
    expect(result).toEqual({
      authenticator: {
        status: 'pending',
        enrollmentId: 'enrollment_123',
        expiresAt: '2026-11-11T18:10:00.000Z',
        issuer: 'HackMatch',
        accountLabel: 'HackMatch account',
        algorithm: 'SHA1',
        digits: 6,
        periodSeconds: 30,
      },
      setup: {
        otpauthUri: 'otpauth://totp/HackMatch%3Aaccount?secret=OWNERONLY&issuer=HackMatch',
        manualEntryKey: 'OWNERONLY',
      },
      availableChallengeMethods: ['email_otp'],
      emailOtpFallback: true,
    });
    expect(JSON.stringify(result)).not.toContain('encryptedSecret');
    expect(JSON.stringify(result)).not.toContain('databaseRow');
  });

  it('activates only after provider confirmation and never returns setup material', async () => {
    const provider: AuthenticatorEnrollmentProvider = {
      begin: vi.fn(),
      confirm: vi.fn().mockResolvedValue({ activatedAt: '2026-11-11T18:05:00.000Z' }),
    };
    _setAuthenticatorEnrollmentProvider(provider);

    const result = await confirmAuthenticatorEnrollment(owner, 'enrollment_123', '012345');

    expect(provider.confirm).toHaveBeenCalledWith(owner, 'enrollment_123', '012345');
    expect(result).toEqual({
      authenticator: {
        status: 'active',
        activatedAt: '2026-11-11T18:05:00.000Z',
      },
      availableChallengeMethods: ['authenticator_totp', 'email_otp'],
      emailOtpFallback: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|otpauth|manualEntryKey/i);
  });

  it('rejects malformed codes before calling the provider', async () => {
    const provider: AuthenticatorEnrollmentProvider = {
      begin: vi.fn(),
      confirm: vi.fn(),
    };
    _setAuthenticatorEnrollmentProvider(provider);

    await expect(
      confirmAuthenticatorEnrollment(owner, 'enrollment_123', '12345x')
    ).rejects.toMatchObject({ code: 'INVALID_AUTHENTICATOR_CODE', status: 400 });
    expect(provider.confirm).not.toHaveBeenCalled();
  });

  it('preserves explicit lifecycle failures and hides unknown provider failures', async () => {
    const pending = new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_PENDING', 409);
    _setAuthenticatorEnrollmentProvider({
      begin: vi.fn().mockRejectedValueOnce(pending).mockRejectedValueOnce(new Error('SQL secret row failed')),
      confirm: vi.fn(),
    });

    await expect(beginAuthenticatorEnrollment(owner)).rejects.toBe(pending);
    await expect(beginAuthenticatorEnrollment(owner)).rejects.toMatchObject({
      code: 'AUTHENTICATOR_ENROLLMENT_UNAVAILABLE',
      status: 503,
    });
  });

  it('fails closed when #267 protected-storage configuration is missing', async () => {
    const previous = process.env.TOTP_ENCRYPTION_KEY_BASE64;
    delete process.env.TOTP_ENCRYPTION_KEY_BASE64;
    try {
      await expect(beginAuthenticatorEnrollment(owner)).rejects.toMatchObject({
        code: 'AUTHENTICATOR_CONFIGURATION_ERROR',
        status: 503,
      });
    } finally {
      if (previous === undefined) delete process.env.TOTP_ENCRYPTION_KEY_BASE64;
      else process.env.TOTP_ENCRYPTION_KEY_BASE64 = previous;
    }
  });
});

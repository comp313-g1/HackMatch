import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyPasswordResetCode } from 'firebase/auth';
import {
  completePasswordReset,
  describePasswordResetLinkError,
  validatePasswordResetLink,
} from './passwordResetConfirm';
import { PASSWORD_POLICY_MESSAGE } from './validation';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    verifyPasswordResetCode: vi.fn(),
  };
});

const mockVerify = vi.mocked(verifyPasswordResetCode);

describe('passwordResetConfirm (US-005 AC 2–4 / FR-012)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validatePasswordResetLink returns email from Firebase', async () => {
    mockVerify.mockResolvedValueOnce('jane@example.com');
    await expect(validatePasswordResetLink('  valid-oob  ')).resolves.toBe('jane@example.com');
    expect(mockVerify).toHaveBeenCalledWith(expect.anything(), 'valid-oob');
  });

  it('maps expired, invalid, and revocation failure codes', () => {
    expect(
      describePasswordResetLinkError(
        Object.assign(new Error('expired'), { code: 'auth/expired-action-code' })
      ).kind
    ).toBe('expired');
    expect(
      describePasswordResetLinkError(
        Object.assign(new Error('used'), { code: 'INVALID_ACTION_CODE' })
      ).kind
    ).toBe('invalid');
    expect(
      describePasswordResetLinkError(
        Object.assign(new Error('revoke'), { code: 'REVOCATION_FAILED' })
      ).kind
    ).toBe('revocation_failed');
  });

  it('completePasswordReset enforces policy before calling the API', async () => {
    await expect(completePasswordReset('oob', 'weak')).rejects.toMatchObject({
      kind: 'weak_password',
      message: PASSWORD_POLICY_MESSAGE,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('completePasswordReset POSTs to /api/auth/password-reset/confirm', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        message: 'Password updated. All existing sessions have been revoked.',
      }),
    });

    await completePasswordReset('oob-code', 'Valid1@Password', 'Valid1@Password');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset/confirm',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          oobCode: 'oob-code',
          newPassword: 'Valid1@Password',
          confirmPassword: 'Valid1@Password',
        }),
      })
    );
  });

  it('completePasswordReset maps REVOCATION_FAILED from the API', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({
        error: 'Your password was updated, but we could not sign out other devices.',
        code: 'REVOCATION_FAILED',
      }),
    });

    await expect(completePasswordReset('oob', 'Valid1@Password')).rejects.toMatchObject({
      kind: 'revocation_failed',
      code: 'REVOCATION_FAILED',
    });
  });

  it('completePasswordReset maps expired action codes from the API', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'This password reset link has expired.',
        code: 'EXPIRED_ACTION_CODE',
      }),
    });

    await expect(completePasswordReset('oob', 'Valid1@Password')).rejects.toMatchObject({
      kind: 'expired',
      code: 'EXPIRED_ACTION_CODE',
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signOut } from 'firebase/auth';
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
    signOut: vi.fn(),
  };
});

const mockSignOut = vi.mocked(signOut);

describe('passwordResetConfirm (US-005 AC 2–4 / S1-P2-16)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validatePasswordResetLink returns email for a valid credential link', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        state: 'valid',
        email: 'jane@example.com',
        accountType: 'credential',
      }),
    });

    await expect(validatePasswordResetLink('  valid-oob  ')).resolves.toEqual({
      state: 'valid',
      email: 'jane@example.com',
      accountType: 'credential',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset/validate',
      expect.objectContaining({
        body: JSON.stringify({ oobCode: 'valid-oob' }),
      })
    );
  });

  it('maps expired, invalid, used, and oauth codes', () => {
    expect(describePasswordResetLinkError({ code: 'EXPIRED_ACTION_CODE' }).kind).toBe('expired');
    expect(describePasswordResetLinkError({ code: 'INVALID_ACTION_CODE' }).kind).toBe('invalid');
    expect(describePasswordResetLinkError({ code: 'USED_ACTION_CODE' }).kind).toBe('used');
    expect(describePasswordResetLinkError({ code: 'OAUTH_RECOVERY_REQUIRED' }).kind).toBe('oauth');
  });

  it('validatePasswordResetLink throws distinct states from the API', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ code: 'USED_ACTION_CODE', state: 'used', error: 'already used' }),
    });
    await expect(validatePasswordResetLink('used')).rejects.toMatchObject({ kind: 'used' });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        state: 'oauth',
        code: 'OAUTH_RECOVERY_REQUIRED',
        message: 'Use provider',
      }),
    });
    await expect(validatePasswordResetLink('oauth')).rejects.toMatchObject({ kind: 'oauth' });
  });

  it('completePasswordReset enforces policy before calling the API', async () => {
    await expect(completePasswordReset('oob', 'weak')).rejects.toMatchObject({
      kind: 'weak_password',
      message: PASSWORD_POLICY_MESSAGE,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('completePasswordReset POSTs confirm API, signs out locally, and never auto-logs in', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        message: 'Password updated. All existing sessions have been revoked.',
        signedIn: false,
        sessionIssued: false,
        requiresMfa: true,
        email: 'jane@example.com',
      }),
    });
    mockSignOut.mockResolvedValueOnce(undefined);

    const result = await completePasswordReset(
      'oob-code',
      'Valid1@Password',
      'Valid1@Password'
    );

    expect(mockSignOut).toHaveBeenCalled();
    expect(result).toMatchObject({
      signedIn: false,
      sessionIssued: false,
      requiresMfa: true,
    });
  });

  it('completePasswordReset maps USED and OAUTH failures from confirm', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ code: 'USED_ACTION_CODE', state: 'used' }),
    });
    await expect(completePasswordReset('oob', 'Valid1@Password')).rejects.toMatchObject({
      kind: 'used',
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ code: 'OAUTH_RECOVERY_REQUIRED', state: 'oauth' }),
    });
    await expect(completePasswordReset('oob', 'Valid1@Password')).rejects.toMatchObject({
      kind: 'oauth',
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from 'firebase/auth';
import { verifyMfaCode } from './mfaVerify';
import { authFetch } from '../../config/authFetch';

vi.mock('../../config/authFetch', () => ({
  authFetch: vi.fn(),
}));

const mockAuthFetch = vi.mocked(authFetch);

describe('verifyMfaCode (US-004 S1-P1-10)', () => {
  const user = { uid: 'u1', email: 'jane@example.com' } as User;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts the challenge id and code on success', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        verified: true,
        message: 'Verification code accepted.',
      }),
    } as Response);

    const result = await verifyMfaCode(user, 'challenge-1', '123456');
    expect(result).toEqual({
      verified: true,
      message: 'Verification code accepted.',
    });
    expect(mockAuthFetch).toHaveBeenCalledWith(
      '/api/auth/mfa/verify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: 'challenge-1', code: '123456' }),
      },
      user
    );
  });

  it('throws with INVALID_OTP on wrong code', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'INVALID_OTP',
        error: 'Invalid verification code.',
      }),
    } as Response);

    await expect(verifyMfaCode(user, 'challenge-1', '000000')).rejects.toMatchObject({
      code: 'INVALID_OTP',
      message: 'Invalid verification code.',
    });
  });

  it('throws with OTP_EXPIRED on expired challenge', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'OTP_EXPIRED',
        error: 'This verification code has expired.',
      }),
    } as Response);

    await expect(verifyMfaCode(user, 'challenge-1', '123456')).rejects.toMatchObject({
      code: 'OTP_EXPIRED',
    });
  });
});

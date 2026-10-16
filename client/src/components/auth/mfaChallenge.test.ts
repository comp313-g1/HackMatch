import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from 'firebase/auth';
import { requestMfaChallenge } from './mfaChallenge';
import { authFetch } from '../../config/authFetch';

vi.mock('../../config/authFetch', () => ({
  authFetch: vi.fn(),
}));

const mockAuthFetch = vi.mocked(authFetch);

describe('requestMfaChallenge (US-004 AC 1)', () => {
  const user = { uid: 'u1', email: 'jane@example.com' } as User;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the challenge descriptor on success', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        requiresOtp: true,
        challengeId: 'c1',
        email: 'j***e@example.com',
        expiresInSeconds: 600,
        message: 'A 6-digit verification code has been sent to your email.',
      }),
    } as Response);

    const result = await requestMfaChallenge(user);
    expect(result.challengeId).toBe('c1');
    expect(mockAuthFetch).toHaveBeenCalledWith(
      '/api/auth/mfa/challenge',
      { method: 'POST' },
      user
    );
  });

  it('throws with server error code on delivery failure', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'EMAIL_DELIVERY_FAILED',
        error: 'Failed to dispatch verification code email. Please try again.',
      }),
    } as Response);

    await expect(requestMfaChallenge(user)).rejects.toMatchObject({
      code: 'EMAIL_DELIVERY_FAILED',
    });
  });

  it('throws ACCOUNT_LOCKED with retryAfter when the five-attempt lock is active', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'ACCOUNT_LOCKED',
        error: 'Account temporarily locked.',
        retryAfter: 900,
      }),
    } as Response);

    await expect(requestMfaChallenge(user)).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED',
      retryAfter: 900,
    });
  });
});

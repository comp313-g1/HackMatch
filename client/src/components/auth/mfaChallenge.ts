import type { User } from 'firebase/auth';
import { authFetch } from '../../config/authFetch';

export interface MfaChallengeResponse {
  requiresOtp: true;
  challengeId: string;
  email: string;
  expiresInSeconds: number;
  message: string;
}

/**
 * Asks the backend to generate and email a cryptographically random 6-digit OTP
 * after primary authentication (US-004 AC 1 / FR-009 / S1-P1-09).
 */
export async function requestMfaChallenge(user: User): Promise<MfaChallengeResponse> {
  const response = await authFetch('/api/auth/mfa/challenge', { method: 'POST' }, user);

  let body: { code?: string; error?: string; retryAfter?: number } & Partial<MfaChallengeResponse> =
    {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Ignore JSON parse failures; fall through to generic error.
  }

  if (!response.ok) {
    const code = typeof body.code === 'string' ? body.code : 'MFA_CHALLENGE_FAILED';
    const message =
      typeof body.error === 'string' && body.error
        ? body.error
        : 'Failed to send verification code. Please try again.';
    throw Object.assign(new Error(message), {
      code,
      retryAfter: typeof body.retryAfter === 'number' ? body.retryAfter : undefined,
    });
  }

  if (!body.challengeId || typeof body.challengeId !== 'string') {
    throw Object.assign(new Error('Failed to send verification code. Please try again.'), {
      code: 'MFA_CHALLENGE_FAILED',
    });
  }

  return {
    requiresOtp: true,
    challengeId: body.challengeId,
    email: typeof body.email === 'string' ? body.email : '',
    expiresInSeconds:
      typeof body.expiresInSeconds === 'number' ? body.expiresInSeconds : 600,
    message:
      typeof body.message === 'string'
        ? body.message
        : 'A 6-digit verification code has been sent to your email.',
  };
}

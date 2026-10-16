import type { User } from 'firebase/auth';
import { authFetch } from '../../config/authFetch';

export interface MfaVerifySuccess {
  verified: true;
  message: string;
}

/**
 * Submits a 6-digit OTP for the current challenge (US-004 / S1-P1-10).
 * Caller should refresh the ID token after success so MFA claims update.
 */
export async function verifyMfaCode(
  user: User,
  challengeId: string,
  code: string
): Promise<MfaVerifySuccess> {
  const response = await authFetch(
    '/api/auth/mfa/verify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, code }),
    },
    user
  );

  let body: { code?: string; error?: string; verified?: boolean; message?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // fall through
  }

  if (!response.ok) {
    const errCode = typeof body.code === 'string' ? body.code : 'MFA_VERIFY_FAILED';
    const message =
      typeof body.error === 'string' && body.error
        ? body.error
        : 'Verification failed. Please try again.';
    throw Object.assign(new Error(message), { code: errCode });
  }

  return {
    verified: true,
    message:
      typeof body.message === 'string'
        ? body.message
        : 'Verification code accepted. You can continue to your account.',
  };
}

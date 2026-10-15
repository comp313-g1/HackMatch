/**
 * Mirrors server/src/utils/mfaClaim.ts. The claim holds the `auth_time` of the sign-in
 * that completed the US-004 email OTP, so each new sign-in needs a new code.
 * This check only decides what the UI shows; the backend enforces it on every request.
 */
export const MFA_CLAIM = 'mfa_auth_time';

function toSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

export function hasCompletedMfa(claims: Record<string, unknown>): boolean {
  const mfaAuthTime = claims[MFA_CLAIM];
  const authTime = toSeconds(claims.auth_time);
  return (
    typeof mfaAuthTime === 'number' &&
    authTime !== null &&
    mfaAuthTime === authTime
  );
}

export type SessionErrorKind = 'network' | 'session-ended' | 'unknown';

export interface SessionError {
  kind: SessionErrorKind;
  message: string;
}

export function describeSessionError(error: unknown): SessionError {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  switch (code) {
    case 'auth/network-request-failed':
      return {
        kind: 'network',
        message: 'Network error. Please check your internet connection and try again.',
      };
    case 'auth/user-token-expired':
    case 'auth/invalid-user-token':
    case 'auth/user-disabled':
    case 'auth/user-not-found':
      return {
        kind: 'session-ended',
        message: 'Your session has ended. Please sign in again.',
      };
    default:
      return {
        kind: 'unknown',
        message: 'We could not check your session. Please try again.',
      };
  }
}

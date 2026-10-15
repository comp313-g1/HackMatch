import type { DecodedIdToken } from 'firebase-admin/auth';
import { firebaseAuth } from '../config/firebase.js';

/**
 * Custom claim recording which Firebase sign-in completed the US-004 email OTP.
 * Its value is the `auth_time` (seconds) of that sign-in. Refreshed tokens keep the
 * same `auth_time`, but every new sign-in gets a new one, so MFA is required again
 * on each login instead of being satisfied forever once the claim exists.
 */
export const MFA_CLAIM = 'mfa_auth_time';

export function hasCompletedMfa(decoded: DecodedIdToken): boolean {
  const mfaAuthTime: unknown = decoded[MFA_CLAIM];
  const authTime: unknown = decoded.auth_time;
  return (
    typeof mfaAuthTime === 'number' &&
    typeof authTime === 'number' &&
    Number.isFinite(authTime) &&
    mfaAuthTime === authTime
  );
}

/**
 * Records that the sign-in identified by `authTime` passed the email OTP, keeping
 * other custom claims such as `role`. The client must refresh its ID token afterwards.
 * Intended to be called by the US-004 OTP verification endpoint after the code is consumed.
 */
export async function markMfaComplete(uid: string, authTime: number): Promise<void> {
  if (!Number.isFinite(authTime) || authTime <= 0) {
    throw new Error('markMfaComplete requires the auth_time of the verified sign-in.');
  }
  const user = await firebaseAuth.getUser(uid);
  const existing = (user.customClaims ?? {}) as Record<string, unknown>;
  await firebaseAuth.setCustomUserClaims(uid, { ...existing, [MFA_CLAIM]: authTime });
}

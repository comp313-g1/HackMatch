/**
 * Password-reset link validation + confirm (US-005 AC 2–3 / FR-011 / S1-P1-14).
 * Uses Firebase Client SDK: verifyPasswordResetCode → confirmPasswordReset.
 * Does not create a session (US-005 AC 4 — next login still requires MFA).
 */

import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { PASSWORD_POLICY_MESSAGE, validatePassword } from './validation';

export type PasswordResetLinkErrorKind =
  | 'expired'
  | 'invalid'
  | 'network'
  | 'weak_password'
  | 'unknown';

export interface PasswordResetLinkError {
  kind: PasswordResetLinkErrorKind;
  message: string;
  code?: string;
}

export function describePasswordResetLinkError(err: unknown): PasswordResetLinkError {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';

  switch (code) {
    case 'auth/expired-action-code':
      return {
        kind: 'expired',
        code,
        message:
          'This password reset link has expired. Please request a new link to continue.',
      };
    case 'auth/invalid-action-code':
      return {
        kind: 'invalid',
        code,
        message:
          'This password reset link is invalid or has already been used. Please request a new link.',
      };
    case 'auth/network-request-failed':
      return {
        kind: 'network',
        code,
        message: 'Network error. Please check your internet connection and try again.',
      };
    case 'auth/weak-password':
      return {
        kind: 'weak_password',
        code,
        message: PASSWORD_POLICY_MESSAGE,
      };
    case 'auth/user-disabled':
      return {
        kind: 'invalid',
        code,
        message: 'This account has been disabled. Please contact support.',
      };
    case 'auth/user-not-found':
      return {
        kind: 'invalid',
        code,
        message: 'This password reset link is invalid or has already been used. Please request a new link.',
      };
    default:
      if (err && typeof err === 'object' && 'kind' in err && 'message' in err) {
        return err as PasswordResetLinkError;
      }
      return {
        kind: 'unknown',
        code: code || undefined,
        message: 'We could not reset your password right now. Please try again.',
      };
  }
}

function throwLinkError(err: unknown): never {
  const described = describePasswordResetLinkError(err);
  throw Object.assign(new Error(described.message), described);
}

/**
 * Validates a Firebase password-reset oobCode and returns the account email.
 * Rejects expired, invalid, and already-used codes (FR-011 / US-005 AC 2).
 */
export async function validatePasswordResetLink(oobCode: string): Promise<string> {
  const code = oobCode.trim();
  if (!code) {
    throwLinkError({
      kind: 'invalid',
      message:
        'This password reset link is invalid or has already been used. Please request a new link.',
      code: 'auth/invalid-action-code',
    });
  }

  try {
    return await verifyPasswordResetCode(auth, code);
  } catch (err: unknown) {
    throwLinkError(err);
  }
}

/**
 * Applies a new password for a validated reset oobCode.
 * Client policy is checked first; Firebase enforces again server-side.
 */
export async function completePasswordReset(
  oobCode: string,
  newPassword: string
): Promise<void> {
  const policyError = validatePassword(newPassword);
  if (policyError) {
    throw Object.assign(new Error(policyError), {
      kind: 'weak_password' as const,
      message: policyError,
      code: 'auth/weak-password',
    } satisfies PasswordResetLinkError);
  }

  try {
    await confirmPasswordReset(auth, oobCode.trim(), newPassword);
  } catch (err: unknown) {
    throwLinkError(err);
  }
}

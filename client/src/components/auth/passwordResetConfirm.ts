/**
 * Password-reset link validation + confirm (US-005 AC 2–4 / FR-011 / FR-012 / S1-P1-14 / S1-P2-14).
 * Link preview uses Firebase Client verifyPasswordResetCode.
 * Confirm + global session revocation go through POST /api/auth/password-reset/confirm.
 * Does not create a session (next login still requires MFA).
 */

import { signOut, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { PASSWORD_POLICY_MESSAGE, validatePassword } from './validation';

export interface PasswordResetConfirmResult {
  signedIn: false;
  sessionIssued: false;
  requiresMfa: true;
  email?: string;
  message?: string;
}

export type PasswordResetLinkErrorKind =
  | 'expired'
  | 'invalid'
  | 'network'
  | 'weak_password'
  | 'revocation_failed'
  | 'unknown';

export interface PasswordResetLinkError {
  kind: PasswordResetLinkErrorKind;
  message: string;
  code?: string;
}

export function describePasswordResetLinkError(err: unknown): PasswordResetLinkError {
  if (err && typeof err === 'object' && 'kind' in err && 'message' in err) {
    return err as PasswordResetLinkError;
  }

  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';

  switch (code) {
    case 'auth/expired-action-code':
    case 'EXPIRED_ACTION_CODE':
      return {
        kind: 'expired',
        code,
        message:
          'This password reset link has expired. Please request a new link to continue.',
      };
    case 'auth/invalid-action-code':
    case 'INVALID_ACTION_CODE':
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
    case 'WEAK_PASSWORD':
      return {
        kind: 'weak_password',
        code,
        message: PASSWORD_POLICY_MESSAGE,
      };
    case 'REVOCATION_FAILED':
      return {
        kind: 'revocation_failed',
        code,
        message:
          'Your password was updated, but we could not sign out other devices. Please try signing in again or contact support if sessions remain active.',
      };
    case 'auth/user-disabled':
    case 'USER_DISABLED':
      return {
        kind: 'invalid',
        code,
        message: 'This account has been disabled. Please contact support.',
      };
    case 'auth/user-not-found':
      return {
        kind: 'invalid',
        code,
        message:
          'This password reset link is invalid or has already been used. Please request a new link.',
      };
    default:
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
 * Confirms the reset via the Express API (password replace + revoke + clear MFA claim).
 * Authorization is possession of a valid oobCode; never auto-logs in (S1-P2-15).
 */
export async function completePasswordReset(
  oobCode: string,
  newPassword: string,
  confirmPassword?: string
): Promise<PasswordResetConfirmResult> {
  const policyError = validatePassword(newPassword);
  if (policyError) {
    throw Object.assign(new Error(policyError), {
      kind: 'weak_password' as const,
      message: policyError,
      code: 'auth/weak-password',
    } satisfies PasswordResetLinkError);
  }

  let response: Response;
  try {
    response = await fetch('/api/auth/password-reset/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        oobCode: oobCode.trim(),
        newPassword,
        ...(confirmPassword !== undefined ? { confirmPassword } : {}),
      }),
    });
  } catch {
    throwLinkError({
      kind: 'network',
      message: 'Network error. Please check your internet connection and try again.',
      code: 'auth/network-request-failed',
    });
  }

  const data = (await response.json().catch(() => null)) as {
    message?: string;
    error?: string;
    code?: string;
    email?: string;
    signedIn?: boolean;
    sessionIssued?: boolean;
    requiresMfa?: boolean;
    errors?: { newPassword?: string; confirmPassword?: string; oobCode?: string };
  } | null;

  if (response.ok) {
    // Defensive: ensure the browser has no Firebase client session after reset.
    try {
      await signOut(auth);
    } catch {
      // Ignore sign-out failures; server already revoked refresh tokens.
    }

    return {
      signedIn: false,
      sessionIssued: false,
      requiresMfa: true,
      email: data?.email,
      message: data?.message,
    };
  }

  if (response.status === 400 && data?.errors?.newPassword) {
    throwLinkError({
      kind: 'weak_password',
      message: data.errors.newPassword,
      code: data.code || 'WEAK_PASSWORD',
    });
  }

  if (data?.code === 'EXPIRED_ACTION_CODE' || response.status === 410) {
    throwLinkError({
      kind: 'expired',
      message:
        data?.error ||
        'This password reset link has expired. Please request a new link to continue.',
      code: 'EXPIRED_ACTION_CODE',
    });
  }

  if (data?.code === 'INVALID_ACTION_CODE') {
    throwLinkError({
      kind: 'invalid',
      message:
        data?.error ||
        'This password reset link is invalid or has already been used. Please request a new link.',
      code: 'INVALID_ACTION_CODE',
    });
  }

  if (data?.code === 'REVOCATION_FAILED') {
    throwLinkError({
      kind: 'revocation_failed',
      message:
        data?.error ||
        'Your password was updated, but we could not sign out other devices. Please try signing in again or contact support if sessions remain active.',
      code: 'REVOCATION_FAILED',
    });
  }

  throwLinkError({
    kind: 'unknown',
    message: data?.error || 'We could not reset your password right now. Please try again.',
    code: data?.code,
  });
}

/**
 * Password-reset link validation + confirm (US-005 / FR-011 / FR-012 / S1-P1-14 / S1-P2-14–16).
 * Validate/classify via POST /api/auth/password-reset/validate (expired|invalid|used|oauth|valid).
 * Confirm + revoke via POST /api/auth/password-reset/confirm. Never auto-logs in.
 */

import { signOut } from 'firebase/auth';
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
  | 'used'
  | 'oauth'
  | 'network'
  | 'weak_password'
  | 'revocation_failed'
  | 'unknown';

export interface PasswordResetLinkError {
  kind: PasswordResetLinkErrorKind;
  message: string;
  code?: string;
}

export type PasswordResetLinkState = 'valid' | 'expired' | 'invalid' | 'used' | 'oauth';

export interface PasswordResetValidateResult {
  state: 'valid';
  email: string;
  accountType: 'credential';
}

export const PASSWORD_RESET_STATE_COPY: Record<
  Exclude<PasswordResetLinkState, 'valid'>,
  { title: string; message: string }
> = {
  expired: {
    title: 'Reset link expired',
    message:
      'This password reset link has expired. Please request a new link to continue.',
  },
  invalid: {
    title: 'Reset link invalid',
    message:
      'This password reset link is invalid or has been tampered with. Please request a new link.',
  },
  used: {
    title: 'Reset link already used',
    message:
      'This password reset link has already been used. Request a new link if you still need to change your password.',
  },
  oauth: {
    title: 'Use your sign-in provider',
    message:
      'This account signs in with Google or GitHub. Use that provider to regain access — a password cannot be set from this link.',
  },
};

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
        message: PASSWORD_RESET_STATE_COPY.expired.message,
      };
    case 'USED_ACTION_CODE':
      return {
        kind: 'used',
        code,
        message: PASSWORD_RESET_STATE_COPY.used.message,
      };
    case 'auth/invalid-action-code':
    case 'INVALID_ACTION_CODE':
      return {
        kind: 'invalid',
        code,
        message: PASSWORD_RESET_STATE_COPY.invalid.message,
      };
    case 'OAUTH_RECOVERY_REQUIRED':
      return {
        kind: 'oauth',
        code,
        message: PASSWORD_RESET_STATE_COPY.oauth.message,
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
 * Validates a Firebase password-reset oobCode via the Express API.
 * Throws typed errors for expired / invalid / used / oauth (US-005 S1-P2-16).
 */
export async function validatePasswordResetLink(
  oobCode: string
): Promise<PasswordResetValidateResult> {
  const code = oobCode.trim();
  if (!code) {
    throwLinkError({
      kind: 'invalid',
      message: PASSWORD_RESET_STATE_COPY.invalid.message,
      code: 'INVALID_ACTION_CODE',
    });
  }

  let response: Response;
  try {
    response = await fetch('/api/auth/password-reset/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oobCode: code }),
    });
  } catch {
    throwLinkError({
      kind: 'network',
      message: 'Network error. Please check your internet connection and try again.',
      code: 'auth/network-request-failed',
    });
  }

  const data = (await response.json().catch(() => null)) as {
    state?: string;
    email?: string;
    accountType?: string;
    message?: string;
    error?: string;
    code?: string;
  } | null;

  if (response.ok && data?.state === 'valid' && data.email) {
    return {
      state: 'valid',
      email: data.email,
      accountType: 'credential',
    };
  }

  if (response.ok && data?.state === 'oauth') {
    throwLinkError({
      kind: 'oauth',
      message: data.message || PASSWORD_RESET_STATE_COPY.oauth.message,
      code: data.code || 'OAUTH_RECOVERY_REQUIRED',
    });
  }

  if (data?.code === 'EXPIRED_ACTION_CODE' || data?.state === 'expired') {
    throwLinkError({
      kind: 'expired',
      message: data.error || PASSWORD_RESET_STATE_COPY.expired.message,
      code: 'EXPIRED_ACTION_CODE',
    });
  }

  if (data?.code === 'USED_ACTION_CODE' || data?.state === 'used') {
    throwLinkError({
      kind: 'used',
      message: data.error || PASSWORD_RESET_STATE_COPY.used.message,
      code: 'USED_ACTION_CODE',
    });
  }

  if (data?.code === 'INVALID_ACTION_CODE' || data?.state === 'invalid') {
    throwLinkError({
      kind: 'invalid',
      message: data.error || PASSWORD_RESET_STATE_COPY.invalid.message,
      code: 'INVALID_ACTION_CODE',
    });
  }

  if (data?.code === 'OAUTH_RECOVERY_REQUIRED') {
    throwLinkError({
      kind: 'oauth',
      message: data.error || PASSWORD_RESET_STATE_COPY.oauth.message,
      code: 'OAUTH_RECOVERY_REQUIRED',
    });
  }

  throwLinkError({
    kind: 'unknown',
    message: data?.error || 'We could not validate this reset link right now. Please try again.',
    code: data?.code,
  });
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
    state?: string;
    email?: string;
    signedIn?: boolean;
    sessionIssued?: boolean;
    requiresMfa?: boolean;
    errors?: { newPassword?: string; confirmPassword?: string; oobCode?: string };
  } | null;

  if (response.ok) {
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

  if (data?.code === 'EXPIRED_ACTION_CODE' || data?.state === 'expired') {
    throwLinkError({
      kind: 'expired',
      message: data?.error || PASSWORD_RESET_STATE_COPY.expired.message,
      code: 'EXPIRED_ACTION_CODE',
    });
  }

  if (data?.code === 'USED_ACTION_CODE' || data?.state === 'used') {
    throwLinkError({
      kind: 'used',
      message: data?.error || PASSWORD_RESET_STATE_COPY.used.message,
      code: 'USED_ACTION_CODE',
    });
  }

  if (data?.code === 'INVALID_ACTION_CODE' || data?.state === 'invalid') {
    throwLinkError({
      kind: 'invalid',
      message: data?.error || PASSWORD_RESET_STATE_COPY.invalid.message,
      code: 'INVALID_ACTION_CODE',
    });
  }

  if (data?.code === 'OAUTH_RECOVERY_REQUIRED' || data?.state === 'oauth') {
    throwLinkError({
      kind: 'oauth',
      message: data?.error || PASSWORD_RESET_STATE_COPY.oauth.message,
      code: 'OAUTH_RECOVERY_REQUIRED',
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

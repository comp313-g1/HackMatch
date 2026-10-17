/**
 * Password-recovery request (US-005 AC 1–2 / FR-011 / S1-P1-12).
 * Always surfaces a uniform confirmation for known and unknown addresses so
 * the UI never reveals whether an account exists (email enumeration protection).
 */

import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../config/firebase';

/** Shown for every successful or “unknown email” outcome — never account-specific. */
export const GENERIC_PASSWORD_RECOVERY_CONFIRMATION =
  'If an account exists for that email, you will receive password reset instructions shortly. If you signed in with Google or GitHub, use that provider to regain access.';

export type PasswordRecoveryRequestErrorKind = 'network' | 'throttled' | 'invalid_email' | 'unknown';

export interface PasswordRecoveryRequestError {
  kind: PasswordRecoveryRequestErrorKind;
  message: string;
  code?: string;
}

function buildContinueUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const url = new URL(window.location.origin);
  url.searchParams.set('mode', 'resetPassword');
  url.searchParams.set('view', 'login');
  return url.toString();
}

export function describePasswordRecoveryRequestError(err: unknown): PasswordRecoveryRequestError {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';

  switch (code) {
    case 'auth/invalid-email':
      return {
        kind: 'invalid_email',
        code,
        message: 'Please enter a valid email address.',
      };
    case 'auth/too-many-requests':
      return {
        kind: 'throttled',
        code,
        message: 'Too many reset requests. Please wait a few minutes before trying again.',
      };
    case 'auth/network-request-failed':
      return {
        kind: 'network',
        code,
        message: 'Network error. Please check your internet connection and try again.',
      };
    default:
      return {
        kind: 'unknown',
        code: code || undefined,
        message: 'We could not send a reset email right now. Please try again.',
      };
  }
}

/**
 * Asks Firebase to email a password-reset link.
 * Treats missing accounts as success so the confirmation stays generic (US-005 AC 2).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const continueUrl = buildContinueUrl();

  try {
    await sendPasswordResetEmail(
      auth,
      normalized,
      continueUrl
        ? {
            url: continueUrl,
            handleCodeInApp: false,
          }
        : undefined
    );
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';
    // Enumeration-safe: unknown addresses must look like success.
    if (code === 'auth/user-not-found') {
      return;
    }
    const described = describePasswordRecoveryRequestError(err);
    throw Object.assign(new Error(described.message), described);
  }
}

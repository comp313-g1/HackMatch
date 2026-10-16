import { validateEmail } from './validation';

export interface LoginValidationErrors {
  email?: string;
  password?: string;
}

/**
 * Only checks that the fields are present and the email is well formed.
 * The password policy is deliberately not re-checked at login (US-003 AC 1).
 */
export function validateLoginInput(email: string, password: string): LoginValidationErrors {
  const errors: LoginValidationErrors = {};
  const emailError = validateEmail(email);
  if (emailError) {
    errors.email = emailError;
  }
  if (!password) {
    errors.password = 'Password is required.';
  }
  return errors;
}

export const GENERIC_CREDENTIALS_ERROR = 'Incorrect email or password. Please try again.';

export const ACCOUNT_SUSPENDED_ERROR =
  'This account has been suspended and cannot sign in. Please contact support.';

export type LoginErrorKind =
  | 'credentials'
  | 'throttled'
  | 'disabled'
  | 'suspended'
  | 'locked'
  | 'otp_delivery'
  | 'network'
  | 'unknown';

export interface LoginError {
  kind: LoginErrorKind;
  message: string;
}

/** Credential failures that must never reveal whether the email exists (US-003 AC 1 / T2). */
const CREDENTIAL_ERROR_CODES = new Set([
  'auth/invalid-credential',
  'auth/invalid-login-credentials',
  'auth/wrong-password',
  'auth/user-not-found',
  'auth/invalid-email',
  'auth/missing-password',
  'auth/invalid-password',
]);

/**
 * Maps Firebase / server sign-in errors to user-facing messages. Every credential failure
 * returns the same text so the UI never reveals whether an account exists (US-003 AC 1).
 */
export function describeLoginError(error: unknown): LoginError {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  if (CREDENTIAL_ERROR_CODES.has(code)) {
    return { kind: 'credentials', message: GENERIC_CREDENTIALS_ERROR };
  }

  switch (code) {
    case 'auth/too-many-requests':
      return {
        kind: 'throttled',
        message:
          'Too many unsuccessful sign-in attempts. Please wait a few minutes before trying again, or reset your password.',
      };
    case 'auth/user-disabled':
    case 'ACCOUNT_DISABLED':
      return {
        kind: 'disabled',
        message: 'This account cannot sign in right now. Please contact support if you think this is a mistake.',
      };
    case 'ACCOUNT_SUSPENDED':
      return { kind: 'suspended', message: ACCOUNT_SUSPENDED_ERROR };
    case 'ACCOUNT_LOCKED':
      return {
        kind: 'locked',
        message:
          error && typeof error === 'object' && 'message' in error
            ? String((error as { message: unknown }).message)
            : 'Account temporarily locked due to too many failed OTP attempts. Please wait before trying again.',
      };
    case 'RATE_LIMITED':
      return {
        kind: 'throttled',
        message:
          error && typeof error === 'object' && 'message' in error
            ? String((error as { message: unknown }).message)
            : 'Too many OTP requests. Please wait before requesting another code.',
      };
    case 'EMAIL_DELIVERY_FAILED':
    case 'MFA_CHALLENGE_FAILED':
      return {
        kind: 'otp_delivery',
        message:
          error && typeof error === 'object' && 'message' in error
            ? String((error as { message: unknown }).message)
            : "We couldn't send your verification code. Please try signing in again.",
      };
    case 'EMAIL_NOT_VERIFIED':
      return {
        kind: 'unknown',
        message: 'A verified email is required before a login code can be sent.',
      };
    case 'auth/network-request-failed':
      return {
        kind: 'network',
        message: 'Network error. Please check your internet connection and try again.',
      };
    default:
      return { kind: 'unknown', message: 'Sign-in failed. Please try again.' };
  }
}

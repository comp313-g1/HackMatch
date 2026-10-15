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

export type LoginErrorKind = 'credentials' | 'throttled' | 'disabled' | 'network' | 'unknown';

export interface LoginError {
  kind: LoginErrorKind;
  message: string;
}

/**
 * Maps Firebase sign-in errors to user-facing messages. Every credential failure
 * returns the same text so the UI never reveals whether an account exists (US-003 AC 1).
 */
export function describeLoginError(error: unknown): LoginError {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return { kind: 'credentials', message: GENERIC_CREDENTIALS_ERROR };
    case 'auth/too-many-requests':
      return {
        kind: 'throttled',
        message:
          'Too many unsuccessful sign-in attempts. Please wait a few minutes before trying again, or reset your password.',
      };
    case 'auth/user-disabled':
      return {
        kind: 'disabled',
        message: 'This account cannot sign in right now. Please contact support if you think this is a mistake.',
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

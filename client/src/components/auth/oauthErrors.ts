/**
 * Server-side OAuth sign-in error code mapping (issue #30 / US-002 AC2).
 *
 * The backend `POST /api/auth/oauth/sign-in` handler
 * (`server/src/controllers/auth.controller.ts`) can reject a request with any of
 * eight `code` values. This module is the single place that turns those codes
 * into user-actionable copy.
 *
 * Layering note: Firebase *client* errors are translated separately by
 * `translateAuthError` in `client/src/config/firebase.ts`. The two mappings are
 * disjoint and never overwrite each other.
 *
 * Pure function — no DOM, no network — so it is trivially unit-testable.
 */

export type OAuthServerCode =
  | 'PROVIDER_MISMATCH'
  | 'INVALID_TOKEN'
  | 'UNVERIFIED_PROVIDER_EMAIL'
  | 'ADMIN_OAUTH_PROHIBITED'
  | 'LINKING_REAUTHENTICATION_REQUIRED'
  | 'ACCOUNT_LOCKED'
  | 'RATE_LIMITED'
  | 'EMAIL_DELIVERY_FAILED';

/** Fallback used for unknown/missing codes so the UI never renders an empty error. */
export const OAUTH_GENERIC_FAILURE_MESSAGE = 'Sign-in failed. Please try again.';

/**
 * Translates a server-returned OAuth error `code` into a user-actionable message.
 *
 * @param code         The `code` field from the server error body. Undefined for
 *                     plain HTTP failures (e.g. a 502 with no body) — the generic
 *                     fallback is returned in that case.
 * @param retryAfter   Seconds until the caller may retry. Used by
 *                     `ACCOUNT_LOCKED` (rendered in minutes) and `RATE_LIMITED`
 *                     (rendered in seconds).
 */
export function translateOAuthServerError(code?: string, retryAfter?: number): string {
  switch (code) {
    case 'PROVIDER_MISMATCH':
      return 'The selected provider does not match your sign-in credential. Please try again.';
    case 'INVALID_TOKEN':
      return 'Your sign-in credential has expired. Please sign in again.';
    case 'UNVERIFIED_PROVIDER_EMAIL':
      return 'A verified provider email is required. Please sign up using email registration instead.';
    case 'ADMIN_OAUTH_PROHIBITED':
      return 'Public sign-in cannot be used for administrator accounts.';
    case 'LINKING_REAUTHENTICATION_REQUIRED':
      return 'This email is already registered. Please sign in with your password, then link this provider.';
    case 'ACCOUNT_LOCKED': {
      const minutes = Math.max(1, Math.ceil((retryAfter ?? 0) / 60));
      return `Your account is temporarily locked after too many failed attempts. Please try again in about ${minutes} minute${
        minutes === 1 ? '' : 's'
      }.`;
    }
    case 'RATE_LIMITED': {
      const seconds = Math.max(1, Math.ceil(retryAfter ?? 0));
      return `Too many requests. Please try again in about ${seconds} second${
        seconds === 1 ? '' : 's'
      }.`;
    }
    case 'EMAIL_DELIVERY_FAILED':
      return "We couldn't send the verification email. Please try again.";
    default:
      return OAUTH_GENERIC_FAILURE_MESSAGE;
  }
}

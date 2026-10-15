/**
 * Core provider sign-in logic for issue #30 / US-002 AC2.
 *
 * Responsibility: run the Firebase popup, pre-judge the provider email
 * (UX only — NOT a security boundary), exchange the ID token for an OTP
 * challenge, and normalise every possible outcome into a single union so the
 * view layer has no branching on HTTP details.
 *
 * Red lines enforced here:
 *  - The client-side `emailVerified` pre-check is UX only. The server 403
 *    `UNVERIFIED_PROVIDER_EMAIL` remains authoritative and is re-checked below
 *    even when the pre-check passed.
 *  - No session/token/cookie is ever created. Success merely surfaces an OTP
 *    challenge for US-004 to consume.
 *  - The request payload carries exactly { idToken, provider, consentHandleAvatar }.
 *    No role/admin/claims fields are ever attached.
 *  - Firebase `User` uses camelCase `emailVerified`; `email_verified` is the
 *    ID-token claim name and is intentionally never read on the client.
 */

import { signInWithPopup, type User } from 'firebase/auth';
import {
  auth,
  googleProvider,
  githubProvider,
  translateAuthError,
} from '../../config/firebase';
import { translateOAuthServerError } from './oauthErrors';

export type ProviderKind = 'google' | 'github';

export interface OtpChallenge {
  challengeId: string;
  /** Masked email address as returned by the server (e.g. `j***e@example.com`). */
  email: string;
  expiresInSeconds: number;
  message: string;
}

export type ProviderSignInOutcome =
  | { status: 'requires_otp'; challenge: OtpChallenge }
  | { status: 'unverified_email'; email: string | null }
  | { status: 'empty_email' }
  /**
   * Field-level rejection (HTTP 400 with an `{ errors }` body). Kept distinct
   * from `error` so the view can render an inline, field-scoped message rather
   * than a form-level alert. Additive to the brief's union so the five UI
   * states (loading/success/validation/empty/error) are all reachable.
   */
  | { status: 'validation'; message: string; retryable: boolean }
  | { status: 'error'; message: string; retryable: boolean };

/** Shape of the `/api/auth/oauth/sign-in` JSON body (success or error). */
interface OAuthSignInResponseBody {
  requiresOtp?: boolean;
  challengeId?: string;
  email?: string;
  expiresInSeconds?: number;
  message?: string;
  error?: string;
  code?: string;
  retryAfter?: number;
  errors?: Record<string, string>;
}

const NETWORK_ERROR_MESSAGE = 'Network error. Please check your internet connection.';

/** Returns the first non-empty field error message from a validation body. */
function firstFieldError(errors: Record<string, string> | undefined): string | undefined {
  if (!errors) return undefined;
  for (const value of Object.values(errors)) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Runs the Google/GitHub popup flow and normalises the result.
 *
 * Order of operations is fixed:
 *  1. `signInWithPopup` (Firebase errors → `translateAuthError`).
 *  2. Pre-judge `user.email` / `user.emailVerified` (divert early, skip network).
 *  3. `getIdToken()`.
 *  4. `POST /api/auth/oauth/sign-in`.
 *  5. Normalise the response matrix, re-diverting on server-side 403.
 */
export async function signInWithProvider(
  provider: ProviderKind,
  opts?: { consentHandleAvatar?: boolean }
): Promise<ProviderSignInOutcome> {
  const providerInstance = provider === 'github' ? githubProvider : googleProvider;

  // 1. Firebase popup. Cancellation / blocked popup / network failures land here.
  let user: User;
  try {
    const result = await signInWithPopup(auth, providerInstance);
    user = result.user;
  } catch (error) {
    return { status: 'error', message: translateAuthError(error), retryable: true };
  }

  // 2. Pre-judgement (UX only, no network round-trip when it already fails).
  if (!user.email) {
    return { status: 'empty_email' };
  }
  if (user.emailVerified === false) {
    return { status: 'unverified_email', email: user.email };
  }

  // 3. Exchange the credential for an ID token.
  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch (error) {
    return { status: 'error', message: translateAuthError(error), retryable: true };
  }

  // 4. Call the backend (contract: { idToken, provider, consentHandleAvatar }).
  let response: Response;
  try {
    response = await fetch('/api/auth/oauth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken,
        provider,
        consentHandleAvatar: Boolean(opts?.consentHandleAvatar),
      }),
    });
  } catch {
    return { status: 'error', message: NETWORK_ERROR_MESSAGE, retryable: true };
  }

  const data = (await response.json().catch(() => null)) as OAuthSignInResponseBody | null;

  // 5. Normalise the response matrix.
  if (response.ok && data?.requiresOtp) {
    return {
      status: 'requires_otp',
      challenge: {
        challengeId: data.challengeId ?? '',
        email: data.email ?? user.email ?? '',
        expiresInSeconds: data.expiresInSeconds ?? 600,
        message: data.message ?? '',
      },
    };
  }

  // Red line: server is the authority. Re-divert even when the pre-check passed.
  if (response.status === 403 && data?.code === 'UNVERIFIED_PROVIDER_EMAIL') {
    return { status: 'unverified_email', email: user.email };
  }

  // Field-level validation (400 + { errors }).
  if (response.status === 400 && data?.errors) {
    return {
      status: 'validation',
      message: firstFieldError(data.errors) ?? 'Please check your input and try again.',
      retryable: true,
    };
  }

  const code = data?.code;
  const retryAfter = typeof data?.retryAfter === 'number' ? data.retryAfter : undefined;

  return {
    status: 'error',
    message: translateOAuthServerError(code, retryAfter),
    // Non-retryable only when retrying cannot possibly help (policy rejections).
    retryable:
      code !== 'ADMIN_OAUTH_PROHIBITED' && code !== 'LINKING_REAUTHENTICATION_REQUIRED',
  };
}

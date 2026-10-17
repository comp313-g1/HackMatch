/**
 * Password-recovery request (US-005 AC 1–2 / FR-011 / S1-P1-12–13).
 * Calls the Express password-reset API so Firebase Admin / Identity Toolkit
 * dispatches the reset email server-side with rate limits and anti-enumeration.
 */

/** Shown for every successful or “unknown email” outcome — never account-specific. */
export const GENERIC_PASSWORD_RECOVERY_CONFIRMATION =
  'If an account exists for that email, you will receive password reset instructions shortly. If you signed in with Google or GitHub, use that provider to regain access.';

export type PasswordRecoveryRequestErrorKind =
  | 'network'
  | 'throttled'
  | 'invalid_email'
  | 'delivery'
  | 'unknown';

export interface PasswordRecoveryRequestError {
  kind: PasswordRecoveryRequestErrorKind;
  message: string;
  code?: string;
}

function throwRecoveryError(
  kind: PasswordRecoveryRequestErrorKind,
  message: string,
  code?: string
): never {
  throw Object.assign(new Error(message), { kind, message, code } satisfies PasswordRecoveryRequestError);
}

export function describePasswordRecoveryRequestError(err: unknown): PasswordRecoveryRequestError {
  if (err && typeof err === 'object' && 'kind' in err && 'message' in err) {
    const typed = err as PasswordRecoveryRequestError;
    return {
      kind: typed.kind,
      message: typed.message,
      code: typed.code,
    };
  }

  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';

  switch (code) {
    case 'auth/invalid-email':
    case 'INVALID_EMAIL':
      return {
        kind: 'invalid_email',
        code,
        message: 'Please enter a valid email address.',
      };
    case 'auth/too-many-requests':
    case 'RATE_LIMITED':
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
    case 'EMAIL_DELIVERY_FAILED':
      return {
        kind: 'delivery',
        code,
        message: 'We could not send a reset email right now. Please try again.',
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
 * Requests a password-reset email via POST /api/auth/password-reset.
 * Uniform 200 responses (known, unknown, OAuth-only) resolve successfully
 * so the UI always shows the generic confirmation (US-005 AC 2).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();

  let response: Response;
  try {
    response = await fetch('/api/auth/password-reset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: normalized }),
    });
  } catch {
    throwRecoveryError(
      'network',
      'Network error. Please check your internet connection and try again.',
      'auth/network-request-failed'
    );
  }

  const data = (await response.json().catch(() => null)) as {
    message?: string;
    error?: string;
    code?: string;
    errors?: { email?: string };
    retryAfter?: number;
  } | null;

  if (response.ok) {
    return;
  }

  if (response.status === 429 || data?.code === 'RATE_LIMITED') {
    throwRecoveryError(
      'throttled',
      data?.error ||
        'Too many reset requests. Please wait a few minutes before trying again.',
      'RATE_LIMITED'
    );
  }

  if (response.status === 400 && data?.errors?.email) {
    throwRecoveryError('invalid_email', data.errors.email, 'INVALID_EMAIL');
  }

  if (response.status === 502 || data?.code === 'EMAIL_DELIVERY_FAILED') {
    throwRecoveryError(
      'delivery',
      data?.error || 'We could not send a reset email right now. Please try again.',
      'EMAIL_DELIVERY_FAILED'
    );
  }

  throwRecoveryError(
    'unknown',
    data?.error || 'We could not send a reset email right now. Please try again.',
    data?.code
  );
}

import { getIdToken, signOut, type User } from 'firebase/auth';
import { auth } from '../../config/firebase';

export type LogoutErrorKind = 'network' | 'csrf' | 'revocation' | 'unknown';

export interface LogoutError {
  kind: LogoutErrorKind;
  message: string;
  code?: string;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

const SOFT_SESSION_CODES = new Set([
  'NO_SESSION',
  'UNAUTHORIZED',
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
  'TOKEN_REVOKED',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'INVALID_SESSION',
]);

function describeLogoutFailure(status: number, code: string | undefined): LogoutError {
  if (code === 'CSRF_TOKEN_INVALID' || code === 'ORIGIN_NOT_ALLOWED') {
    return {
      kind: 'csrf',
      code,
      message: 'Security check failed. Please refresh the page and try again.',
    };
  }
  if (code === 'REVOCATION_FAILED' || code === 'AUTH_SERVICE_UNAVAILABLE') {
    return {
      kind: 'revocation',
      code,
      message:
        'You were signed out on this device, but other devices may still be signed in. Please try again.',
    };
  }
  return {
    kind: 'unknown',
    code,
    message:
      status >= 500
        ? 'Sign-out failed on the server. Please try again.'
        : 'Sign-out failed. Please try again.',
  };
}

/**
 * Server-side logout with Firebase refresh-token revocation (US-003 AC 5), then local
 * Firebase sign-out. Soft "already signed out" API responses still clear the local SDK
 * session and succeed. Hard failures clear the local session too, then throw.
 */
export async function logout(user: User | null = auth.currentUser): Promise<void> {
  const headers: Record<string, string> = {};
  const csrf = readCookie('hm_csrf');
  if (csrf) {
    headers['X-CSRF-Token'] = csrf;
  }

  if (user) {
    try {
      headers.Authorization = `Bearer ${await getIdToken(user, false)}`;
    } catch {
      // Cookie session alone may still authorize logout.
    }
  }

  let apiError: LogoutError | null = null;

  try {
    const response = await fetch('/api/auth/session', {
      method: 'DELETE',
      credentials: 'include',
      headers,
    });

    if (!response.ok) {
      let code: string | undefined;
      try {
        const body = (await response.json()) as { code?: unknown };
        code = typeof body.code === 'string' ? body.code : undefined;
      } catch {
        code = undefined;
      }

      if (!code || !SOFT_SESSION_CODES.has(code)) {
        apiError = describeLogoutFailure(response.status, code);
      }
    }
  } catch {
    apiError = {
      kind: 'network',
      message: 'Network error while signing out. Please check your connection and try again.',
    };
  }

  try {
    await signOut(auth);
  } catch (signOutErr: unknown) {
    if (!apiError) {
      throw signOutErr;
    }
  }

  if (apiError) {
    throw Object.assign(new Error(apiError.message), apiError);
  }
}

import type { Request, Response, NextFunction } from 'express';
import { firebaseAuth } from '../config/firebase.js';

/** Firebase ID tokens are ~1 KB; anything far larger is rejected before verification. */
const MAX_TOKEN_LENGTH = 4096;

export type AuthFailureCode =
  | 'UNAUTHORIZED'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'ACCOUNT_DISABLED'
  | 'AUTH_SERVICE_UNAVAILABLE';

interface AuthFailure {
  status: number;
  code: AuthFailureCode;
  error: string;
}

const MISSING_TOKEN: AuthFailure = {
  status: 401,
  code: 'UNAUTHORIZED',
  error: 'Authentication required. Missing or malformed Authorization header.',
};

const INVALID_TOKEN: AuthFailure = {
  status: 401,
  code: 'INVALID_TOKEN',
  error: 'Invalid authentication token. Please sign in again.',
};

const FIREBASE_ERROR_MAP: Record<string, AuthFailure> = {
  'auth/id-token-expired': {
    status: 401,
    code: 'TOKEN_EXPIRED',
    error: 'Your session has expired. Please sign in again.',
  },
  'auth/id-token-revoked': {
    status: 401,
    code: 'TOKEN_REVOKED',
    error: 'Your session has been signed out. Please sign in again.',
  },
  'auth/user-disabled': {
    status: 403,
    code: 'ACCOUNT_DISABLED',
    error: 'This account cannot access HackMatch right now. Please contact support.',
  },
  'auth/internal-error': {
    status: 503,
    code: 'AUTH_SERVICE_UNAVAILABLE',
    error: 'Authentication service is temporarily unavailable. Please try again shortly.',
  },
  'app/network-error': {
    status: 503,
    code: 'AUTH_SERVICE_UNAVAILABLE',
    error: 'Authentication service is temporarily unavailable. Please try again shortly.',
  },
  'app/network-timeout': {
    status: 503,
    code: 'AUTH_SERVICE_UNAVAILABLE',
    error: 'Authentication service is temporarily unavailable. Please try again shortly.',
  },
};

/**
 * Returns the bearer token from the Authorization header, or null if the header
 * is missing, uses another scheme, or carries an empty/oversized token.
 */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header || typeof header !== 'string') return null;
  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]!.toLowerCase() !== 'bearer') return null;
  const token = parts[1]!;
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

/** Maps a Firebase Admin verification error to an explicit API failure, or null if unexpected. */
export function mapFirebaseAuthError(err: unknown): AuthFailure | null {
  const code =
    err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string'
      ? (err as { code: string }).code
      : '';
  if (!code) return null;
  if (FIREBASE_ERROR_MAP[code]) return FIREBASE_ERROR_MAP[code];
  if (code.startsWith('auth/')) return INVALID_TOKEN;
  return null;
}

function sendFailure(res: Response, failure: AuthFailure): void {
  const challenge =
    failure.code === 'UNAUTHORIZED'
      ? 'Bearer realm="hackmatch"'
      : `Bearer realm="hackmatch", error="invalid_token"`;
  if (failure.status === 401) {
    res.setHeader('WWW-Authenticate', challenge);
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(failure.status).json({ error: failure.error, code: failure.code });
}

/**
 * Verifies the Firebase ID token on every protected request (US-003 AC 4 / AC 5).
 *
 * - Requires `Authorization: Bearer <Firebase ID token>`.
 * - Verifies signature, audience, issuer and expiry with the Firebase Admin SDK, and
 *   checks revocation so tokens issued before logout or a password reset are refused.
 * - Rejects disabled (suspended) Firebase accounts (US-003 AC 2).
 * - On success attaches the decoded token to `req.firebaseUser`.
 *
 * Role (PART/ADMIN) and MFA-claim checks are layered on top of this middleware.
 */
export async function requireFirebaseAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    sendFailure(res, MISSING_TOKEN);
    return;
  }

  try {
    req.firebaseUser = await firebaseAuth.verifyIdToken(token, true);
    next();
  } catch (err: unknown) {
    const failure = mapFirebaseAuthError(err);
    if (failure) {
      sendFailure(res, failure);
      return;
    }
    next(err);
  }
}

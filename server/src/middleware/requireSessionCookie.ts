import type { Request, Response, NextFunction } from 'express';
import { firebaseAuth } from '../config/firebase.js';
import { securityConfig } from '../config/security.js';
import { clearSessionCookies } from '../utils/sessionCookies.js';

interface SessionFailure {
  status: number;
  code: string;
  error: string;
}

const SESSION_ERROR_MAP: Record<string, SessionFailure> = {
  'auth/session-cookie-expired': {
    status: 401,
    code: 'SESSION_EXPIRED',
    error: 'Your session has expired. Please sign in again.',
  },
  'auth/session-cookie-revoked': {
    status: 401,
    code: 'SESSION_REVOKED',
    error: 'Your session has been signed out. Please sign in again.',
  },
  'auth/user-disabled': {
    status: 403,
    code: 'ACCOUNT_DISABLED',
    error: 'This account cannot access HackMatch right now. Please contact support.',
  },
  'app/network-error': {
    status: 503,
    code: 'AUTH_SERVICE_UNAVAILABLE',
    error: 'Authentication service is temporarily unavailable. Please try again shortly.',
  },
};

const INVALID_SESSION: SessionFailure = {
  status: 401,
  code: 'INVALID_SESSION',
  error: 'Your session is not valid. Please sign in again.',
};

/**
 * Authenticates a request from the HttpOnly Firebase session cookie (US-003 AC 4 / AC 5),
 * checking expiry and revocation. Attaches the decoded claims to `req.firebaseUser`,
 * so `requireMfa` and `requireRole` can follow it. Pair with `requireCsrf` on
 * state-changing routes.
 */
export async function requireSessionCookie(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const cookies = (req.cookies ?? {}) as Record<string, unknown>;
  const sessionCookie = cookies[securityConfig.sessionCookie.name];

  if (typeof sessionCookie !== 'string' || sessionCookie === '') {
    res.status(401).json({ error: 'No active session. Please sign in.', code: 'NO_SESSION' });
    return;
  }

  try {
    req.firebaseUser = await firebaseAuth.verifySessionCookie(sessionCookie, true);
    next();
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
    const failure = SESSION_ERROR_MAP[code] ?? (code.startsWith('auth/') ? INVALID_SESSION : null);
    if (!failure) {
      next(err);
      return;
    }
    if (failure.status === 401 || failure.status === 403) {
      clearSessionCookies(res);
    }
    res.status(failure.status).json({ error: failure.error, code: failure.code });
  }
}

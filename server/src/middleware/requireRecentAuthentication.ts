import type { Request, Response, NextFunction } from 'express';
import { securityConfig } from '../config/security.js';

const ALLOWED_FUTURE_CLOCK_SKEW_SECONDS = 30;

/**
 * Requires a recent Firebase primary authentication for security-sensitive
 * account changes. #269 will supply the user-facing reauthentication flow;
 * this middleware establishes and enforces the server boundary now.
 */
export function requireRecentAuthentication(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader('Cache-Control', 'no-store');

  const authTime = req.firebaseUser?.auth_time;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const isRecent =
    typeof authTime === 'number' &&
    Number.isFinite(authTime) &&
    authTime > 0 &&
    authTime <= nowSeconds + ALLOWED_FUTURE_CLOCK_SKEW_SECONDS &&
    nowSeconds - authTime <= securityConfig.recentSignInSeconds;

  if (!isRecent) {
    res.status(401).json({
      error: 'Recent reauthentication is required to change authenticator settings. Please sign in again.',
      code: 'REAUTHENTICATION_REQUIRED',
    });
    return;
  }

  next();
}

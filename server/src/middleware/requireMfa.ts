import type { Request, Response, NextFunction } from 'express';
import { hasCompletedMfa } from '../utils/mfaClaim.js';

/**
 * Rejects tokens whose sign-in has not completed the US-004 email OTP (US-003 AC 2).
 * Must be mounted after `requireFirebaseAuth`.
 */
export function requireMfa(req: Request, res: Response, next: NextFunction): void {
  const decoded = req.firebaseUser;
  res.setHeader('Cache-Control', 'no-store');

  if (!decoded) {
    res.status(401).json({
      error: 'Authentication required. Missing or malformed Authorization header.',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  if (!hasCompletedMfa(decoded)) {
    res.status(403).json({
      error: 'Email verification code required. Enter the code sent to your email to continue.',
      code: 'MFA_REQUIRED',
    });
    return;
  }

  next();
}

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { requireFirebaseAuth, extractBearerToken } from './requireFirebaseAuth.js';
import { requireMfa } from './requireMfa.js';
import { requireActiveAccount } from './requireActiveAccount.js';
import { requireParticipantRole } from './requireRole.js';
import { requireVerifiedParticipant } from './requireVerifiedParticipant.js';

const PARTICIPANT_CHAIN: RequestHandler[] = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  requireVerifiedParticipant,
];

/**
 * Optional participant authentication middleware for open endpoints.
 *
 * Contract:
 * - If no Bearer token is provided in the Authorization header: passes through as VISITOR (req.participant remains undefined).
 * - If an Authorization Bearer token IS provided: executes the strict 5-middleware participant verification chain.
 *   Failures in the chain (e.g. 401 INVALID_TOKEN, 401 TOKEN_EXPIRED, 403 MFA_REQUIRED, 403 EMAIL_NOT_VERIFIED)
 *   are NOT downgraded to visitor, so clients (like authFetch) receive the authentic status code and can handle token refresh.
 */
export function optionalParticipantAuth(req: Request, res: Response, next: NextFunction): void {
  if (!extractBearerToken(req.headers.authorization)) {
    next();
    return;
  }

  const run = (i: number): void => {
    if (i >= PARTICIPANT_CHAIN.length) {
      next();
      return;
    }
    PARTICIPANT_CHAIN[i](req, res, (err?: unknown) => {
      if (err) {
        next(err);
      } else {
        run(i + 1);
      }
    });
  };

  run(0);
}

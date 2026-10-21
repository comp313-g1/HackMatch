import type { Request, Response, NextFunction } from 'express';
import { participantsRepository } from '../db/participants.repository.js';

export const ACCOUNT_SUSPENDED_MESSAGE =
  'This account has been suspended and cannot sign in. Please contact support.';

/**
 * Blocks suspended participants from starting or renewing sessions (US-003 AC 2 /
 * FR-005 / US-003-T4). Must run after `requireFirebaseAuth`.
 *
 * Firebase-disabled users are already rejected by token verification
 * (`auth/user-disabled` → ACCOUNT_DISABLED). This middleware covers the database
 * suspension flag used by US-027.
 */
export async function requireActiveAccount(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  const uid = req.firebaseUser?.uid;
  if (!uid) {
    res.status(401).json({
      error: 'Authentication required. Missing or malformed Authorization header.',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  try {
    const participant = await participantsRepository.findByFirebaseUid(uid);
    // US-027 / #250 — suspended or deactivated accounts cannot renew sessions.
    if (participant?.is_suspended || participant?.is_deactivated) {
      res.status(403).json({
        error: ACCOUNT_SUSPENDED_MESSAGE,
        code: 'ACCOUNT_SUSPENDED',
      });
      return;
    }
    if (participant) {
      req.participant = participant;
    }
    next();
  } catch (err: unknown) {
    next(err);
  }
}

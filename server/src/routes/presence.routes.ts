import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireParticipantRole } from '../middleware/requireRole.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import { requireJsonObjectBody } from '../validators/team.validator.js';
import { validatePresenceUpdateBody } from '../validators/presence.validator.js';
import { toPresenceView, updateMyPresence } from '../services/presence.js';

export const presenceRouter = Router();

/**
 * US-030 / #343 / FR-086 — verified active PART only.
 * Visitors → 401; unverified → 403 EMAIL_NOT_VERIFIED; suspended → 403 ACCOUNT_SUSPENDED.
 */
const presenceAuthGuard = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  requireVerifiedParticipant,
];

/**
 * GET /api/presence/me
 * Returns the authenticated participant's own presence status.
 */
presenceRouter.get(
  '/me',
  ...presenceAuthGuard,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const presence = toPresenceView(req.participant!);
      res.status(200).json({ status: 'ok', presence });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/presence/me
 * Updates presence to Online | Idle | Do Not Disturb | Invisible.
 */
presenceRouter.put(
  '/me',
  ...presenceAuthGuard,
  requireJsonObjectBody,
  validatePresenceUpdateBody,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const presence = await updateMyPresence(
        req.participant!.id,
        req.body.presenceStatus
      );
      res.status(200).json({ status: 'ok', presence });
    } catch (err) {
      next(err);
    }
  }
);

import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireParticipantRole } from '../middleware/requireRole.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import { requireJsonObjectBody } from '../validators/team.validator.js';
import { validateOpenThreadBody } from '../validators/directMessage.validator.js';
import { ChatServiceError } from '../services/chat.js';
import { openOrContinueDirectThread } from '../services/directMessages.js';
import { buildChatSuccessPayload } from '../services/chatPrivacy.js';

export const directMessageRouter = Router();

/** US-032 / FR-091: verified active PART only. Visitors 401; unverified or suspended 403. */
const directMessageAuthGuard = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  requireVerifiedParticipant,
];

/**
 * POST /api/direct-messages/threads   body: { participantId }
 * Opens the one-to-one thread with that participant, or returns the existing one (idempotent):
 * 201 when created, 200 when it already existed. The caller is always the authenticated user.
 */
directMessageRouter.post(
  '/threads',
  ...directMessageAuthGuard,
  requireJsonObjectBody,
  validateOpenThreadBody,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const { thread, created } = await openOrContinueDirectThread({
        caller: req.participant!,
        peerId: req.body.participantId,
      });
      res.status(created ? 201 : 200).json(buildChatSuccessPayload({ status: 'ok', thread }));
    } catch (err) {
      if (err instanceof ChatServiceError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      next(err);
    }
  }
);

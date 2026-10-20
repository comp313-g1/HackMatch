import { Router } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireParticipantRole } from '../middleware/requireRole.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import { cancelInvitationHandler } from '../controllers/invitations.controller.js';

/**
 * Invitation-scoped routes (US-017).
 * DELETE cancel uses full participant auth + MFA; ownership is enforced in the RPC.
 */
export const invitationsRouter = Router();

const participantAuth = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  requireVerifiedParticipant,
];

invitationsRouter.delete('/:id', ...participantAuth, cancelInvitationHandler);

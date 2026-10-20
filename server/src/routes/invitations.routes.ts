import { Router } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireParticipantRole } from '../middleware/requireRole.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import { requireJsonObjectBody } from '../validators/team.validator.js';
import { validateRespondInvitationBody } from '../validators/invitationResponse.validator.js';
import {
  cancelInvitationHandler,
  getInvitationDetailHandler,
  listMyInvitationsHandler,
  respondInvitationHandler,
} from '../controllers/invitations.controller.js';

/**
 * Invitation-scoped routes (US-017 cancel + US-019 / #179 invitee detail/respond).
 * Static paths (/mine) must be registered before /:id.
 */
export const invitationsRouter = Router();

const participantAuth = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  requireVerifiedParticipant,
];

invitationsRouter.get('/mine', ...participantAuth, listMyInvitationsHandler);
invitationsRouter.get('/:id', ...participantAuth, getInvitationDetailHandler);
invitationsRouter.post(
  '/:id/respond',
  ...participantAuth,
  requireJsonObjectBody,
  validateRespondInvitationBody,
  respondInvitationHandler
);
invitationsRouter.delete('/:id', ...participantAuth, cancelInvitationHandler);

import { Router } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireParticipantRole } from '../middleware/requireRole.js';
import { validateProfileUpdatePayload } from '../validators/profile.validator.js';
import {
  getMyProfile,
  getParticipantProfile,
  updateParticipantProfile,
} from '../controllers/profile.controller.js';

export const profileRouter = Router();

/**
 * Participant profile read and update routes (US-006 / FR-013 / FR-014 / FR-082).
 * Protected by Firebase ID token verification, mandatory MFA claim, active account check,
 * and PART role enforcement.
 */
profileRouter.get(
  '/me',
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  getMyProfile
);

profileRouter.put(
  '/me',
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  validateProfileUpdatePayload,
  updateParticipantProfile
);

profileRouter.get(
  '/:participantId',
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  getParticipantProfile
);

profileRouter.put(
  '/:participantId',
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  updateParticipantProfile
);

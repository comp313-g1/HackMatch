import { Router } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireParticipantRole } from '../middleware/requireRole.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import {
  listMyApplicationsHandler,
  approveApplicationHandler,
  withdrawApplicationHandler,
} from '../controllers/applications.controller.js';
import { validateApplicationIdParam } from '../validators/applicationResponse.validator.js';

/**
 * Applicant-scoped application routes (US-018 / #175).
 * Submit remains on POST /api/teams/:teamId/applications.
 */
export const applicationsRouter = Router();

const participantAuth = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  requireVerifiedParticipant,
];

applicationsRouter.get('/mine', ...participantAuth, listMyApplicationsHandler);
applicationsRouter.post(
  '/:applicationId/approve',
  ...participantAuth,
  validateApplicationIdParam,
  approveApplicationHandler
);
applicationsRouter.post(
  '/:applicationId/withdraw',
  ...participantAuth,
  withdrawApplicationHandler
);

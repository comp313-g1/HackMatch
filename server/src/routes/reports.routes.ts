import { Router } from 'express';
import {
  createModerationReportHandler,
  forbidParticipantReportReadHandler,
} from '../controllers/moderationReports.controller.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireParticipantRole } from '../middleware/requireRole.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import { validateCreateModerationReport } from '../validators/moderationReport.validator.js';

export const reportsRouter = Router();

const participantAuth = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  requireVerifiedParticipant,
];

// POST /api/reports - participant report submission (US-025 AC 1, 3, 4 / FR-073, FR-074)
reportsRouter.post(
  '/',
  ...participantAuth,
  validateCreateModerationReport,
  createModerationReportHandler
);

// GET /api/reports & GET /api/reports/:reportId - confidentiality protection (US-025 AC 2 / FR-073 / NR-004)
reportsRouter.get('/', ...participantAuth, forbidParticipantReportReadHandler);
reportsRouter.get(
  '/:reportId',
  ...participantAuth,
  forbidParticipantReportReadHandler
);

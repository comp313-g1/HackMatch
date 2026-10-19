import { Router } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireParticipantRole } from '../middleware/requireRole.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import { requireJsonObjectBody } from '../validators/team.validator.js';
import { validateCompatibilityScorePayload } from '../validators/compatibilityScore.validator.js';
import { previewCompatibilityScore } from '../controllers/compatibilityScore.controller.js';

export const scoringRouter = Router();

const scoringAuthGuard = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  requireVerifiedParticipant,
];

/**
 * POST /api/scoring/compatibility
 * Authenticated dry-run of FR-043–045 deterministic scoring (US-015).
 */
scoringRouter.post(
  '/compatibility',
  ...scoringAuthGuard,
  requireJsonObjectBody,
  validateCompatibilityScorePayload,
  previewCompatibilityScore
);

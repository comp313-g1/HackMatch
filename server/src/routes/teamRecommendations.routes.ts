import { Router } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireParticipantRole } from '../middleware/requireRole.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import { getMyTeamRecommendationsHandler } from '../controllers/recommendations.controller.js';

export const teamRecommendationsRouter = Router();

/**
 * GET /api/recommendations/teams
 * Platform-wide eligible open vacancies for the authenticated PART participant (US-016 / #154).
 */
teamRecommendationsRouter.get(
  '/teams',
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  requireVerifiedParticipant,
  getMyTeamRecommendationsHandler
);

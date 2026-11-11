import { Router } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireParticipantRole } from '../middleware/requireRole.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import { requireOwnProfileScope } from '../middleware/requireOwnProfileScope.js';
import { getMyTeamRecommendationsHandler } from '../controllers/recommendations.controller.js';

export const teamRecommendationsRouter = Router();

/**
 * GET /api/recommendations/teams
 * Platform-wide eligible open vacancies for the authenticated PART participant (US-016 / #154).
 * Self-only (#158): the participant comes from the verified token; naming another participant in
 * the request is refused (403 FORBIDDEN_NOT_OWN_PROFILE) and a malformed identity is a 400.
 */
teamRecommendationsRouter.get(
  '/teams',
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  requireVerifiedParticipant,
  requireOwnProfileScope,
  getMyTeamRecommendationsHandler
);

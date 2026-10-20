import { Router } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireAdminRole } from '../middleware/requireRole.js';
import { requireJsonObjectBody } from '../validators/team.validator.js';
import {
  validateCreateModerationCaseBody,
  validateModerationCaseIdParam,
  validateModerationQueueQuery,
} from '../validators/moderation.validator.js';
import {
  createModerationCaseHandler,
  getModerationCaseDetailHandler,
  listModerationCasesHandler,
} from '../controllers/moderation.controller.js';

export const moderationRouter = Router();

/**
 * ADMIN moderation queue + target detail (US-026 / #239 / FR-075).
 * Auth chain: Firebase ID token → MFA → active account → ADMIN role.
 * Decision actions (dismiss/redact/warn/hide/URL-disable) are separate tasks.
 */
const adminGuard = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireAdminRole,
];

moderationRouter.get(
  '/cases',
  ...adminGuard,
  validateModerationQueueQuery,
  listModerationCasesHandler
);

moderationRouter.get(
  '/cases/:caseId',
  ...adminGuard,
  validateModerationCaseIdParam,
  getModerationCaseDetailHandler
);

moderationRouter.post(
  '/cases',
  ...adminGuard,
  requireJsonObjectBody,
  validateCreateModerationCaseBody,
  createModerationCaseHandler
);

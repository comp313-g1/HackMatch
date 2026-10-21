import { Router } from 'express';
import { requireModerationAdmin } from '../middleware/requireModerationAdmin.js';
import { requireJsonObjectBody } from '../validators/team.validator.js';
import {
  validateCreateModerationCaseBody,
  validateDecideModerationCaseBody,
  validateModerationCaseIdParam,
  validateModerationQueueQuery,
} from '../validators/moderation.validator.js';
import {
  createModerationCaseHandler,
  decideModerationCaseHandler,
  getModerationCaseDetailHandler,
  listModerationCasesHandler,
} from '../controllers/moderation.controller.js';

export const moderationRouter = Router();

/**
 * US-026 / #240 — every moderation route is ADMIN-only via router-level RBAC.
 * Decision actions (dismiss/redact/warn/hide/URL-disable) inherit the same guard.
 */
moderationRouter.use(...requireModerationAdmin);

moderationRouter.get('/cases', validateModerationQueueQuery, listModerationCasesHandler);

moderationRouter.get(
  '/cases/:caseId',
  validateModerationCaseIdParam,
  getModerationCaseDetailHandler
);

moderationRouter.post(
  '/cases',
  requireJsonObjectBody,
  validateCreateModerationCaseBody,
  createModerationCaseHandler
);

moderationRouter.post(
  '/cases/:caseId/decide',
  validateModerationCaseIdParam,
  requireJsonObjectBody,
  validateDecideModerationCaseBody,
  decideModerationCaseHandler
);

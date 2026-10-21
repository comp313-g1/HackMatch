import { Router } from 'express';
import { requireAccountsAdmin } from '../middleware/requireAccountsAdmin.js';
import { requireJsonObjectBody } from '../validators/team.validator.js';
import {
  validateAccountIdParam,
  validateAccountsListQuery,
  validateSuspendAccountBody,
} from '../validators/accounts.validator.js';
import {
  getAdminAccountDetailHandler,
  listAdminAccountsHandler,
  suspendAdminAccountHandler,
} from '../controllers/accounts.controller.js';

export const accountsRouter = Router();

/**
 * US-027 / #248–#250 — ADMIN account list/detail and suspension.
 * Deletion workflow ships in later US-027 tasks.
 */
accountsRouter.use(...requireAccountsAdmin);

accountsRouter.get('/', validateAccountsListQuery, listAdminAccountsHandler);

accountsRouter.get(
  '/:accountId',
  validateAccountIdParam,
  getAdminAccountDetailHandler
);

accountsRouter.post(
  '/:accountId/suspend',
  validateAccountIdParam,
  requireJsonObjectBody,
  validateSuspendAccountBody,
  suspendAdminAccountHandler
);

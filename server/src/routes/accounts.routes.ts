import { Router } from 'express';
import { requireAccountsAdmin } from '../middleware/requireAccountsAdmin.js';
import { requireJsonObjectBody } from '../validators/team.validator.js';
import {
  validateAccountIdParam,
  validateAccountsListQuery,
  validateDeleteAccountBody,
  validateSuspendAccountBody,
} from '../validators/accounts.validator.js';
import {
  deleteAdminAccountHandler,
  getAdminAccountDetailHandler,
  listAdminAccountsHandler,
  suspendAdminAccountHandler,
} from '../controllers/accounts.controller.js';

export const accountsRouter = Router();

/**
 * US-027 / #248–#252 — ADMIN account list/detail, suspension, and ownership-verified deletion.
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

accountsRouter.post(
  '/:accountId/delete',
  validateAccountIdParam,
  requireJsonObjectBody,
  validateDeleteAccountBody,
  deleteAdminAccountHandler
);

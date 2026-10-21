import { Router } from 'express';
import { requireAccountsAdmin } from '../middleware/requireAccountsAdmin.js';
import {
  validateAccountIdParam,
  validateAccountsListQuery,
} from '../validators/accounts.validator.js';
import {
  getAdminAccountDetailHandler,
  listAdminAccountsHandler,
} from '../controllers/accounts.controller.js';

export const accountsRouter = Router();

/**
 * US-027 / #248 — ADMIN account-management list and detail.
 * Suspension / deletion actions ship in later US-027 tasks.
 */
accountsRouter.use(...requireAccountsAdmin);

accountsRouter.get('/', validateAccountsListQuery, listAdminAccountsHandler);

accountsRouter.get(
  '/:accountId',
  validateAccountIdParam,
  getAdminAccountDetailHandler
);

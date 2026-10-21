import type { Request, Response, NextFunction } from 'express';
import type { AccountsListQuerySanitized } from '../validators/accounts.validator.js';
import {
  AccountManagementError,
  getAdminAccountDetail,
  listAdminAccounts,
} from '../services/accountManagement.js';

function handleAccountsError(err: unknown, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  if (err instanceof AccountManagementError) {
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }
  next(err);
}

/**
 * GET /api/admin/accounts — ADMIN account list (US-027 / #248 / AC 1).
 */
export async function listAdminAccountsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = (res.locals.accountsListQuery || {
      limit: 50,
    }) as AccountsListQuerySanitized;
    const accounts = await listAdminAccounts(query);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ accounts });
  } catch (err: unknown) {
    handleAccountsError(err, res, next);
  }
}

/**
 * GET /api/admin/accounts/:accountId — ADMIN account detail + relevant listings (#248).
 */
export async function getAdminAccountDetailHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const detail = await getAdminAccountDetail(String(req.params.accountId));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(detail);
  } catch (err: unknown) {
    handleAccountsError(err, res, next);
  }
}

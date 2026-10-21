import type { Request, Response, NextFunction } from 'express';
import type {
  AccountsListQuerySanitized,
  SuspendAccountSanitized,
} from '../validators/accounts.validator.js';
import {
  AccountManagementError,
  getAdminAccountDetail,
  listAdminAccounts,
} from '../services/accountManagement.js';
import { suspendAccount } from '../services/accountSuspension.js';

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

/**
 * POST /api/admin/accounts/:accountId/suspend — revoke sessions + block sign-in (#250).
 */
export async function suspendAdminAccountHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = req.participant;
    if (!actor) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(401).json({
        error: 'Authentication required. Missing or malformed Authorization header.',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    const body = req.body as SuspendAccountSanitized;
    const result = await suspendAccount({
      actorParticipantId: actor.id,
      actorRole: actor.role,
      accountId: String(req.params.accountId),
      reason: body.reason,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(result);
  } catch (err: unknown) {
    handleAccountsError(err, res, next);
  }
}

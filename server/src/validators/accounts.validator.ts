import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { UUID_REGEX } from './team.validator.js';

export type AccountListStateFilter = 'Active' | 'Suspended' | 'Deactivated';
export type AccountListRoleFilter = 'PART' | 'ADMIN';

export interface AccountsFieldErrors {
  accountId?: string;
  role?: string;
  state?: string;
  q?: string;
  limit?: string;
  [key: string]: string | undefined;
}

export interface AccountsListQuerySanitized {
  role?: AccountListRoleFilter;
  state?: AccountListStateFilter;
  q?: string;
  limit: number;
}

export const DEFAULT_ACCOUNTS_LIST_LIMIT = 50;
export const MAX_ACCOUNTS_LIST_LIMIT = 200;
export const MAX_ACCOUNTS_SEARCH_LENGTH = 100;

export function parseAccountsListQuery(query: Request['query']): {
  errors: AccountsFieldErrors;
  sanitized: AccountsListQuerySanitized | null;
  submitted: Record<string, unknown>;
} {
  const submitted: Record<string, unknown> = {
    role: query.role ?? null,
    state: query.state ?? null,
    q: query.q ?? null,
    limit: query.limit ?? null,
  };
  const errors: AccountsFieldErrors = {};

  let role: AccountListRoleFilter | undefined;
  if (query.role !== undefined) {
    const raw = Array.isArray(query.role) ? query.role[0] : query.role;
    if (raw !== 'PART' && raw !== 'ADMIN') {
      errors.role = 'role must be PART or ADMIN.';
    } else {
      role = raw;
    }
  }

  let state: AccountListStateFilter | undefined;
  if (query.state !== undefined) {
    const raw = Array.isArray(query.state) ? query.state[0] : query.state;
    if (raw !== 'Active' && raw !== 'Suspended' && raw !== 'Deactivated') {
      errors.state = 'state must be Active, Suspended, or Deactivated.';
    } else {
      state = raw;
    }
  }

  let q: string | undefined;
  if (query.q !== undefined) {
    const raw = Array.isArray(query.q) ? query.q[0] : query.q;
    if (typeof raw !== 'string') {
      errors.q = 'q must be a string.';
    } else {
      const trimmed = raw.trim();
      if (trimmed.length > MAX_ACCOUNTS_SEARCH_LENGTH) {
        errors.q = `q must be at most ${MAX_ACCOUNTS_SEARCH_LENGTH} characters.`;
      } else if (trimmed.length > 0) {
        q = trimmed;
      }
    }
  }

  let limit = DEFAULT_ACCOUNTS_LIST_LIMIT;
  if (query.limit !== undefined) {
    const raw = Array.isArray(query.limit) ? query.limit[0] : query.limit;
    const n = typeof raw === 'string' ? Number(raw) : Number.NaN;
    if (!Number.isInteger(n) || n < 1 || n > MAX_ACCOUNTS_LIST_LIMIT) {
      errors.limit = `limit must be an integer between 1 and ${MAX_ACCOUNTS_LIST_LIMIT}.`;
    } else {
      limit = n;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors, sanitized: null, submitted };
  }

  return {
    errors,
    sanitized: {
      ...(role ? { role } : {}),
      ...(state ? { state } : {}),
      ...(q ? { q } : {}),
      limit,
    },
    submitted,
  };
}

export const validateAccountsListQuery: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const result = parseAccountsListQuery(req.query);
  if (Object.keys(result.errors).length > 0) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: result.errors,
      submitted: result.submitted,
    });
    return;
  }
  res.locals.accountsListQuery = result.sanitized;
  next();
};

export const validateAccountIdParam: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const accountId = req.params.accountId;
  if (!accountId || typeof accountId !== 'string' || !UUID_REGEX.test(accountId)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: { accountId: 'accountId must be a valid UUID.' },
      submitted: { accountId: accountId ?? null },
    });
    return;
  }
  next();
};

export const ACCOUNT_ENFORCEMENT_REASON_MAX = 2000;

export interface SuspendAccountSanitized {
  reason: string;
}

export function validateSuspendAccountInput(body: unknown): {
  errors: AccountsFieldErrors;
  sanitized: SuspendAccountSanitized | null;
  submitted: Record<string, unknown>;
} {
  const record =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const submitted: Record<string, unknown> = {
    reason: record.reason ?? null,
  };
  const errors: AccountsFieldErrors = {};

  const allowed = new Set(['reason']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      errors[key] = `Unknown field: ${key}.`;
    }
  }

  const reasonRaw = record.reason;
  let reason: string | undefined;
  if (typeof reasonRaw !== 'string' || reasonRaw.trim().length === 0) {
    errors.reason = 'A reason is required for every suspension.';
  } else if ([...reasonRaw].length > ACCOUNT_ENFORCEMENT_REASON_MAX) {
    errors.reason = `reason must be at most ${ACCOUNT_ENFORCEMENT_REASON_MAX} characters.`;
  } else {
    reason = reasonRaw.trim();
  }

  if (Object.keys(errors).length > 0) {
    return { errors, sanitized: null, submitted };
  }

  return {
    errors,
    sanitized: { reason: reason! },
    submitted,
  };
}

export const validateSuspendAccountBody: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const result = validateSuspendAccountInput(req.body);
  if (Object.keys(result.errors).length > 0) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: result.errors,
      submitted: result.submitted,
    });
    return;
  }
  req.body = result.sanitized;
  next();
};

export interface DeleteAccountSanitized {
  reason: string;
  ownershipVerified: true;
}

export function validateDeleteAccountInput(body: unknown): {
  errors: AccountsFieldErrors;
  sanitized: DeleteAccountSanitized | null;
  submitted: Record<string, unknown>;
} {
  const record =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const submitted: Record<string, unknown> = {
    reason: record.reason ?? null,
    ownershipVerified: record.ownershipVerified ?? null,
  };
  const errors: AccountsFieldErrors = {};

  const allowed = new Set(['reason', 'ownershipVerified']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      errors[key] = `Unknown field: ${key}.`;
    }
  }

  const reasonRaw = record.reason;
  let reason: string | undefined;
  if (typeof reasonRaw !== 'string' || reasonRaw.trim().length === 0) {
    errors.reason = 'A reason is required for every deletion request.';
  } else if ([...reasonRaw].length > ACCOUNT_ENFORCEMENT_REASON_MAX) {
    errors.reason = `reason must be at most ${ACCOUNT_ENFORCEMENT_REASON_MAX} characters.`;
  } else {
    reason = reasonRaw.trim();
  }

  if (record.ownershipVerified !== true) {
    errors.ownershipVerified =
      'ownershipVerified must be true. Confirm that account ownership was verified before deletion.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors, sanitized: null, submitted };
  }

  return {
    errors,
    sanitized: { reason: reason!, ownershipVerified: true },
    submitted,
  };
}

export const validateDeleteAccountBody: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const result = validateDeleteAccountInput(req.body);
  if (Object.keys(result.errors).length > 0) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: result.errors,
      submitted: result.submitted,
    });
    return;
  }
  req.body = result.sanitized;
  next();
};

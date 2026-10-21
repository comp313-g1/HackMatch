import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { UUID_REGEX } from './team.validator.js';
import type {
  ModerationCaseStatus,
  ModerationDecisionAction,
  ModerationTargetType,
} from '../db/types.js';

export const MODERATION_TARGET_TYPES = ['team', 'profile', 'url'] as const;
export const MODERATION_CASE_STATUSES = ['Open', 'Dismissed', 'Resolved'] as const;
export const MODERATION_DECISION_ACTIONS = [
  'dismiss',
  'redact',
  'warn',
  'hide',
  'disable_url',
] as const;
export const MODERATION_REASON_MAX = 2000;
export const MODERATION_FLAGGED_URL_MAX = 2048;

const CREATE_ALLOWED_KEYS = new Set(['targetType', 'targetId', 'reason', 'flaggedUrl']);
const DECIDE_ALLOWED_KEYS = new Set(['action', 'reason']);

export interface ModerationFieldErrors {
  targetType?: string;
  targetId?: string;
  reason?: string;
  flaggedUrl?: string;
  action?: string;
  caseId?: string;
  status?: string;
  body?: string;
  _form?: string;
  [unknownKey: string]: string | undefined;
}

export interface DecideModerationCaseSanitized {
  action: ModerationDecisionAction;
  reason: string;
}

export interface CreateModerationCaseSanitized {
  targetType: ModerationTargetType;
  targetId: string;
  reason: string;
  flaggedUrl: string | null;
}

function isHttpsUrl(value: string): boolean {
  return value.startsWith('https://') && value.length > 8 && value.length <= MODERATION_FLAGGED_URL_MAX;
}

/**
 * Validates POST /api/admin/moderation/cases body (US-026 AC 1 / FR-075).
 * Echoes submitted values on failure so the client can preserve drafts (NR-017).
 */
export function validateCreateModerationCaseInput(raw: unknown): {
  errors: ModerationFieldErrors;
  sanitized: CreateModerationCaseSanitized | null;
  submitted: unknown;
} {
  const submitted = raw;

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      errors: { body: 'Request body must be a JSON object.' },
      sanitized: null,
      submitted,
    };
  }

  const record = raw as Record<string, unknown>;
  const errors: ModerationFieldErrors = {};

  for (const key of Object.keys(record)) {
    if (!CREATE_ALLOWED_KEYS.has(key)) {
      errors[key] = `Unknown field "${key}".`;
    }
  }

  const targetTypeRaw = record.targetType;
  let targetType: ModerationTargetType | null = null;
  if (typeof targetTypeRaw !== 'string' || !targetTypeRaw.trim()) {
    errors.targetType = 'targetType must be team, profile, or url.';
  } else if (!(MODERATION_TARGET_TYPES as readonly string[]).includes(targetTypeRaw.trim())) {
    errors.targetType = 'targetType must be team, profile, or url.';
  } else {
    targetType = targetTypeRaw.trim() as ModerationTargetType;
  }

  const targetIdRaw = record.targetId;
  let targetId: string | null = null;
  if (typeof targetIdRaw !== 'string' || !UUID_REGEX.test(targetIdRaw.trim())) {
    errors.targetId = 'targetId must be a valid UUID.';
  } else {
    targetId = targetIdRaw.trim();
  }

  const reasonRaw = record.reason;
  let reason: string | null = null;
  if (typeof reasonRaw !== 'string') {
    errors.reason = 'reason is required.';
  } else {
    const trimmed = reasonRaw.trim();
    if (!trimmed) {
      errors.reason = 'reason is required.';
    } else if ([...reasonRaw].length > MODERATION_REASON_MAX) {
      errors.reason = `reason must be at most ${MODERATION_REASON_MAX} characters.`;
    } else {
      reason = trimmed;
    }
  }

  let flaggedUrl: string | null = null;
  const flaggedUrlRaw = record.flaggedUrl;

  if (targetType === 'url') {
    if (typeof flaggedUrlRaw !== 'string' || !flaggedUrlRaw.trim()) {
      errors.flaggedUrl = 'flaggedUrl is required for url targets and must be an https URL.';
    } else if (!isHttpsUrl(flaggedUrlRaw.trim())) {
      errors.flaggedUrl = 'flaggedUrl must be an https URL at most 2048 characters.';
    } else {
      flaggedUrl = flaggedUrlRaw.trim();
    }
  } else if (flaggedUrlRaw !== undefined && flaggedUrlRaw !== null) {
    errors.flaggedUrl = 'flaggedUrl is only allowed when targetType is url.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors, sanitized: null, submitted };
  }

  return {
    errors: {},
    sanitized: {
      targetType: targetType!,
      targetId: targetId!,
      reason: reason!,
      flaggedUrl,
    },
    submitted,
  };
}

export const validateCreateModerationCaseBody: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const result = validateCreateModerationCaseInput(req.body);
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

export const validateModerationCaseIdParam: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const caseId = req.params.caseId;
  if (!caseId || !UUID_REGEX.test(caseId)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: { caseId: 'caseId must be a valid UUID.' },
      submitted: { caseId: caseId ?? null },
    });
    return;
  }
  next();
};

export function parseModerationQueueQuery(query: Request['query']): {
  errors: ModerationFieldErrors;
  status?: ModerationCaseStatus;
  limit?: number;
} {
  const errors: ModerationFieldErrors = {};
  let status: ModerationCaseStatus | undefined;
  let limit: number | undefined;

  if (query.status !== undefined) {
    const raw = Array.isArray(query.status) ? query.status[0] : query.status;
    if (typeof raw !== 'string' || !(MODERATION_CASE_STATUSES as readonly string[]).includes(raw)) {
      errors.status = 'status must be Open, Dismissed, or Resolved.';
    } else {
      status = raw as ModerationCaseStatus;
    }
  }

  if (query.limit !== undefined) {
    const raw = Array.isArray(query.limit) ? query.limit[0] : query.limit;
    const n = typeof raw === 'string' ? Number(raw) : Number.NaN;
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      errors.limit = 'limit must be an integer between 1 and 200.';
    } else {
      limit = n;
    }
  }

  return { errors, ...(status ? { status } : {}), ...(limit !== undefined ? { limit } : {}) };
}

export const validateModerationQueueQuery: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const parsed = parseModerationQueueQuery(req.query);
  if (Object.keys(parsed.errors).length > 0) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: parsed.errors,
      submitted: {
        status: req.query.status ?? null,
        limit: req.query.limit ?? null,
      },
    });
    return;
  }
  res.locals.moderationQueueQuery = {
    ...(parsed.status ? { status: parsed.status } : {}),
    ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
  };
  next();
};

/**
 * Validates POST /api/admin/moderation/cases/:caseId/decide (US-026 / #242).
 * Reason is mandatory; submitted values are echoed on failure (NR-017 / AC 2).
 */
export function validateDecideModerationCaseInput(raw: unknown): {
  errors: ModerationFieldErrors;
  sanitized: DecideModerationCaseSanitized | null;
  submitted: unknown;
} {
  const submitted = raw;

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      errors: { body: 'Request body must be a JSON object.' },
      sanitized: null,
      submitted,
    };
  }

  const record = raw as Record<string, unknown>;
  const errors: ModerationFieldErrors = {};

  for (const key of Object.keys(record)) {
    if (!DECIDE_ALLOWED_KEYS.has(key)) {
      errors[key] = `Unknown field "${key}".`;
    }
  }

  const actionRaw = record.action;
  let action: ModerationDecisionAction | null = null;
  if (typeof actionRaw !== 'string' || !actionRaw.trim()) {
    errors.action = 'action must be dismiss, redact, warn, hide, or disable_url.';
  } else if (!(MODERATION_DECISION_ACTIONS as readonly string[]).includes(actionRaw.trim())) {
    errors.action = 'action must be dismiss, redact, warn, hide, or disable_url.';
  } else {
    action = actionRaw.trim() as ModerationDecisionAction;
  }

  const reasonRaw = record.reason;
  let reason: string | null = null;
  if (typeof reasonRaw !== 'string') {
    errors.reason = 'A reason is required for every moderation decision.';
  } else {
    const trimmed = reasonRaw.trim();
    if (!trimmed) {
      errors.reason = 'A reason is required for every moderation decision.';
    } else if ([...reasonRaw].length > MODERATION_REASON_MAX) {
      errors.reason = `reason must be at most ${MODERATION_REASON_MAX} characters.`;
    } else {
      reason = trimmed;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors, sanitized: null, submitted };
  }

  return {
    errors: {},
    sanitized: { action: action!, reason: reason! },
    submitted,
  };
}

export const validateDecideModerationCaseBody: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const result = validateDecideModerationCaseInput(req.body);
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

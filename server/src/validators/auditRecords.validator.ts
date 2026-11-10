import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AuditCategory, AuditQueryParams } from '../db/auditRecords.repository.js';
import { UUID_REGEX } from './team.validator.js';

export const AUDIT_DEFAULT_LIMIT = 25;
export const AUDIT_MAX_LIMIT = 100;
export const AUDIT_ACTION_TYPE_MAX_LENGTH = 50;
/** A real cursor is ~100 chars (timestamp + UUID); anything larger is never decoded. */
export const AUDIT_CURSOR_MAX_LENGTH = 200;
export const AUDIT_CATEGORIES: readonly AuditCategory[] = ['event', 'moderation', 'account'];

const QUERY_KEYS = new Set(['actor', 'actionType', 'category', 'from', 'to', 'limit', 'cursor']);
const ACTION_TYPE_REGEX = /^[a-z][a-z0-9_]*$/;
const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const CURSOR_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export interface AuditFieldErrors {
  [field: string]: string | undefined;
}

/** True only for a real calendar date/time (rejects 2026-02-30, 25:00, etc.). */
function isRealDateTime(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): boolean {
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi &&
    date.getUTCSeconds() === s
  );
}

/**
 * Accepts YYYY-MM-DD or a full ISO-8601 timestamp with a timezone. A date-only value
 * covers the whole UTC day: start-of-day for `from`, end-of-day for `to` (both inclusive).
 */
export function parseAuditDate(raw: string, edge: 'from' | 'to'): string | null {
  const dateOnly = DATE_ONLY_REGEX.exec(raw);
  if (dateOnly) {
    const [, y, m, d] = dateOnly.map(Number);
    if (!isRealDateTime(y, m, d)) return null;
    return `${raw}T${edge === 'from' ? '00:00:00.000000' : '23:59:59.999999'}Z`;
  }
  const dateTime = DATE_TIME_REGEX.exec(raw);
  if (!dateTime) return null;
  const [y, mo, d, h, mi, s] = dateTime.slice(1, 7).map(Number);
  if (!isRealDateTime(y, mo, d, h, mi, s)) return null;
  const offset = dateTime[8];
  if (offset !== 'Z') {
    const [oh, om] = offset.slice(1).split(':').map(Number);
    if (oh > 23 || om > 59) return null;
  }
  return raw;
}

export function decodeAuditCursor(raw: string): { createdAt: string; id: string } | null {
  if (raw.length > AUDIT_CURSOR_MAX_LENGTH) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [createdAt, id] = parsed;
    if (typeof createdAt !== 'string' || typeof id !== 'string') return null;
    if (!CURSOR_TIMESTAMP_REGEX.test(createdAt) || !UUID_REGEX.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** Validates GET /api/admin/audit-records query parameters (strict; unknown keys rejected). */
export function validateAuditQueryInput(raw: Record<string, unknown>): {
  errors: AuditFieldErrors;
  params: AuditQueryParams | null;
} {
  const errors: AuditFieldErrors = {};

  for (const key of Object.keys(raw)) {
    if (!QUERY_KEYS.has(key)) errors[key] = `Unknown query parameter "${key}".`;
  }

  const str = (key: string): string | undefined | null => {
    const v = raw[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'string') {
      errors[key] = `${key} must be provided once.`;
      return null;
    }
    return v;
  };

  let limit = AUDIT_DEFAULT_LIMIT;
  const limitRaw = str('limit');
  if (limitRaw !== undefined && limitRaw !== null) {
    if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > AUDIT_MAX_LIMIT) {
      errors.limit = `limit must be an integer between 1 and ${AUDIT_MAX_LIMIT}.`;
    } else {
      limit = Number(limitRaw);
    }
  }

  let actorId: string | null = null;
  const actorRaw = str('actor');
  if (actorRaw !== undefined && actorRaw !== null) {
    if (!UUID_REGEX.test(actorRaw)) errors.actor = 'actor must be a valid UUID.';
    else actorId = actorRaw.toLowerCase();
  }

  let actionType: string | null = null;
  const actionRaw = str('actionType');
  if (actionRaw !== undefined && actionRaw !== null) {
    if (
      actionRaw.length > AUDIT_ACTION_TYPE_MAX_LENGTH ||
      !ACTION_TYPE_REGEX.test(actionRaw)
    ) {
      errors.actionType = `actionType must be lowercase letters, digits and underscores (max ${AUDIT_ACTION_TYPE_MAX_LENGTH}).`;
    } else {
      actionType = actionRaw;
    }
  }

  let category: AuditCategory | null = null;
  const categoryRaw = str('category');
  if (categoryRaw !== undefined && categoryRaw !== null) {
    if ((AUDIT_CATEGORIES as readonly string[]).includes(categoryRaw)) {
      category = categoryRaw as AuditCategory;
    } else {
      errors.category = 'category must be event, moderation, or account.';
    }
  }

  let from: string | null = null;
  const fromRaw = str('from');
  if (fromRaw !== undefined && fromRaw !== null) {
    from = parseAuditDate(fromRaw, 'from');
    if (!from) errors.from = 'from must be a real date (YYYY-MM-DD) or ISO-8601 UTC timestamp.';
  }

  let to: string | null = null;
  const toRaw = str('to');
  if (toRaw !== undefined && toRaw !== null) {
    to = parseAuditDate(toRaw, 'to');
    if (!to) errors.to = 'to must be a real date (YYYY-MM-DD) or ISO-8601 UTC timestamp.';
  }

  if (from && to && !errors.from && !errors.to && Date.parse(from) > Date.parse(to)) {
    errors.from = 'from must not be after to.';
  }

  let cursor: { createdAt: string; id: string } | null = null;
  const cursorRaw = str('cursor');
  if (cursorRaw !== undefined && cursorRaw !== null) {
    cursor = decodeAuditCursor(cursorRaw);
    if (!cursor) errors.cursor = 'cursor is invalid.';
  }

  if (Object.keys(errors).length > 0) return { errors, params: null };
  return { errors: {}, params: { actorId, actionType, category, from, to, limit, cursor } };
}

export const validateAuditQuery: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const result = validateAuditQueryInput(req.query as Record<string, unknown>);
  if (!result.params) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: result.errors,
      fieldErrors: result.errors,
      submitted: req.query,
    });
    return;
  }
  res.locals.auditQuery = result.params;
  next();
};

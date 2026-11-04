import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { isNotificationCategory, type NotificationCategory } from '../db/notificationModel.js';
import type { NotificationCursor } from '../db/notifications.repository.js';
import { UUID_REGEX } from './team.validator.js';

export const NOTIFICATION_DEFAULT_LIMIT = 20;
export const NOTIFICATION_MAX_LIMIT = 50;

export interface NotificationListQuery {
  limit: number;
  cursor: NotificationCursor | null;
  unreadOnly: boolean;
  category: NotificationCategory | null;
}

export interface NotificationFieldErrors {
  [field: string]: string | undefined;
}

const LIST_QUERY_KEYS = new Set(['limit', 'cursor', 'unread', 'category']);
const ISO_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

/** A real cursor is ~100 chars (timestamp + UUID); anything far larger is never decoded. */
export const NOTIFICATION_CURSOR_MAX_LENGTH = 200;

export function decodeNotificationCursor(raw: string): NotificationCursor | null {
  if (raw.length > NOTIFICATION_CURSOR_MAX_LENGTH) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [createdAt, id] = parsed;
    if (typeof createdAt !== 'string' || typeof id !== 'string') return null;
    if (!ISO_TIMESTAMP_REGEX.test(createdAt) || !UUID_REGEX.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** Validates GET /api/notifications query parameters (strict; unknown keys rejected). */
export function validateNotificationListQueryInput(raw: Record<string, unknown>): {
  errors: NotificationFieldErrors;
  query: NotificationListQuery | null;
} {
  const errors: NotificationFieldErrors = {};

  for (const key of Object.keys(raw)) {
    if (!LIST_QUERY_KEYS.has(key)) errors[key] = `Unknown query parameter "${key}".`;
  }

  let limit = NOTIFICATION_DEFAULT_LIMIT;
  if (raw.limit !== undefined) {
    if (typeof raw.limit !== 'string' || !/^\d+$/.test(raw.limit)) {
      errors.limit = `limit must be an integer between 1 and ${NOTIFICATION_MAX_LIMIT}.`;
    } else {
      limit = Number(raw.limit);
      if (limit < 1 || limit > NOTIFICATION_MAX_LIMIT) {
        errors.limit = `limit must be an integer between 1 and ${NOTIFICATION_MAX_LIMIT}.`;
      }
    }
  }

  let unreadOnly = false;
  if (raw.unread !== undefined) {
    if (raw.unread === 'true') unreadOnly = true;
    else if (raw.unread !== 'false') errors.unread = 'unread must be "true" or "false".';
  }

  let category: NotificationCategory | null = null;
  if (raw.category !== undefined) {
    if (isNotificationCategory(raw.category)) category = raw.category;
    else errors.category = 'category is not a recognized notification category.';
  }

  let cursor: NotificationCursor | null = null;
  if (raw.cursor !== undefined) {
    cursor = typeof raw.cursor === 'string' ? decodeNotificationCursor(raw.cursor) : null;
    if (!cursor) errors.cursor = 'cursor is invalid.';
  }

  if (Object.keys(errors).length > 0) return { errors, query: null };
  return { errors: {}, query: { limit, cursor, unreadOnly, category } };
}

function rejectValidation(
  res: Response,
  errors: NotificationFieldErrors,
  submitted: unknown
): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(400).json({
    error: 'Validation failed.',
    code: 'VALIDATION_ERROR',
    errors,
    fieldErrors: errors,
    submitted,
  });
}

export const validateNotificationListQuery: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const result = validateNotificationListQueryInput(req.query as Record<string, unknown>);
  if (!result.query) {
    rejectValidation(res, result.errors, req.query);
    return;
  }
  res.locals.notificationQuery = result.query;
  next();
};

export const validateNotificationIdParam: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const id = req.params.id;
  if (!id || typeof id !== 'string' || !UUID_REGEX.test(id)) {
    rejectValidation(
      res,
      { id: 'id must be a valid UUID.' },
      { id: typeof id === 'string' ? id : null }
    );
    return;
  }
  next();
};

/** Mark-read endpoints take no body; reject anything a client might expect to apply. */
export const requireEmptyBody: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const body: unknown = req.body;
  if (body === undefined || body === null) return next();
  if (typeof body !== 'object' || Array.isArray(body)) {
    rejectValidation(res, { body: 'Request body must be empty.' }, null);
    return;
  }
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length > 0) {
    const errors: NotificationFieldErrors = {};
    for (const key of keys) errors[key] = `Unknown field "${key}".`;
    rejectValidation(res, errors, null);
    return;
  }
  next();
};

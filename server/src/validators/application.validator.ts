import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { UUID_REGEX } from './team.validator.js';
import {
  APPLICATION_MESSAGE_MAX_LENGTH,
  isApplicationMessageTooLong,
  normalizeApplicationMessage,
} from '../db/applicationModel.js';

export interface ApplicationFieldErrors {
  vacancyId?: string;
  message?: string;
  body?: string;
  _form?: string;
  [unknownKey: string]: string | undefined;
}

export interface SubmitApplicationInputSanitized {
  vacancyId: string;
  message: string | null;
}

const ALLOWED_KEYS = new Set(['vacancyId', 'message']);

/**
 * Validates POST /api/teams/:teamId/applications body (US-018 / #172 / FR-053).
 * Keeps caller-entered message available to the client on 400 responses (NR-017).
 */
export function validateSubmitApplicationInput(raw: unknown): {
  errors: ApplicationFieldErrors;
  sanitized: SubmitApplicationInputSanitized | null;
} {
  const errors: ApplicationFieldErrors = {};

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: { body: 'Request body must be a JSON object.' }, sanitized: null };
  }

  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) {
      errors[key] = `Unknown field "${key}".`;
    }
  }

  const vacancyIdRaw = record.vacancyId;
  if (typeof vacancyIdRaw !== 'string' || !UUID_REGEX.test(vacancyIdRaw.trim())) {
    errors.vacancyId = 'vacancyId must be a valid UUID.';
  }

  let message: string | null = null;
  if (record.message !== undefined && record.message !== null) {
    if (typeof record.message !== 'string') {
      errors.message = 'message must be a string when provided.';
    } else if (isApplicationMessageTooLong(record.message)) {
      errors.message = `Message must be at most ${APPLICATION_MESSAGE_MAX_LENGTH} characters.`;
    } else {
      message = normalizeApplicationMessage(record.message);
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors, sanitized: null };
  }

  return {
    errors: {},
    sanitized: {
      vacancyId: String(vacancyIdRaw).trim(),
      message,
    },
  };
}

export const validateSubmitApplicationBody: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const result = validateSubmitApplicationInput(req.body);
  if (Object.keys(result.errors).length > 0 || !result.sanitized) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: result.errors,
    });
    return;
  }
  req.body = result.sanitized;
  next();
};

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { sanitizeSubmittedChatDraft } from '../services/chatPrivacy.js';
import { UUID_REGEX } from './team.validator.js';
import {
  CHAT_MESSAGE_BODY_MAX_LENGTH,
  isChatMessageBodyTooLong,
  normalizeChatMessageBody,
} from '../db/chatModel.js';

const ALLOWED_KEYS = new Set(['participantId']);
const SEND_MESSAGE_KEYS = new Set(['body']);

/**
 * US-032 / #386: body of POST /api/direct-messages/threads is exactly `{ participantId: <uuid> }`.
 * Unknown fields are rejected so a client cannot try to choose the caller or inject other data.
 */
export function validateOpenThreadInput(raw: unknown): {
  errors: Record<string, string>;
  sanitized?: { participantId: string };
  submitted: unknown;
} {
  const errors: Record<string, string> = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: { body: 'Request body must be a JSON object.' }, submitted: raw };
  }
  const record = raw as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) errors[key] = `Unknown field "${key}".`;
  }

  const id = record.participantId;
  if (typeof id !== 'string' || id.trim() === '') {
    errors.participantId = 'participantId is required.';
  } else if (!UUID_REGEX.test(id.trim())) {
    errors.participantId = 'participantId must be a valid UUID.';
  }

  if (Object.keys(errors).length > 0) return { errors, submitted: record };
  return { errors, sanitized: { participantId: (id as string).trim() }, submitted: record };
}

export const validateOpenThreadBody: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const result = validateOpenThreadInput(req.body);
  if (Object.keys(result.errors).length > 0) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: result.errors,
      fieldErrors: result.errors,
      submitted: sanitizeSubmittedChatDraft(result.submitted),
    });
    return;
  }
  req.body = result.sanitized;
  next();
};

/**
 * Validates `:threadId` route parameter as a UUID (US-032 / #387).
 * Rejects malformed UUIDs with 400 VALIDATION_ERROR before any database lookup.
 */
export const validateDmThreadIdParam: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const rawThreadId = req.params.threadId;
  const threadId = Array.isArray(rawThreadId) ? rawThreadId[0] : rawThreadId;

  if (!threadId || typeof threadId !== 'string' || !UUID_REGEX.test(threadId.trim())) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: { threadId: 'threadId must be a valid UUID.' },
      fieldErrors: { threadId: 'threadId must be a valid UUID.' },
      submitted: { threadId: threadId ?? null },
    });
    return;
  }

  req.params.threadId = threadId.trim();
  next();
};

/**
 * Validates POST /api/direct-messages/threads/:threadId/messages (US-032 / #387).
 * Echoes submitted composer draft on failure (NR-017).
 */
export function validateSendMessageInput(raw: unknown): {
  errors: Record<string, string>;
  sanitized: { body: string } | null;
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
  const errors: Record<string, string> = {};

  for (const key of Object.keys(record)) {
    if (!SEND_MESSAGE_KEYS.has(key)) {
      errors[key] = `Unknown field "${key}".`;
    }
  }

  const bodyNormalized = normalizeChatMessageBody(
    typeof record.body === 'string' ? record.body : null
  );
  if (typeof record.body !== 'string' || bodyNormalized == null) {
    errors.body = 'body is required.';
  } else if (isChatMessageBodyTooLong(record.body)) {
    errors.body = `body must be at most ${CHAT_MESSAGE_BODY_MAX_LENGTH} characters.`;
  }

  if (Object.keys(errors).length > 0) {
    return { errors, sanitized: null, submitted };
  }

  return {
    errors: {},
    sanitized: { body: bodyNormalized! },
    submitted,
  };
}

export const validateSendMessageBody: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const result = validateSendMessageInput(req.body);
  if (Object.keys(result.errors).length > 0) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: result.errors,
      fieldErrors: result.errors,
      submitted: sanitizeSubmittedChatDraft(result.submitted),
    });
    return;
  }
  req.body = result.sanitized;
  next();
};

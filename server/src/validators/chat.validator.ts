import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  CHAT_CHANNEL_DESCRIPTION_MAX_LENGTH,
  CHAT_CHANNEL_TITLE_MAX_LENGTH,
  CHAT_MESSAGE_BODY_MAX_LENGTH,
  isChatDescriptionTooLong,
  isChatMessageBodyTooLong,
  isChatTitleTooLong,
  normalizeChatDescription,
  normalizeChatMessageBody,
  normalizeChatTitle,
} from '../db/chatModel.js';
import { sanitizeSubmittedChatDraft } from '../services/chatPrivacy.js';
import { UUID_REGEX } from './team.validator.js';

export interface ChatFieldErrors {
  title?: string;
  description?: string;
  body?: string;
  channelId?: string;
  [unknownKey: string]: string | undefined;
}

export interface CreateChannelSanitized {
  title: string;
  description: string;
}

export interface SendMessageSanitized {
  body: string;
}

const CREATE_CHANNEL_KEYS = new Set(['title', 'description']);
const SEND_MESSAGE_KEYS = new Set(['body']);

/**
 * Validates POST /api/chat/channels (FR-087).
 * Echoes submitted values on failure so the client can preserve drafts (NR-017).
 */
export function validateCreateChannelInput(raw: unknown): {
  errors: ChatFieldErrors;
  sanitized: CreateChannelSanitized | null;
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
  const errors: ChatFieldErrors = {};

  for (const key of Object.keys(record)) {
    if (!CREATE_CHANNEL_KEYS.has(key)) {
      errors[key] = `Unknown field "${key}".`;
    }
  }

  const titleNormalized = normalizeChatTitle(
    typeof record.title === 'string' ? record.title : null
  );
  if (typeof record.title !== 'string' || titleNormalized == null) {
    errors.title = 'title is required.';
  } else if (isChatTitleTooLong(record.title)) {
    errors.title = `title must be at most ${CHAT_CHANNEL_TITLE_MAX_LENGTH} characters.`;
  }

  const descriptionNormalized = normalizeChatDescription(
    typeof record.description === 'string' ? record.description : null
  );
  if (typeof record.description !== 'string' || descriptionNormalized == null) {
    errors.description = 'description is required.';
  } else if (isChatDescriptionTooLong(record.description)) {
    errors.description = `description must be at most ${CHAT_CHANNEL_DESCRIPTION_MAX_LENGTH} characters.`;
  }

  if (Object.keys(errors).length > 0) {
    return { errors, sanitized: null, submitted };
  }

  return {
    errors: {},
    sanitized: {
      title: titleNormalized!,
      description: descriptionNormalized!,
    },
    submitted,
  };
}

export const validateCreateChannelBody: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const result = validateCreateChannelInput(req.body);
  if (Object.keys(result.errors).length > 0) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: result.errors,
      fieldErrors: result.errors,
      // FR-089 / #345 — never echo credentials/OTPs/emails from a draft.
      submitted: sanitizeSubmittedChatDraft(result.submitted),
    });
    return;
  }
  req.body = result.sanitized;
  next();
};

/**
 * Validates POST /api/chat/channels/:channelId/messages (FR-088).
 * Echoes submitted composer draft on failure (NR-017).
 */
export function validateSendMessageInput(raw: unknown): {
  errors: ChatFieldErrors;
  sanitized: SendMessageSanitized | null;
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
  const errors: ChatFieldErrors = {};

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
      // FR-089 / #345 — never echo credentials/OTPs/emails from a draft.
      submitted: sanitizeSubmittedChatDraft(result.submitted),
    });
    return;
  }
  req.body = result.sanitized;
  next();
};

export const validateChatChannelIdParam: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const channelId = req.params.channelId;
  if (!channelId || typeof channelId !== 'string' || !UUID_REGEX.test(channelId)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: { channelId: 'channelId must be a valid UUID.' },
      fieldErrors: { channelId: 'channelId must be a valid UUID.' },
      submitted: { channelId: channelId ?? null },
    });
    return;
  }
  next();
};

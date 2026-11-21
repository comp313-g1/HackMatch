import type { NextFunction, Request, Response } from 'express';
import { CHAT_REACTIONS, isChatReaction, type ChatReaction } from '../db/chatReactionModel.js';
import { UUID_REGEX } from './team.validator.js';

/** Validated target stored on `res.locals.reactionTarget` for the route handler. */
export interface ReactionTarget {
  messageId: string;
  reaction: ChatReaction;
}

/**
 * US-035 / #405 — `:messageId` and `:reaction` path parameters for reaction
 * add/remove routes. Only the eight approved codes are accepted, matched
 * exactly; arbitrary emoji, text, or client-defined names are rejected.
 * Request bodies are ignored: the reactor is always the authenticated caller.
 */
export function validateReactionParams(req: Request, res: Response, next: NextFunction): void {
  const rawMessageId = req.params.messageId;
  const rawReaction = req.params.reaction;
  const messageId = typeof rawMessageId === 'string' ? rawMessageId.trim() : '';
  const errors: Record<string, string> = {};

  if (!UUID_REGEX.test(messageId)) {
    errors.messageId = 'messageId must be a valid UUID.';
  }
  if (!isChatReaction(rawReaction)) {
    errors.reaction = `reaction must be one of: ${CHAT_REACTIONS.join(', ')}.`;
  }

  if (Object.keys(errors).length > 0) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors,
      fieldErrors: errors,
    });
    return;
  }

  const target: ReactionTarget = { messageId: messageId.toLowerCase(), reaction: rawReaction as ChatReaction };
  res.locals.reactionTarget = target;
  next();
}

import type { Request, Response, NextFunction } from 'express';
import { UUID_REGEX } from '../validators/team.validator.js';
import { ChatServiceError } from '../services/chat.js';
import {
  assertCanSendInDirectThread,
  authorizeDirectThreadAccess,
  type AuthorizedDirectThread,
} from '../services/directMessageAccess.js';

/**
 * US-032 / #388 — gates every route under `/threads/:threadId`. Run after the participant auth
 * chain (needs `req.participant`). Stores the authorized thread on `res.locals.directThread`.
 *
 *  requireDirectThreadParticipant  -> read access (the two participants only)
 *  requireDirectThreadSendAccess   -> read access + peer eligible + no block either way
 */

function sendDenial(res: Response, err: ChatServiceError): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(err.status).json({ error: err.message, code: err.code });
}

export async function requireDirectThreadParticipant(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const raw = req.params.threadId;
    const threadId = typeof raw === 'string' ? raw.trim() : '';
    if (!UUID_REGEX.test(threadId)) {
      res.status(400).json({
        error: 'Validation failed.',
        code: 'VALIDATION_ERROR',
        errors: { threadId: 'threadId must be a valid UUID.' },
      });
      return;
    }
    res.locals.directThread = await authorizeDirectThreadAccess({ caller: req.participant!, threadId });
    next();
  } catch (err) {
    if (err instanceof ChatServiceError) return sendDenial(res, err);
    next(err);
  }
}

export async function requireDirectThreadSendAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  await requireDirectThreadParticipant(req, res, async (err?: unknown) => {
    if (err) return next(err);
    try {
      await assertCanSendInDirectThread({
        caller: req.participant!,
        access: res.locals.directThread as AuthorizedDirectThread,
      });
      next();
    } catch (e) {
      if (e instanceof ChatServiceError) return sendDenial(res, e);
      next(e);
    }
  });
}

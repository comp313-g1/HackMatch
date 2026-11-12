import type { NextFunction, Request, Response } from 'express';
import { isChatTypingEnabled } from '../services/chatTyping.js';
import { RollingWindowLimiter } from '../utils/rollingWindowLimiter.js';

/**
 * US-035 / #407 — request gates shared by every typing route. They run after the
 * PART auth chain, so `req.participant` is the authenticated caller.
 */

/** #404 sections 5 and 10: 40 typing signals per participant per rolling minute. */
export const TYPING_RATE_LIMIT_MAX = 40;
export const TYPING_RATE_LIMIT_WINDOW_MS = 60_000;

const typingLimiter = new RollingWindowLimiter(TYPING_RATE_LIMIT_MAX, TYPING_RATE_LIMIT_WINDOW_MS);

/** Clears limiter state (tests only). */
export function _resetTypingRateLimiter(): void {
  typingLimiter.reset();
}

/** #404 section 8: when RICH_CHAT_TYPING_ENABLED is off, typing routes act as if they do not exist. */
export function requireTypingEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (!isChatTypingEnabled()) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: 'This chat feature is not available.', code: 'FEATURE_DISABLED' });
    return;
  }
  next();
}

/**
 * One bucket per authenticated participant, shared by public, team, and DM typing
 * signals. Every request that reaches this point uses one unit (including stops and
 * signals that later turn out to be no-ops); requests rejected earlier do not.
 */
export function limitTypingSignals(req: Request, res: Response, next: NextFunction): void {
  const participantId = req.participant?.id;
  if (!participantId) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
    return;
  }
  const result = typingLimiter.consume(participantId);
  if (!result.allowed) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    res.status(429).json({
      error: 'Too many typing updates. Please wait a moment.',
      code: 'RATE_LIMITED',
      retryAfterSeconds: result.retryAfterSeconds,
    });
    return;
  }
  next();
}

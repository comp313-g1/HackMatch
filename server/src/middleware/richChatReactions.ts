import type { NextFunction, Request, Response } from 'express';
import { isChatReactionsEnabled } from '../services/chatReactionSummaries.js';
import { consumeReactionMutation } from '../services/reactionRateLimiter.js';

/**
 * US-035 / #405 — request gates shared by every reaction route.
 * Both run after the PART auth chain, so `req.participant` is the authenticated caller.
 */

/** #404 section 8: when RICH_CHAT_REACTIONS_ENABLED is off the route acts as if it does not exist. */
export function requireReactionsEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (!isChatReactionsEnabled()) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: 'This chat feature is not available.', code: 'FEATURE_DISABLED' });
    return;
  }
  next();
}

/**
 * 30 reaction mutations per participant per rolling minute, one shared bucket for
 * public, team, and direct-message routes. Keyed only by the authenticated id.
 */
export function limitReactionMutations(req: Request, res: Response, next: NextFunction): void {
  const participantId = req.participant?.id;
  if (!participantId) {
    // Unreachable behind the auth chain; fail closed rather than share an anonymous bucket.
    res.setHeader('Cache-Control', 'no-store');
    res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
    return;
  }

  const result = consumeReactionMutation(participantId);
  if (!result.allowed) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    res.status(429).json({
      error: 'Too many reaction changes. Please wait a moment and try again.',
      code: 'RATE_LIMITED',
      retryAfterSeconds: result.retryAfterSeconds,
    });
    return;
  }
  next();
}

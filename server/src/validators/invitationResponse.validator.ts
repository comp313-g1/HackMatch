import type { Request, Response, NextFunction } from 'express';
import type { InvitationResponseDecision } from '../services/invitationResponse.js';

const DECISIONS = new Set<InvitationResponseDecision>(['accept', 'decline']);

/**
 * Validates POST /api/invitations/:id/respond body (US-019 / #179).
 * Preserves unknown fields aside from decision for draft-friendly clients.
 */
export function validateRespondInvitationBody(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const body = (req.body ?? {}) as { decision?: unknown };
  const raw = typeof body.decision === 'string' ? body.decision.trim().toLowerCase() : '';

  if (!raw || !DECISIONS.has(raw as InvitationResponseDecision)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Decision must be accept or decline.',
      code: 'VALIDATION_ERROR',
      errors: {
        decision: 'Choose accept or decline.',
      },
    });
    return;
  }

  req.body = {
    ...body,
    decision: raw as InvitationResponseDecision,
  };
  next();
}

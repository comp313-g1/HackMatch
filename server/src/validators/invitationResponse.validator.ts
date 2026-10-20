import type { Request, Response, NextFunction } from 'express';
import type { InvitationResponseDecision } from '../services/invitationResponse.js';
import { UUID_REGEX } from './team.validator.js';

const DECISIONS = new Set<InvitationResponseDecision>(['accept', 'decline']);

/** Reject malformed invitation identifiers before they reach PostgreSQL UUID casts. */
export function validateInvitationIdParam(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const invitationId = String(req.params.id ?? '').trim();
  if (!UUID_REGEX.test(invitationId)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Invitation id must be a valid UUID.',
      code: 'VALIDATION_ERROR',
      errors: { invitationId: 'Invitation id must be a valid UUID.' },
    });
    return;
  }

  req.params.id = invitationId;
  next();
}

/**
 * Validates POST /api/invitations/:id/respond body (US-019 / #179).
 * Preserves unknown fields aside from decision for draft-friendly clients.
 */
export function validateRespondInvitationBody(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const body = (req.body ?? {}) as { decision?: unknown; eventId?: unknown };

  if ('eventId' in body && body.eventId !== undefined) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: { eventId: 'Unknown field "eventId".' },
    });
    return;
  }

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

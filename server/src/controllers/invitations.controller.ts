import type { Request, Response, NextFunction } from 'express';
import { issueInvitation } from '../services/invitations.js';
import { toTeamServiceError } from '../services/teamErrors.js';

function handleInvitationError(err: unknown, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  const serviceErr = toTeamServiceError(err);
  if (serviceErr) {
    res.status(serviceErr.status).json({
      error: serviceErr.message,
      code: serviceErr.code,
      ...(serviceErr.details ? { details: serviceErr.details } : {}),
    });
    return;
  }
  next(err);
}

/**
 * POST /api/teams/:teamId/invitations
 * Owner-only slot invitation (US-017 / FR-049). FR-048 uses source=recommendation.
 */
export async function issueInvitationHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const teamId = String(req.params.teamId || '').trim();
    const { vacancyId, inviteeParticipantId, source } = req.body as {
      vacancyId: string;
      inviteeParticipantId: string;
      source: 'recommendation' | 'direct';
    };

    const invitation = await issueInvitation({
      actorParticipantId: actorId,
      teamId,
      vacancyId,
      inviteeParticipantId,
      source,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ invitation });
  } catch (err: unknown) {
    handleInvitationError(err, res, next);
  }
}

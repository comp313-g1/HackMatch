import type { Request, Response, NextFunction } from 'express';
import { issueInvitation, listOwnerInvitations } from '../services/invitations.js';
import { TEAM_ERROR_CATALOG, toTeamServiceError, type TeamErrorCode } from '../services/teamErrors.js';

function fieldErrorsForInvitationCode(
  code: TeamErrorCode
): Record<string, string> | undefined {
  const message = TEAM_ERROR_CATALOG[code]?.message ?? 'Validation failed.';
  switch (code) {
    case 'VACANCY_NOT_FOUND':
    case 'VACANCY_NOT_OPEN':
    case 'SLOT_PENDING_INVITATION_EXISTS':
      return { vacancyId: message };
    case 'INVITEE_NOT_ELIGIBLE':
    case 'INVITEE_NOT_AVAILABLE':
    case 'INVITEE_ALREADY_CONFIRMED':
    case 'DUPLICATE_PENDING_INVITATION':
    case 'CANNOT_INVITE_SELF':
      return { inviteeParticipantId: message };
    default:
      return undefined;
  }
}

function handleInvitationError(err: unknown, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  const serviceErr = toTeamServiceError(err);
  if (serviceErr) {
    const errors = fieldErrorsForInvitationCode(serviceErr.code);
    res.status(serviceErr.status).json({
      error: serviceErr.message,
      code: serviceErr.code,
      ...(serviceErr.details ? { details: serviceErr.details } : {}),
      ...(errors ? { errors } : {}),
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

/**
 * GET /api/teams/:teamId/invitations
 * Owner-only outbound invitation list (US-017 / #162).
 */
export async function listTeamInvitationsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const teamId = String(req.params.teamId || '').trim();
    const result = await listOwnerInvitations(actorId, teamId);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(result);
  } catch (err: unknown) {
    handleInvitationError(err, res, next);
  }
}

import type { Request, Response, NextFunction } from 'express';
import { acceptInvitation } from '../services/invitationAcceptance.js';
import {
  getInvitationDetailForInvitee,
  listMyInvitations,
  respondToInvitation,
  type InvitationResponseDecision,
} from '../services/invitationResponse.js';
import {
  cancelInvitation,
  issueInvitation,
  listOwnerInvitations,
} from '../services/invitations.js';
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
    case 'INVITATION_EXPIRED':
    case 'INVITATION_NOT_ACCEPTABLE':
    case 'INVITATION_NOT_CANCELABLE':
    case 'INVITATION_NOT_DECLINABLE':
    case 'INVITATION_NOT_FOUND':
    case 'FORBIDDEN_NOT_INVITEE':
      return { invitationId: message };
    case 'VALIDATION_ERROR':
      return { decision: message };
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

/**
 * POST /api/invitations/:id/accept
 * US-019 / #180 / FR-056 / FR-083 — atomically revalidate and confirm membership.
 */
export async function acceptInvitationHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const invitationId = String(req.params.id || '').trim();
    if (!invitationId) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({
        error: 'Invitation id is required.',
        code: 'VALIDATION_ERROR',
        errors: { invitationId: 'Invitation id is required.' },
      });
      return;
    }

    const result = await acceptInvitation({
      actorParticipantId: actorId,
      invitationId,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      accepted: true,
      invitation: {
        id: result.invitation.id,
        teamId: result.invitation.team_id,
        eventId: result.invitation.event_id,
        vacancyId: result.invitation.vacancy_id,
        inviteeParticipantId: result.invitation.participant_id,
        status: result.invitation.status,
        expiresAt: result.invitation.expires_at,
        teamName: result.teamName,
        vacancyRole: result.vacancyRole,
      },
      membership: {
        id: result.membership.id,
        teamId: result.membership.team_id,
        eventId: result.membership.event_id,
        participantId: result.membership.participant_id,
        role: result.membership.role,
        status: result.membership.status,
        joinedAt: result.membership.joined_at,
      },
      vacancy: {
        id: result.vacancy.id,
        status: result.vacancy.status,
        role: result.vacancy.role,
      },
      memberCount: result.memberCount,
      maxTeamSize: result.maxTeamSize,
      availabilityCleared: result.availabilityCleared,
      notice: result.notice,
    });
  } catch (err: unknown) {
    handleInvitationError(err, res, next);
  }
}

/**
 * DELETE /api/invitations/:id
 * US-017 / #166 / FR-052 — owner cancels Pending invitation; basic status alerts for both.
 */
export async function cancelInvitationHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const invitationId = String(req.params.id || '').trim();
    if (!invitationId) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({
        error: 'Invitation id is required.',
        code: 'VALIDATION_ERROR',
        errors: { invitationId: 'Invitation id is required.' },
      });
      return;
    }

    const result = await cancelInvitation(actorId, invitationId);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(result);
  } catch (err: unknown) {
    handleInvitationError(err, res, next);
  }
}

/**
 * GET /api/invitations/mine
 * US-019 / #179 — addressed PART inspects inbound invitations.
 */
export async function listMyInvitationsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const result = await listMyInvitations(actorId);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(result);
  } catch (err: unknown) {
    handleInvitationError(err, res, next);
  }
}

/**
 * GET /api/invitations/:id
 * US-019 / #179 — invitee-only detail with permitted team/slot fields (AC1).
 */
export async function getInvitationDetailHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const invitationId = String(req.params.id || '').trim();
    if (!invitationId) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({
        error: 'Invitation id is required.',
        code: 'VALIDATION_ERROR',
        errors: { invitationId: 'Invitation id is required.' },
      });
      return;
    }

    const invitation = await getInvitationDetailForInvitee(actorId, invitationId);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ invitation });
  } catch (err: unknown) {
    handleInvitationError(err, res, next);
  }
}

/**
 * POST /api/invitations/:id/respond
 * US-019 / #179 — accept (FR-051 revalidation) or decline (FR-058).
 */
export async function respondInvitationHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const invitationId = String(req.params.id || '').trim();
    if (!invitationId) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({
        error: 'Invitation id is required.',
        code: 'VALIDATION_ERROR',
        errors: { invitationId: 'Invitation id is required.' },
      });
      return;
    }

    const { decision } = req.body as { decision: InvitationResponseDecision };
    const result = await respondToInvitation(actorId, invitationId, decision);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(result);
  } catch (err: unknown) {
    handleInvitationError(err, res, next);
  }
}

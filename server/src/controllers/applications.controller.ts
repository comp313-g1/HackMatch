import type { Request, Response, NextFunction } from 'express';
import { submitApplication } from '../services/applications.js';
import { TEAM_ERROR_CATALOG, toTeamServiceError, type TeamErrorCode } from '../services/teamErrors.js';

function fieldErrorsForApplicationCode(
  code: TeamErrorCode
): Record<string, string> | undefined {
  const message = TEAM_ERROR_CATALOG[code]?.message ?? 'Validation failed.';
  switch (code) {
    case 'VACANCY_NOT_FOUND':
    case 'VACANCY_NOT_OPEN':
      return { vacancyId: message };
    case 'APPLICATION_MESSAGE_TOO_LONG':
      return { message };
    case 'DUPLICATE_PENDING_APPLICATION':
    case 'APPLICATION_PENDING_LIMIT':
    case 'APPLICANT_ALREADY_CONFIRMED':
    case 'APPLICANT_NOT_ELIGIBLE':
    case 'CANNOT_APPLY_TO_OWN_TEAM':
      return { _form: message };
    default:
      return undefined;
  }
}

function handleApplicationError(err: unknown, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  const serviceErr = toTeamServiceError(err);
  if (serviceErr) {
    const errors = fieldErrorsForApplicationCode(serviceErr.code);
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
 * POST /api/teams/:teamId/applications
 * Verified PART applies to an open slot (US-018 / #172 / FR-053 / FR-054).
 */
export async function submitApplicationHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const teamId = String(req.params.teamId || '').trim();
    const { vacancyId, message } = req.body as {
      vacancyId: string;
      message: string | null;
    };

    const application = await submitApplication({
      actorParticipantId: actorId,
      teamId,
      vacancyId,
      message,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ application });
  } catch (err: unknown) {
    handleApplicationError(err, res, next);
  }
}

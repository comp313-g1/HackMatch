import type { Request, Response, NextFunction } from 'express';
import {
  listMyApplications,
  listOwnerApplications,
  submitApplication,
  withdrawApplication,
} from '../services/applications.js';
import { TEAM_ERROR_CATALOG, toTeamServiceError, type TeamErrorCode } from '../services/teamErrors.js';
import { approveApplication } from '../services/applicationApproval.js';

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
    case 'APPLICATION_NOT_FOUND':
    case 'APPLICATION_NOT_WITHDRAWABLE':
    case 'APPLICATION_NOT_APPROVABLE':
    case 'APPLICATION_APPLICANT_NOT_ELIGIBLE':
    case 'APPLICATION_APPLICANT_ALREADY_CONFIRMED':
    case 'APPLICATION_APPROVAL_CONFLICT':
    case 'FORBIDDEN_NOT_APPLICANT':
      return { _form: message };
    default:
      return undefined;
  }
}

/** POST /api/applications/:applicationId/approve — atomic owner approval (#190). */
export async function approveApplicationHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await approveApplication({
      actorParticipantId: req.participant!.id,
      applicationId: String(req.params.applicationId || '').trim(),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(result);
  } catch (err: unknown) {
    handleApplicationError(err, res, next);
  }
}

/** GET /api/teams/:teamId/applications — owner-only Pending Review queue (#188). */
export async function listTeamApplicationsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const teamId = String(req.params.teamId || '').trim();
    const result = await listOwnerApplications(actorId, teamId);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(result);
  } catch (err: unknown) {
    handleApplicationError(err, res, next);
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
 * Verified PART applies to an open slot (US-018 / #172 / #176 / FR-053 / FR-054).
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

/**
 * GET /api/applications/mine
 * US-018 / #175 — applicant inspects application statuses.
 */
export async function listMyApplicationsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const result = await listMyApplications(actorId);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(result);
  } catch (err: unknown) {
    handleApplicationError(err, res, next);
  }
}

/**
 * POST /api/applications/:applicationId/withdraw
 * US-018 / #175 / FR-055 — applicant withdraws Pending Review; alerts both parties.
 */
export async function withdrawApplicationHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const applicationId = String(req.params.applicationId || '').trim();
    if (!applicationId) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({
        error: 'Application id is required.',
        code: 'VALIDATION_ERROR',
        errors: { applicationId: 'Application id is required.' },
      });
      return;
    }

    const result = await withdrawApplication(actorId, applicationId);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(result);
  } catch (err: unknown) {
    handleApplicationError(err, res, next);
  }
}

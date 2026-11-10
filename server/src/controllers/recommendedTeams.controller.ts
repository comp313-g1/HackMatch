import type { Request, Response, NextFunction } from 'express';
import { getRecommendedTeamsForParticipant } from '../services/recommendedTeams.js';
import { omitInternalIdentifierFields } from '../services/scoreExplanation.js';
import { toTeamServiceError } from '../services/teamErrors.js';

function handleRecommendedTeamsError(err: unknown, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  const serviceErr = toTeamServiceError(err);
  if (serviceErr) {
    res.status(serviceErr.status).json(
      omitInternalIdentifierFields({
        error: serviceErr.message,
        code: serviceErr.code,
        ...(serviceErr.details ? { details: serviceErr.details } : {}),
      })
    );
    return;
  }
  next(err);
}

/**
 * GET /api/scoring/teams/recommendations
 *
 * Participant-facing reverse recommendation (US-016 / FR-043–045 / FR-047 / NR-016).
 * Zero request parameters on purpose: the actor is the verified token subject, so a
 * participant can only ever rank teams against their own declared profile (AC-6).
 */
export async function getRecommendedTeamsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const result = await getRecommendedTeamsForParticipant(actorId);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(omitInternalIdentifierFields(result));
  } catch (err: unknown) {
    handleRecommendedTeamsError(err, res, next);
  }
}

import type { Request, Response, NextFunction } from 'express';
import { getRecommendationsForOpenSlot } from '../services/recommendations.js';
import { getEligibleTeamRecommendations } from '../services/teamRecommendations.js';
import { omitInternalIdentifierFields } from '../services/scoreExplanation.js';
import { toTeamServiceError } from '../services/teamErrors.js';

function handleRecommendationError(err: unknown, res: Response, next: NextFunction): void {
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
 * GET /api/teams/:teamId/slots/:slotId/recommendations
 * GET /api/teams/:teamId/vacancies/:vacancyId/recommendations
 * Owner-only ranked candidates with FR-047 explanations (no internal ranking ids).
 */
export async function getVacancyRecommendationsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const teamId = String(req.params.teamId || '').trim();
    const slotOrVacancyId = String(req.params.slotId || req.params.vacancyId || '').trim();

    const result = await getRecommendationsForOpenSlot(actorId, teamId, slotOrVacancyId);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(
      omitInternalIdentifierFields({
        ...result,
        slotId: result.vacancyId,
      })
    );
  } catch (err: unknown) {
    handleRecommendationError(err, res, next);
  }
}

/**
 * GET /api/recommendations/teams
 * Returns only the authenticated participant's platform-wide eligible team/vacancy candidates.
 */
export async function getMyTeamRecommendationsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await getEligibleTeamRecommendations(req.participant!.id);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(result);
  } catch (err: unknown) {
    next(err);
  }
}

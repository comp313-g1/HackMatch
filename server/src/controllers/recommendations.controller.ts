import type { Request, Response, NextFunction } from 'express';
import { getRecommendationsForOpenSlot } from '../services/recommendations.js';
import { toTeamServiceError } from '../services/teamErrors.js';

function handleRecommendationError(err: unknown, res: Response, next: NextFunction): void {
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
 * GET /api/teams/:teamId/vacancies/:vacancyId/recommendations
 * Owner-only ranked candidates for an open vacancy (US-015).
 */
export async function getVacancyRecommendationsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const teamId = String(req.params.teamId || '').trim();
    const vacancyId = String(req.params.vacancyId || '').trim();

    const result = await getRecommendationsForOpenSlot(actorId, teamId, vacancyId);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(result);
  } catch (err: unknown) {
    handleRecommendationError(err, res, next);
  }
}

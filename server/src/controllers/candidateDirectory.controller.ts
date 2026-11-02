import type { Request, Response, NextFunction } from 'express';
import {
  queryCandidateDirectoryForTeamOwner,
  type CandidateDirectoryDeps,
} from '../services/candidateDirectory.js';
import { validateCandidateDirectoryQuery } from '../validators/candidateDirectory.validator.js';
import { toTeamServiceError } from '../services/teamErrors.js';

function handleCandidateDirectoryError(err: unknown, res: Response, next: NextFunction): void {
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

export function createCandidateDirectoryHandler(injectedDeps?: CandidateDirectoryDeps) {
  return async function getTeamCandidateDirectoryHandler(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const actorId = req.participant!.id;
      const teamId = String(req.params.teamId || '').trim();

      // Check if validation middleware already attached sanitized filters; otherwise validate req.query
      const validation =
        (res.locals.candidateDirectoryFilters as typeof res.locals.candidateDirectoryFilters | undefined)
          ? { ok: true as const, filters: res.locals.candidateDirectoryFilters }
          : validateCandidateDirectoryQuery(req.query as Record<string, unknown>);

      if (!validation.ok) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(400).json({
          error: 'Invalid candidate directory filter parameters.',
          code: 'VALIDATION_ERROR',
          errors: validation.errors,
        });
        return;
      }

      const result = await queryCandidateDirectoryForTeamOwner(
        {
          actorParticipantId: actorId,
          teamId,
          filters: validation.filters,
        },
        injectedDeps
      );

      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(result);
    } catch (err: unknown) {
      handleCandidateDirectoryError(err, res, next);
    }
  };
}

export const getTeamCandidateDirectoryHandler = createCandidateDirectoryHandler();

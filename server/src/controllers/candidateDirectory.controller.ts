import type { Request, Response, NextFunction } from 'express';
import {
  queryCandidateDirectoryForTeamOwner,
  type CandidateDirectoryDeps,
  type CandidateDirectoryFilters,
  type SkillMatchMode,
} from '../services/candidateDirectory.js';
import { toTeamServiceError } from '../services/teamErrors.js';
import type { ParticipantPrimaryRole, ExperienceBadge, TeamGoal } from '../db/types.js';

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

function parseFilterQuery(query: Request['query']): CandidateDirectoryFilters {
  const filters: CandidateDirectoryFilters = {};

  if (query.skills) {
    if (Array.isArray(query.skills)) {
      filters.skills = query.skills.map((s) => String(s).trim()).filter(Boolean);
    } else if (typeof query.skills === 'string') {
      filters.skills = query.skills.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }

  const rawMode = String(query.skillMatchMode || query.matchMode || '').trim().toUpperCase();
  if (rawMode === 'OR') {
    filters.skillMatchMode = 'OR' as SkillMatchMode;
  } else if (rawMode === 'AND') {
    filters.skillMatchMode = 'AND' as SkillMatchMode;
  }

  const rawRole = String(query.role || query.primaryRole || '').trim();
  if (rawRole) {
    filters.role = rawRole as ParticipantPrimaryRole;
  }

  const rawDesiredRole = String(query.desiredRole || '').trim();
  if (rawDesiredRole) {
    filters.desiredRole = rawDesiredRole as ParticipantPrimaryRole;
  }

  if (query.minHours !== undefined && query.minHours !== '') {
    const n = Number(query.minHours);
    if (!Number.isNaN(n)) filters.minHours = n;
  }

  if (query.maxHours !== undefined && query.maxHours !== '') {
    const n = Number(query.maxHours);
    if (!Number.isNaN(n)) filters.maxHours = n;
  }

  const rawBadge = String(query.badge || query.experienceBadge || '').trim();
  if (rawBadge) {
    filters.badge = rawBadge as ExperienceBadge;
  }

  const rawGoal = String(query.goal || '').trim();
  if (rawGoal) {
    filters.goal = rawGoal as TeamGoal;
  }

  const rawSearch = String(query.search || '').trim();
  if (rawSearch) {
    filters.search = rawSearch;
  }

  return filters;
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
      const filters = parseFilterQuery(req.query);

      const result = await queryCandidateDirectoryForTeamOwner(
        {
          actorParticipantId: actorId,
          teamId,
          filters,
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

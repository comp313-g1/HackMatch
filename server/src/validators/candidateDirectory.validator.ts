import type { Request, Response, NextFunction } from 'express';
import type { ExperienceBadge, TeamGoal } from '../db/types.js';
import { ALLOWED_PRIMARY_ROLES } from './profile.validator.js';
import { TEAM_GOALS } from './team.validator.js';
import type { CandidateDirectoryFilters, SkillMatchMode } from '../services/candidateDirectory.js';

export const ALLOWED_SKILL_MATCH_MODES = ['AND', 'OR'] as const;
export const ALLOWED_EXPERIENCE_BADGES: readonly ExperienceBadge[] = [
  'Beginner',
  'Competitor',
  'Veteran',
] as const;
export const ALLOWED_GOALS: readonly TeamGoal[] = TEAM_GOALS;

export const MAX_FILTER_SKILLS = 10;
export const MAX_SKILL_LENGTH = 50;
export const MAX_SEARCH_LENGTH = 80;
export const MIN_COMMITMENT_HOURS = 1;
export const MAX_COMMITMENT_HOURS = 168;

export interface CandidateDirectoryQueryValidationSuccess {
  ok: true;
  filters: CandidateDirectoryFilters;
}

export interface CandidateDirectoryQueryValidationFailure {
  ok: false;
  errors: Record<string, string>;
}

export type CandidateDirectoryQueryValidationResult =
  | CandidateDirectoryQueryValidationSuccess
  | CandidateDirectoryQueryValidationFailure;

export function validateCandidateDirectoryQuery(
  query: Record<string, unknown>
): CandidateDirectoryQueryValidationResult {
  const errors: Record<string, string> = {};
  const filters: CandidateDirectoryFilters = {
    skills: [],
    skillMatchMode: 'AND',
    role: null,
    desiredRole: null,
    minHours: null,
    maxHours: null,
    badge: null,
    goal: null,
    search: null,
  };

  // 1. skills
  if (query.skills !== undefined && query.skills !== null && query.skills !== '') {
    let rawSkillStrings: string[] = [];
    if (Array.isArray(query.skills)) {
      rawSkillStrings = query.skills.map((s) => String(s));
    } else if (typeof query.skills === 'string') {
      rawSkillStrings = query.skills.split(',');
    } else {
      errors.skills = 'Skills filter must be a comma-separated string or array.';
    }

    if (rawSkillStrings.length > 0 && !errors.skills) {
      const trimmed = rawSkillStrings.map((s) => s.trim()).filter(Boolean);
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const skill of trimmed) {
        const lower = skill.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          deduped.push(skill);
        }
      }

      if (deduped.length > MAX_FILTER_SKILLS) {
        errors.skills = `Skills filter cannot exceed ${MAX_FILTER_SKILLS} skills.`;
      } else {
        const tooLong = deduped.find((s) => s.length > MAX_SKILL_LENGTH);
        if (tooLong) {
          errors.skills = `Each skill cannot exceed ${MAX_SKILL_LENGTH} characters.`;
        } else {
          filters.skills = deduped;
        }
      }
    }
  }

  // 2. skillMatchMode
  const rawMode = query.skillMatchMode ?? query.matchMode;
  if (rawMode !== undefined && rawMode !== null && rawMode !== '') {
    if (typeof rawMode !== 'string') {
      errors.skillMatchMode = 'Skill match mode must be "AND" or "OR".';
    } else {
      const upperMode = rawMode.trim().toUpperCase();
      if (ALLOWED_SKILL_MATCH_MODES.includes(upperMode as SkillMatchMode)) {
        filters.skillMatchMode = upperMode as SkillMatchMode;
      } else {
        errors.skillMatchMode = 'Skill match mode must be "AND" or "OR".';
      }
    }
  }

  // 3. role (primaryRole)
  const rawRole = query.role ?? query.primaryRole;
  if (rawRole !== undefined && rawRole !== null && rawRole !== '') {
    if (typeof rawRole !== 'string') {
      errors.role = 'Role filter must be a string.';
    } else {
      const trimmed = rawRole.trim().toLowerCase();
      const match = ALLOWED_PRIMARY_ROLES.find((r) => r.toLowerCase() === trimmed);
      if (match) {
        filters.role = match;
      } else {
        errors.role = `Invalid primary role filter. Must be one of: ${ALLOWED_PRIMARY_ROLES.join(', ')}.`;
      }
    }
  }

  // 4. desiredRole
  if (query.desiredRole !== undefined && query.desiredRole !== null && query.desiredRole !== '') {
    if (typeof query.desiredRole !== 'string') {
      errors.desiredRole = 'Desired role filter must be a string.';
    } else {
      const trimmed = query.desiredRole.trim().toLowerCase();
      const match = ALLOWED_PRIMARY_ROLES.find((r) => r.toLowerCase() === trimmed);
      if (match) {
        filters.desiredRole = match;
      } else {
        errors.desiredRole = `Invalid desired role filter. Must be one of: ${ALLOWED_PRIMARY_ROLES.join(', ')}.`;
      }
    }
  }

  // 5. goal
  if (query.goal !== undefined && query.goal !== null && query.goal !== '') {
    if (typeof query.goal !== 'string') {
      errors.goal = 'Goal filter must be a string.';
    } else {
      const trimmed = query.goal.trim().toLowerCase();
      const match = ALLOWED_GOALS.find((g) => g.toLowerCase() === trimmed);
      if (match) {
        filters.goal = match;
      } else {
        errors.goal = `Invalid goal filter. Must be one of: ${ALLOWED_GOALS.join(', ')}.`;
      }
    }
  }

  // 6. badge (experienceBadge)
  const rawBadge = query.badge ?? query.experienceBadge;
  if (rawBadge !== undefined && rawBadge !== null && rawBadge !== '') {
    if (typeof rawBadge !== 'string') {
      errors.badge = 'Experience badge filter must be a string.';
    } else {
      const trimmed = rawBadge.trim().toLowerCase();
      const match = ALLOWED_EXPERIENCE_BADGES.find((b) => b.toLowerCase() === trimmed);
      if (match) {
        filters.badge = match;
      } else {
        errors.badge = `Invalid experience badge filter. Must be one of: ${ALLOWED_EXPERIENCE_BADGES.join(', ')}.`;
      }
    }
  }

  // 7. minHours and maxHours
  let parsedMinHours: number | null = null;
  let parsedMaxHours: number | null = null;

  if (query.minHours !== undefined && query.minHours !== null && query.minHours !== '') {
    const n = Number(query.minHours);
    if (!Number.isInteger(n) || n < MIN_COMMITMENT_HOURS || n > MAX_COMMITMENT_HOURS) {
      errors.minHours = `Minimum commitment hours must be an integer between ${MIN_COMMITMENT_HOURS} and ${MAX_COMMITMENT_HOURS}.`;
    } else {
      parsedMinHours = n;
      filters.minHours = n;
    }
  }

  if (query.maxHours !== undefined && query.maxHours !== null && query.maxHours !== '') {
    const n = Number(query.maxHours);
    if (!Number.isInteger(n) || n < MIN_COMMITMENT_HOURS || n > MAX_COMMITMENT_HOURS) {
      errors.maxHours = `Maximum commitment hours must be an integer between ${MIN_COMMITMENT_HOURS} and ${MAX_COMMITMENT_HOURS}.`;
    } else {
      parsedMaxHours = n;
      filters.maxHours = n;
    }
  }

  if (
    parsedMinHours !== null &&
    parsedMaxHours !== null &&
    parsedMinHours > parsedMaxHours
  ) {
    errors.hours = 'Minimum commitment hours cannot exceed maximum commitment hours.';
  }

  // 8. search
  if (query.search !== undefined && query.search !== null && query.search !== '') {
    if (typeof query.search !== 'string') {
      errors.search = 'Search query must be a string.';
    } else {
      const trimmed = query.search.trim();
      if (trimmed.length > MAX_SEARCH_LENGTH) {
        errors.search = `Search query cannot exceed ${MAX_SEARCH_LENGTH} characters.`;
      } else if (trimmed.length > 0) {
        filters.search = trimmed;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, filters };
}

export function validateCandidateDirectoryQueryMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const result = validateCandidateDirectoryQuery(req.query as Record<string, unknown>);
  if (!result.ok) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Invalid candidate directory filter parameters.',
      code: 'VALIDATION_ERROR',
      errors: result.errors,
    });
    return;
  }

  res.locals.candidateDirectoryFilters = result.filters;
  next();
}

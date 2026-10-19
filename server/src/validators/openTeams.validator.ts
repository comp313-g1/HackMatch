import type { Request, Response, NextFunction } from 'express';
import type { TeamGoal, ParticipantPrimaryRole } from '../db/types.js';
import { ALLOWED_PRIMARY_ROLES } from './profile.validator.js';
import { TEAM_GOALS } from './team.validator.js';

export const OPEN_TEAMS_MAX_SKILL_TAGS = 5;
export const OPEN_TEAMS_MAX_MIN_SLOTS = 20;

export interface OpenTeamsQuery {
  skills: string[];                    // normalized, deduped, lowercase; [] = unset
  role: ParticipantPrimaryRole | null; // canonical casing; null = unset
  goal: TeamGoal | null;               // canonical casing; null = unset
  minSlots: number;                    // default 1
}

export type ParseOpenTeamsQueryResult =
  | { errors: Record<string, string>; sanitized?: never }
  | { errors: Record<string, never>; sanitized: OpenTeamsQuery };

export function parseOpenTeamsQuery(
  query: Record<string, unknown>
): ParseOpenTeamsQueryResult {
  const errors: Record<string, string> = {};
  const sanitized: OpenTeamsQuery = {
    skills: [],
    role: null,
    goal: null,
    minSlots: 1,
  };

  // 1. skills
  if (query.skills !== undefined) {
    if (typeof query.skills !== 'string') {
      errors.skills = 'Skills filter must be a string.';
    } else if (query.skills.trim() !== '') {
      const rawTags = query.skills
        .split(',')
        .map((s) => s.trim().replace(/\s+/g, ' ').toLowerCase())
        .filter(Boolean);
      const deduped = Array.from(new Set(rawTags));

      if (deduped.length > OPEN_TEAMS_MAX_SKILL_TAGS) {
        errors.skills = `Skills filter cannot exceed ${OPEN_TEAMS_MAX_SKILL_TAGS} tags.`;
      } else {
        const invalidTag = deduped.find((tag) => tag.length > 50);
        if (invalidTag) {
          errors.skills = 'Each skill tag cannot exceed 50 characters.';
        } else {
          sanitized.skills = deduped;
        }
      }
    }
  }

  // 2. role
  if (query.role !== undefined) {
    if (typeof query.role !== 'string') {
      errors.role = 'Role filter must be a string.';
    } else if (query.role.trim() !== '') {
      const normalized = query.role.trim().toLowerCase();
      const matched = ALLOWED_PRIMARY_ROLES.find(
        (r) => r.toLowerCase() === normalized
      );
      if (matched) {
        sanitized.role = matched;
      } else {
        errors.role = 'Invalid role filter.';
      }
    }
  }

  // 3. goal
  if (query.goal !== undefined) {
    if (typeof query.goal !== 'string') {
      errors.goal = 'Goal filter must be a string.';
    } else if (query.goal.trim() !== '') {
      const normalized = query.goal.trim().replace(/\s+/g, ' ').toLowerCase();
      const matched = TEAM_GOALS.find(
        (g) => g.toLowerCase() === normalized
      );
      if (matched) {
        sanitized.goal = matched;
      } else {
        errors.goal = 'Invalid goal filter.';
      }
    }
  }

  // 4. minSlots
  if (query.minSlots !== undefined) {
    if (typeof query.minSlots !== 'string') {
      errors.minSlots = 'Minimum open slots must be an integer between 1 and 20.';
    } else if (query.minSlots.trim() !== '') {
      const trimmed = query.minSlots.trim();
      if (!/^\d{1,2}$/.test(trimmed)) {
        errors.minSlots = 'Minimum open slots must be an integer between 1 and 20.';
      } else {
        const parsed = parseInt(trimmed, 10);
        if (parsed < 1 || parsed > OPEN_TEAMS_MAX_MIN_SLOTS) {
          errors.minSlots = `Minimum open slots must be an integer between 1 and ${OPEN_TEAMS_MAX_MIN_SLOTS}.`;
        } else {
          sanitized.minSlots = parsed;
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return { errors: {}, sanitized };
}

export function validateOpenTeamsQuery(req: Request, res: Response, next: NextFunction): void {
  const result = parseOpenTeamsQuery(req.query as Record<string, unknown>);
  if ('sanitized' in result && result.sanitized) {
    res.locals.openTeamsQuery = result.sanitized;
    next();
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(400).json({
    error: 'Validation failed.',
    code: 'VALIDATION_ERROR',
    errors: result.errors,
  });
}

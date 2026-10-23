import type { Request, Response, NextFunction } from 'express';
import type { ParticipantPrimaryRole, TeamGoal } from '../db/types.js';
import { ALLOWED_PRIMARY_ROLES } from './profile.validator.js';
import { TEAM_GOALS, TEAM_MAX_COMMITMENT_HOURS } from './team.validator.js';

export const PLATFORM_AVAILABILITY_EVENT_ID = '00000000-0000-4000-8000-000000000001';

export const AVAILABILITY_ROLES: readonly ParticipantPrimaryRole[] = ALLOWED_PRIMARY_ROLES;
export const AVAILABILITY_GOALS: readonly TeamGoal[] = TEAM_GOALS;
export const AVAILABILITY_MIN_COMMITMENT_HOURS = 0;
export const AVAILABILITY_MAX_COMMITMENT_HOURS = TEAM_MAX_COMMITMENT_HOURS; // 168

export type AvailabilityRole = ParticipantPrimaryRole;
export type AvailabilityGoal = TeamGoal;

export interface AvailabilityFieldErrors {
  isLooking?: string;
  desiredRole?: string;
  commitmentHours?: string;
  goal?: string;
  handle?: string;
  institution?: string;
  skills?: string;
  portfolioLinks?: string;
  eventId?: string;
  body?: string;
  _form?: string;
  [unknownKey: string]: string | undefined;
}

export interface ValidatedAvailabilityUpdateInput {
  isLooking: boolean;
  desiredRole?: AvailabilityRole | null;
  commitmentHours?: number | null;
  goal?: AvailabilityGoal | null;
}

const ALLOWED_PAYLOAD_KEYS = new Set(['isLooking', 'desiredRole', 'commitmentHours', 'goal']);

export function normalizeAvailabilityRole(raw: unknown): AvailabilityRole | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  for (const role of AVAILABILITY_ROLES) {
    if (role.toLowerCase() === trimmed) {
      return role;
    }
  }
  return null;
}

export function normalizeAvailabilityGoal(raw: unknown): AvailabilityGoal | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  for (const goal of AVAILABILITY_GOALS) {
    if (goal.toLowerCase() === trimmed) {
      return goal;
    }
  }
  return null;
}

export function validateAvailabilityUpdatePayload(body: unknown): {
  isValid: boolean;
  errors: AvailabilityFieldErrors;
  data?: ValidatedAvailabilityUpdateInput;
} {
  const errors: AvailabilityFieldErrors = {};

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      isValid: false,
      errors: { body: 'Request body must be a JSON object.' },
    };
  }

  const record = body as Record<string, unknown>;

  // Check for unknown keys and explicitly reject client eventId
  for (const key of Object.keys(record)) {
    if (!ALLOWED_PAYLOAD_KEYS.has(key)) {
      if (key === 'eventId') {
        errors.eventId = 'eventId is not accepted for platform-wide availability.';
      } else {
        errors[key] = `Unknown field '${key}' is not allowed.`;
      }
    }
  }

  // 1. isLooking
  if (typeof record.isLooking !== 'boolean') {
    errors.isLooking = 'isLooking must be a boolean.';
  }

  const isLooking = record.isLooking === true;

  // 2. desiredRole
  let desiredRole: AvailabilityRole | null | undefined = undefined;
  if (record.desiredRole !== undefined && record.desiredRole !== null) {
    const normalizedRole = normalizeAvailabilityRole(record.desiredRole);
    if (!normalizedRole) {
      errors.desiredRole = 'Desired role must be one of: Frontend, Backend, Mobile, AI/ML, UI/UX, Pitch.';
    } else {
      desiredRole = normalizedRole;
    }
  } else if (record.desiredRole === null) {
    desiredRole = null;
    if (isLooking) {
      errors.desiredRole = 'Desired role is required when Looking for Team is enabled.';
    }
  } else if (isLooking) {
    errors.desiredRole = 'Desired role is required when Looking for Team is enabled.';
  }

  // 3. commitmentHours
  let commitmentHours: number | null | undefined = undefined;
  if (record.commitmentHours !== undefined && record.commitmentHours !== null) {
    const rawHours = record.commitmentHours;
    if (typeof rawHours !== 'number' || !Number.isFinite(rawHours)) {
      errors.commitmentHours = 'Commitment hours must be a number between 0 and 168 with at most one decimal place.';
    } else if (rawHours < AVAILABILITY_MIN_COMMITMENT_HOURS || rawHours > AVAILABILITY_MAX_COMMITMENT_HOURS) {
      errors.commitmentHours = `Commitment hours must be between ${AVAILABILITY_MIN_COMMITMENT_HOURS} and ${AVAILABILITY_MAX_COMMITMENT_HOURS}.`;
    } else if (Math.round(rawHours * 10) !== rawHours * 10) {
      errors.commitmentHours = 'Commitment hours cannot have more than 1 decimal place.';
    } else {
      commitmentHours = Math.round(rawHours * 10) / 10;
    }
  } else if (record.commitmentHours === null) {
    commitmentHours = null;
    if (isLooking) {
      errors.commitmentHours = 'Commitment hours are required when Looking for Team is enabled.';
    }
  } else if (isLooking) {
    errors.commitmentHours = 'Commitment hours are required when Looking for Team is enabled.';
  }

  // 4. goal
  let goal: AvailabilityGoal | null | undefined = undefined;
  if (record.goal !== undefined && record.goal !== null) {
    const normalizedGoal = normalizeAvailabilityGoal(record.goal);
    if (!normalizedGoal) {
      errors.goal = 'Goal must be one of: Learning, Project Completion, Competitive.';
    } else {
      goal = normalizedGoal;
    }
  } else if (record.goal === null) {
    goal = null;
    if (isLooking) {
      errors.goal = 'Goal is required when Looking for Team is enabled.';
    }
  } else if (isLooking) {
    errors.goal = 'Goal is required when Looking for Team is enabled.';
  }

  if (Object.keys(errors).length > 0) {
    return {
      isValid: false,
      errors,
    };
  }

  return {
    isValid: true,
    errors: {},
    data: {
      isLooking: record.isLooking as boolean,
      ...(desiredRole !== undefined ? { desiredRole } : {}),
      ...(commitmentHours !== undefined ? { commitmentHours } : {}),
      ...(goal !== undefined ? { goal } : {}),
    },
  };
}

export function validateAvailabilityUpdateBody(req: Request, res: Response, next: NextFunction): void {
  const result = validateAvailabilityUpdatePayload(req.body);
  if (!result.isValid || !result.data) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Invalid availability preferences.',
      code: 'VALIDATION_ERROR',
      fieldErrors: result.errors,
      errors: result.errors,
    });
    return;
  }

  req.body = result.data;
  next();
}

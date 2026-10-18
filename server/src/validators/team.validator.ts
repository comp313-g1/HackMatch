import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { TeamGoal, ParticipantPrimaryRole } from '../db/types.js';
import type { TeamListingPatch } from '../db/teams.repository.js';
import { ALLOWED_PRIMARY_ROLES, isValidHttpsPortfolioUrl } from './profile.validator.js';

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const TEAM_GOALS = ['Learning', 'Project Completion', 'Competitive'] as const;
export const TEAM_NAME_MAX = 100;
export const TEAM_PITCH_MAX = 500;
export const TEAM_LINK_MAX = 2048;
export const TEAM_MAX_COMMITMENT_HOURS = 168;
export const VACANCY_SKILLS_MAX = 10;
export const VACANCY_SKILL_MAX_LENGTH = 50;
export const REMOVAL_REASON_MAX = 500;

export interface TeamFieldErrors {
  name?: string;
  pitch?: string;
  goal?: string;
  commitmentHours?: string;
  communicationLink?: string;
  eventId?: string;
  role?: string;
  skills?: string;
  vacancies?: string;
  reason?: string;
  _form?: string;
  body?: string;
  [unknownKey: string]: string | undefined;
}

export interface CreateTeamInputSanitized {
  eventId?: string;
  name: string;
  pitch: string;
  goal: TeamGoal;
  commitmentHours: number;
  communicationLink: string | null;
  maxTeamSize?: number;
}

/**
 * Counts unicode code points accurately (e.g. emoji is 1 code point, not 2 UTF-16 units).
 */
export function codePointLength(s: string): number {
  return [...s].length;
}

/**
 * Normalizes goal string to canonical casing ('Learning', 'Project Completion', 'Competitive')
 * or returns null if invalid.
 */
function normalizeGoal(raw: unknown): TeamGoal | null {
  if (typeof raw !== 'string') return null;
  const collapsed = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  if (collapsed === 'learning') return 'Learning';
  if (collapsed === 'project completion') return 'Project Completion';
  if (collapsed === 'competitive') return 'Competitive';
  return null;
}

/**
 * Validates teamId and optional vacancyId route parameters as valid UUIDs.
 */
export function validateTeamIdParams(req: Request, res: Response, next: NextFunction): void {
  const { teamId, vacancyId, participantId } = req.params;

  if (!teamId || typeof teamId !== 'string' || !UUID_REGEX.test(teamId.trim())) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: { teamId: 'Invalid team ID format.' },
    });
    return;
  }

  if (vacancyId !== undefined) {
    if (typeof vacancyId !== 'string' || !UUID_REGEX.test(vacancyId.trim())) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({
        error: 'Validation failed.',
        code: 'VALIDATION_ERROR',
        errors: { vacancyId: 'Invalid vacancy ID format.' },
      });
      return;
    }
  }

  if (participantId !== undefined) {
    if (typeof participantId !== 'string' || !UUID_REGEX.test(participantId.trim())) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({
        error: 'Validation failed.',
        code: 'VALIDATION_ERROR',
        errors: { participantId: 'Invalid participant ID format.' },
      });
      return;
    }
  }

  next();
}

/**
 * Validates eventId query parameter for GET /api/teams/mine.
 * Optional: when provided, must be a valid UUID. When omitted, allows fetching all participant teams.
 */
export function validateMyTeamQuery(req: Request, res: Response, next: NextFunction): void {
  const { eventId } = req.query;

  if (eventId !== undefined && eventId !== null && String(eventId).trim() !== '') {
    if (typeof eventId !== 'string' || !UUID_REGEX.test(eventId.trim())) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({
        error: 'Validation failed.',
        code: 'VALIDATION_ERROR',
        errors: { eventId: 'Event ID must be a valid UUID if provided.' },
      });
      return;
    }
  }

  next();
}

/**
 * Ensures that request body is a non-null JSON object and not an array.
 */
export function requireJsonObjectBody(req: Request, res: Response, next: NextFunction): void {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: { body: 'Request body must be a JSON object.' },
    });
    return;
  }

  next();
}

/**
 * Pure validation for POST /api/teams payload.
 */
export function validateCreateTeamInput(body: unknown): {
  errors: TeamFieldErrors;
  sanitized?: CreateTeamInputSanitized;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: { body: 'Request body must be a JSON object.' } };
  }

  const record = body as Record<string, unknown>;
  const errors: TeamFieldErrors = {};
  const allowedKeys = ['eventId', 'name', 'pitch', 'goal', 'commitmentHours', 'communicationLink', 'maxTeamSize'];

  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) {
      errors[key] = 'This field cannot be set.';
    }
  }

  // 1. eventId (optional; if provided, must be a valid UUID)
  const rawEventId = record.eventId;
  if (rawEventId !== undefined && rawEventId !== null && String(rawEventId).trim() !== '') {
    if (typeof rawEventId !== 'string' || !UUID_REGEX.test(rawEventId.trim())) {
      errors.eventId = 'Event ID must be a valid UUID.';
    }
  }

  // 2. name
  const rawName = record.name;
  if (typeof rawName !== 'string' || rawName.trim().length === 0) {
    errors.name = 'Team name is required.';
  } else if (codePointLength(rawName.trim()) > TEAM_NAME_MAX) {
    errors.name = `Team name cannot exceed ${TEAM_NAME_MAX} characters.`;
  }

  // 3. pitch (\r\n -> \n, trimmed, 1..500 code points)
  const rawPitch = record.pitch;
  if (typeof rawPitch !== 'string' || rawPitch.trim().length === 0) {
    errors.pitch = 'Pitch is required.';
  } else {
    const normalizedPitch = rawPitch.replace(/\r\n/g, '\n').trim();
    if (codePointLength(normalizedPitch) === 0) {
      errors.pitch = 'Pitch is required.';
    } else if (codePointLength(normalizedPitch) > TEAM_PITCH_MAX) {
      errors.pitch = `Pitch cannot exceed ${TEAM_PITCH_MAX} characters.`;
    }
  }

  // 4. goal
  const normalizedGoal = normalizeGoal(record.goal);
  if (!normalizedGoal) {
    errors.goal = 'Invalid team goal. Must be Learning, Project Completion, or Competitive.';
  }

  // 5. commitmentHours (finite number, 0..168, <= 1 decimal place)
  const rawHours = record.commitmentHours;
  if (typeof rawHours !== 'number' || !Number.isFinite(rawHours)) {
    errors.commitmentHours = 'Commitment hours must be a number between 0 and 168 with at most one decimal place.';
  } else if (rawHours < 0 || rawHours > TEAM_MAX_COMMITMENT_HOURS) {
    errors.commitmentHours = `Commitment hours must be between 0 and ${TEAM_MAX_COMMITMENT_HOURS}.`;
  } else {
    const parts = rawHours.toString().split('.');
    if (parts[1] && parts[1].length > 1) {
      errors.commitmentHours = 'Commitment hours cannot have more than 1 decimal place.';
    }
  }

  // 6. communicationLink (optional, max 2048, valid HTTPS URL without credentials)
  let sanitizedLink: string | null = null;
  const rawLink = record.communicationLink;
  if (rawLink === undefined || rawLink === null || (typeof rawLink === 'string' && rawLink.trim() === '')) {
    sanitizedLink = null;
  } else if (typeof rawLink !== 'string') {
    errors.communicationLink = 'Communication link must be a valid HTTPS URL.';
  } else {
    const trimmedLink = rawLink.trim();
    if (trimmedLink.length > TEAM_LINK_MAX || !isValidHttpsPortfolioUrl(trimmedLink)) {
      errors.communicationLink = 'Communication link must be a valid HTTPS URL (max 2048 characters) without credentials.';
    } else {
      sanitizedLink = trimmedLink;
    }
  }

  // 7. maxTeamSize (optional, integer 2..20)
  let sanitizedMaxTeamSize: number | undefined = undefined;
  const rawMaxTeamSize = record.maxTeamSize;
  if (rawMaxTeamSize !== undefined && rawMaxTeamSize !== null && rawMaxTeamSize !== '') {
    const parsedMax = Number(rawMaxTeamSize);
    if (!Number.isInteger(parsedMax) || parsedMax < 2 || parsedMax > 20) {
      errors.maxTeamSize = 'Maximum team size must be an integer between 2 and 20.';
    } else {
      sanitizedMaxTeamSize = parsedMax;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    errors: {},
    sanitized: {
      ...(rawEventId ? { eventId: String(rawEventId).trim() } : {}),
      name: String(rawName).trim(),
      pitch: String(rawPitch).replace(/\r\n/g, '\n').trim(),
      goal: normalizedGoal!,
      commitmentHours: rawHours as number,
      communicationLink: sanitizedLink,
      ...(sanitizedMaxTeamSize !== undefined ? { maxTeamSize: sanitizedMaxTeamSize } : {}),
    },
  };
}

/**
 * Pure validation for PATCH /api/teams/:teamId payload.
 */
export function validateUpdateTeamInput(body: unknown): {
  errors: TeamFieldErrors;
  sanitized?: TeamListingPatch;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: { body: 'Request body must be a JSON object.' } };
  }

  const record = body as Record<string, unknown>;
  const errors: TeamFieldErrors = {};
  const allowedKeys = ['name', 'pitch', 'goal', 'commitmentHours', 'communicationLink'];

  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) {
      errors[key] = 'This field cannot be set.';
    }
  }

  const presentKeys = allowedKeys.filter((k) => k in record);
  if (presentKeys.length === 0 && Object.keys(errors).length === 0) {
    errors._form = 'No changes provided.';
  }

  const patch: TeamListingPatch = {};

  if ('name' in record) {
    const rawName = record.name;
    if (typeof rawName !== 'string' || rawName.trim().length === 0) {
      errors.name = 'Team name is required.';
    } else if (codePointLength(rawName.trim()) > TEAM_NAME_MAX) {
      errors.name = `Team name cannot exceed ${TEAM_NAME_MAX} characters.`;
    } else {
      patch.name = rawName.trim();
    }
  }

  if ('pitch' in record) {
    const rawPitch = record.pitch;
    if (typeof rawPitch !== 'string' || rawPitch.trim().length === 0) {
      errors.pitch = 'Pitch is required.';
    } else {
      const normalizedPitch = rawPitch.replace(/\r\n/g, '\n').trim();
      if (codePointLength(normalizedPitch) === 0) {
        errors.pitch = 'Pitch is required.';
      } else if (codePointLength(normalizedPitch) > TEAM_PITCH_MAX) {
        errors.pitch = `Pitch cannot exceed ${TEAM_PITCH_MAX} characters.`;
      } else {
        patch.pitch = normalizedPitch;
      }
    }
  }

  if ('goal' in record) {
    const normalizedGoal = normalizeGoal(record.goal);
    if (!normalizedGoal) {
      errors.goal = 'Invalid team goal. Must be Learning, Project Completion, or Competitive.';
    } else {
      patch.goal = normalizedGoal;
    }
  }

  if ('commitmentHours' in record) {
    const rawHours = record.commitmentHours;
    if (typeof rawHours !== 'number' || !Number.isFinite(rawHours)) {
      errors.commitmentHours = 'Commitment hours must be a number between 0 and 168 with at most one decimal place.';
    } else if (rawHours < 0 || rawHours > TEAM_MAX_COMMITMENT_HOURS) {
      errors.commitmentHours = `Commitment hours must be between 0 and ${TEAM_MAX_COMMITMENT_HOURS}.`;
    } else {
      const parts = rawHours.toString().split('.');
      if (parts[1] && parts[1].length > 1) {
        errors.commitmentHours = 'Commitment hours cannot have more than 1 decimal place.';
      } else {
        patch.commitmentHours = rawHours;
      }
    }
  }

  if ('communicationLink' in record) {
    const rawLink = record.communicationLink;
    if (rawLink === null || (typeof rawLink === 'string' && rawLink.trim() === '')) {
      patch.communicationLink = null;
    } else if (typeof rawLink !== 'string') {
      errors.communicationLink = 'Communication link must be a valid HTTPS URL.';
    } else {
      const trimmedLink = rawLink.trim();
      if (trimmedLink.length > TEAM_LINK_MAX || !isValidHttpsPortfolioUrl(trimmedLink)) {
        errors.communicationLink = 'Communication link must be a valid HTTPS URL (max 2048 characters) without credentials.';
      } else {
        patch.communicationLink = trimmedLink;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return { errors: {}, sanitized: patch };
}

/**
 * Pure validation for vacancy payloads (POST /api/teams/:teamId/vacancies & PATCH .../vacancies/:vacancyId).
 */
export function validateVacancyInput(
  body: unknown,
  _mode: 'create' | 'update' = 'create'
): {
  errors: TeamFieldErrors;
  sanitized?: { role: ParticipantPrimaryRole; skills: string[] };
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: { body: 'Request body must be a JSON object.' } };
  }

  const record = body as Record<string, unknown>;
  const errors: TeamFieldErrors = {};
  const allowedKeys = ['role', 'skills'];

  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) {
      errors[key] = 'This field cannot be set.';
    }
  }

  // 1. role
  let canonicalRole: ParticipantPrimaryRole | null = null;
  const rawRole = record.role;
  if (typeof rawRole !== 'string' || rawRole.trim().length === 0) {
    errors.role = 'Role is required.';
  } else {
    const trimmedLower = rawRole.trim().toLowerCase();
    const match = ALLOWED_PRIMARY_ROLES.find((r) => r.toLowerCase() === trimmedLower);
    if (!match) {
      errors.role = `Invalid role. Must be one of: ${ALLOWED_PRIMARY_ROLES.join(', ')}.`;
    } else {
      canonicalRole = match;
    }
  }

  // 2. skills (optional, max 10, each 1..50 characters, deduplicated case-insensitively)
  let sanitizedSkills: string[] = [];
  if ('skills' in record && record.skills !== undefined) {
    if (!Array.isArray(record.skills)) {
      errors.skills = 'Skills must be an array of strings.';
    } else {
      const rawSkills = record.skills as unknown[];
      const seenLower = new Set<string>();
      const deduped: string[] = [];
      let itemError: string | null = null;

      for (const item of rawSkills) {
        if (typeof item !== 'string') {
          itemError = 'Skills must be an array of strings.';
          break;
        }
        const cleaned = item.trim().replace(/\s+/g, ' ');
        const len = codePointLength(cleaned);
        if (len === 0 || len > VACANCY_SKILL_MAX_LENGTH) {
          itemError = `Each skill must be between 1 and ${VACANCY_SKILL_MAX_LENGTH} characters.`;
          break;
        }
        const lower = cleaned.toLowerCase();
        if (!seenLower.has(lower)) {
          seenLower.add(lower);
          deduped.push(cleaned);
        }
      }

      if (itemError) {
        errors.skills = itemError;
      } else if (deduped.length > VACANCY_SKILLS_MAX) {
        errors.skills = `Cannot have more than ${VACANCY_SKILLS_MAX} skills per vacancy.`;
      } else {
        sanitizedSkills = deduped;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    errors: {},
    sanitized: {
      role: canonicalRole!,
      skills: sanitizedSkills,
    },
  };
}

/**
 * Pure validation for member removal reason (wired in Task 7).
 */
export function validateRemovalReason(body: unknown): {
  errors: TeamFieldErrors;
  sanitized?: { reason: string };
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: { body: 'Request body must be a JSON object.' } };
  }

  const record = body as Record<string, unknown>;
  const errors: TeamFieldErrors = {};

  for (const key of Object.keys(record)) {
    if (key !== 'reason') {
      errors[key] = 'This field cannot be set.';
    }
  }

  let sanitizedReason: string | undefined;
  const rawReason = record.reason;
  if (typeof rawReason !== 'string' || rawReason.trim().length === 0) {
    errors.reason = 'Removal reason is required.';
  } else {
    const trimmed = rawReason.trim();
    if (codePointLength(trimmed) > REMOVAL_REASON_MAX) {
      errors.reason = `Removal reason cannot exceed ${REMOVAL_REASON_MAX} characters.`;
    } else {
      sanitizedReason = trimmed;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return { errors: {}, sanitized: { reason: sanitizedReason! } };
}

/**
 * Express middleware for POST /api/teams body validation.
 */
export const validateCreateTeamBody: RequestHandler = (req, res, next) => {
  const result = validateCreateTeamInput(req.body);
  if (Object.keys(result.errors).length > 0) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: result.errors,
    });
    return;
  }
  req.body = result.sanitized;
  next();
};

/**
 * Express middleware for PATCH /api/teams/:teamId body validation.
 */
export const validateUpdateTeamBody: RequestHandler = (req, res, next) => {
  const result = validateUpdateTeamInput(req.body);
  if (Object.keys(result.errors).length > 0) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: result.errors,
    });
    return;
  }
  req.body = result.sanitized;
  next();
};

/**
 * Express middleware for vacancy body validation.
 */
export const validateVacancyBody: RequestHandler = (req, res, next) => {
  const result = validateVacancyInput(req.body);
  if (Object.keys(result.errors).length > 0) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: result.errors,
    });
    return;
  }
  req.body = result.sanitized;
  next();
};

/**
 * Express middleware for member removal body validation.
 */
export const validateRemovalReasonBody: RequestHandler = (req, res, next) => {
  const result = validateRemovalReason(req.body);
  if (Object.keys(result.errors).length > 0) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: result.errors,
    });
    return;
  }
  req.body = result.sanitized;
  next();
};


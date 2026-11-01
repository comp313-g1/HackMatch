import type { Request, Response, NextFunction } from 'express';
import type { ParticipantPrimaryRole, CreateHackathonHistoryDTO } from '../db/types.js';
import { ALLOWED_PRIMARY_ROLES, isValidHttpsPortfolioUrl } from './profile.validator.js';

export const EVENT_NAME_MIN_LENGTH = 2;
export const EVENT_NAME_MAX_LENGTH = 120;
export const PROJECT_TITLE_MIN_LENGTH = 2;
export const PROJECT_TITLE_MAX_LENGTH = 120;
export const PROJECT_URL_MAX_LENGTH = 500;
export const MIN_EVENT_DATE = '2000-01-01';
export const HISTORY_MAX_ENTRIES = 20;

export const FORBIDDEN_HISTORY_PAYLOAD_KEYS = [
  'id',
  'participantId',
  'participant_id',
  'role',
  'experienceBadge',
  'isVerified',
  'verified',
] as const;

export interface ValidationFieldError {
  field: string;
  message: string;
}

export interface HackathonHistoryValidationResult {
  valid: boolean;
  value?: CreateHackathonHistoryDTO;
  errors: ValidationFieldError[];
}

/**
 * Validates and normalizes date inputs: accepts YYYY-MM or YYYY-MM-DD.
 * Confirms true calendar validity (e.g. rejects Feb 31),
 * enforces lower bound (2000-01-01), and rejects future dates per UTC today.
 */
export function normalizeAndValidateEventDate(
  rawDate: unknown
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof rawDate !== 'string') {
    return { ok: false, message: 'Event date must be a valid date string (YYYY-MM or YYYY-MM-DD).' };
  }

  const trimmed = rawDate.trim();
  const ymMatch = /^(\d{4})-(\d{2})$/.exec(trimmed);
  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);

  if (!ymMatch && !ymdMatch) {
    return { ok: false, message: 'Event date must follow YYYY-MM or YYYY-MM-DD format.' };
  }

  const year = Number(ymMatch ? ymMatch[1] : ymdMatch![1]);
  const month = Number(ymMatch ? ymMatch[2] : ymdMatch![2]);
  const day = Number(ymMatch ? 1 : ymdMatch![3]);

  if (month < 1 || month > 12) {
    return { ok: false, message: 'Month must be between 01 and 12.' };
  }

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return { ok: false, message: 'Invalid calendar date.' };
  }

  const normalized = utcDate.toISOString().slice(0, 10);
  if (normalized < MIN_EVENT_DATE) {
    return { ok: false, message: `Event date cannot be earlier than ${MIN_EVENT_DATE}.` };
  }

  const todayUtc = new Date().toISOString().slice(0, 10);
  if (normalized > todayUtc) {
    return { ok: false, message: 'Event date cannot be in the future.' };
  }

  return { ok: true, value: normalized };
}

/**
 * Validates hackathon history input payload.
 * Rejects privilege-escalation keys, validates lengths, checks role enum,
 * ensures calendar validity, and checks HTTPS project URLs.
 */
export function validateHackathonHistoryInput(body: unknown): HackathonHistoryValidationResult {
  const errors: ValidationFieldError[] = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      errors: [{ field: 'body', message: 'Request body must be a JSON object.' }],
    };
  }

  const record = body as Record<string, unknown>;

  // Check for forbidden privilege-escalation fields
  for (const forbiddenKey of FORBIDDEN_HISTORY_PAYLOAD_KEYS) {
    if (forbiddenKey in record && record[forbiddenKey] !== undefined) {
      errors.push({
        field: forbiddenKey,
        message: `Field "${forbiddenKey}" is not permitted in hackathon history payload.`,
      });
    }
  }

  // Validate event name
  const rawEventName = record.eventName ?? record.event_name;
  let eventName = '';
  if (typeof rawEventName !== 'string' || rawEventName.trim().length === 0) {
    errors.push({ field: 'eventName', message: 'Event name is required.' });
  } else {
    eventName = rawEventName.trim();
    if (eventName.length < EVENT_NAME_MIN_LENGTH || eventName.length > EVENT_NAME_MAX_LENGTH) {
      errors.push({
        field: 'eventName',
        message: `Event name must be between ${EVENT_NAME_MIN_LENGTH} and ${EVENT_NAME_MAX_LENGTH} characters.`,
      });
    }
  }

  // Validate event date
  const rawEventDate = record.eventDate ?? record.event_date;
  let eventDate = '';
  if (!rawEventDate) {
    errors.push({ field: 'eventDate', message: 'Event date is required.' });
  } else {
    const dateRes = normalizeAndValidateEventDate(rawEventDate);
    if (!dateRes.ok) {
      errors.push({ field: 'eventDate', message: dateRes.message });
    } else {
      eventDate = dateRes.value;
    }
  }

  // Validate team role
  const rawTeamRole = record.teamRole ?? record.team_role;
  let teamRole: ParticipantPrimaryRole | null = null;
  if (typeof rawTeamRole !== 'string' || rawTeamRole.trim().length === 0) {
    errors.push({ field: 'teamRole', message: 'Team role is required.' });
  } else {
    const trimmedRole = rawTeamRole.trim() as ParticipantPrimaryRole;
    if (!ALLOWED_PRIMARY_ROLES.includes(trimmedRole)) {
      errors.push({
        field: 'teamRole',
        message: `Team role must be one of: ${ALLOWED_PRIMARY_ROLES.join(', ')}.`,
      });
    } else {
      teamRole = trimmedRole;
    }
  }

  // Validate project title
  const rawProjectTitle = record.projectTitle ?? record.project_title;
  let projectTitle = '';
  if (typeof rawProjectTitle !== 'string' || rawProjectTitle.trim().length === 0) {
    errors.push({ field: 'projectTitle', message: 'Project title is required.' });
  } else {
    projectTitle = rawProjectTitle.trim();
    if (
      projectTitle.length < PROJECT_TITLE_MIN_LENGTH ||
      projectTitle.length > PROJECT_TITLE_MAX_LENGTH
    ) {
      errors.push({
        field: 'projectTitle',
        message: `Project title must be between ${PROJECT_TITLE_MIN_LENGTH} and ${PROJECT_TITLE_MAX_LENGTH} characters.`,
      });
    }
  }

  // Validate project URL
  const rawProjectUrl = record.projectUrl ?? record.project_url;
  let projectUrl = '';
  if (typeof rawProjectUrl !== 'string' || rawProjectUrl.trim().length === 0) {
    errors.push({ field: 'projectUrl', message: 'Project URL is required.' });
  } else {
    projectUrl = rawProjectUrl.trim();
    if (projectUrl.length > PROJECT_URL_MAX_LENGTH || !isValidHttpsPortfolioUrl(projectUrl)) {
      errors.push({
        field: 'projectUrl',
        message: `Project URL must be a valid HTTPS URL (max ${PROJECT_URL_MAX_LENGTH} characters).`,
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      event_name: eventName,
      event_date: eventDate,
      team_role: teamRole!,
      project_title: projectTitle,
      project_url: projectUrl,
    },
    errors: [],
  };
}

/**
 * Express middleware to validate create/update hackathon history payloads.
 */
export function validateHackathonHistoryPayload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const result = validateHackathonHistoryInput(req.body);
  if (!result.valid) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Hackathon history validation failed. Existing records were not modified.',
      errors: result.errors,
    });
    return;
  }
  next();
}

import {
  PRIMARY_ROLES,
  type ParticipantPrimaryRole,
  isValidHttpsPortfolioUrl,
} from './profileValidation';

export const EVENT_NAME_MIN_LENGTH = 2;
export const EVENT_NAME_MAX_LENGTH = 120;
export const PROJECT_TITLE_MIN_LENGTH = 2;
export const PROJECT_TITLE_MAX_LENGTH = 120;
export const PROJECT_URL_MAX_LENGTH = 500;
export const MIN_EVENT_DATE = '2000-01-01';
export const HISTORY_MAX_ENTRIES = 20;

export const SELF_REPORTED_HISTORY_NOTICE =
  'Self-reported experience badge and hackathon history — not independently verified.';

export type ExperienceBadge = 'Beginner' | 'Competitor' | 'Veteran';

export interface HackathonHistoryItem {
  id: string;
  participantId: string;
  eventName: string;
  eventDate: string;
  teamRole: ParticipantPrimaryRole;
  projectTitle: string;
  projectUrl: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface HackathonHistoryFormDraft {
  eventName: string;
  eventDate: string;
  teamRole: string;
  projectTitle: string;
  projectUrl: string;
}

export interface HackathonHistoryValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  sanitized?: {
    eventName: string;
    eventDate: string;
    teamRole: ParticipantPrimaryRole;
    projectTitle: string;
    projectUrl: string;
  };
}

/**
 * Computes self-reported experience tier based on number of records (US-007 AC 2 / FR-016).
 * 0 records: Beginner
 * 1-3 records: Competitor
 * 4+ records: Veteran
 */
export function computeExperienceBadge(recordCount: number): ExperienceBadge {
  const normalizedCount = Number.isFinite(recordCount) ? Math.max(0, Math.floor(recordCount)) : 0;
  if (normalizedCount === 0) {
    return 'Beginner';
  }
  if (normalizedCount <= 3) {
    return 'Competitor';
  }
  return 'Veteran';
}

/**
 * Validates and normalizes date inputs (YYYY-MM or YYYY-MM-DD).
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
 * Validates a hackathon history form draft.
 */
export function validateHackathonHistoryDraft(
  draft: HackathonHistoryFormDraft
): HackathonHistoryValidationResult {
  const errors: Record<string, string> = {};

  const eventName = (draft.eventName || '').trim();
  if (!eventName) {
    errors.eventName = 'Event name is required.';
  } else if (eventName.length < EVENT_NAME_MIN_LENGTH || eventName.length > EVENT_NAME_MAX_LENGTH) {
    errors.eventName = `Event name must be between ${EVENT_NAME_MIN_LENGTH} and ${EVENT_NAME_MAX_LENGTH} characters.`;
  }

  const rawDate = (draft.eventDate || '').trim();
  let normalizedDate = '';
  if (!rawDate) {
    errors.eventDate = 'Event date is required.';
  } else {
    const dateRes = normalizeAndValidateEventDate(rawDate);
    if (!dateRes.ok) {
      errors.eventDate = dateRes.message;
    } else {
      normalizedDate = dateRes.value;
    }
  }

  const teamRole = (draft.teamRole || '').trim() as ParticipantPrimaryRole;
  if (!teamRole) {
    errors.teamRole = 'Team role is required.';
  } else if (!PRIMARY_ROLES.includes(teamRole)) {
    errors.teamRole = `Team role must be one of: ${PRIMARY_ROLES.join(', ')}.`;
  }

  const projectTitle = (draft.projectTitle || '').trim();
  if (!projectTitle) {
    errors.projectTitle = 'Project title is required.';
  } else if (
    projectTitle.length < PROJECT_TITLE_MIN_LENGTH ||
    projectTitle.length > PROJECT_TITLE_MAX_LENGTH
  ) {
    errors.projectTitle = `Project title must be between ${PROJECT_TITLE_MIN_LENGTH} and ${PROJECT_TITLE_MAX_LENGTH} characters.`;
  }

  const projectUrl = (draft.projectUrl || '').trim();
  if (!projectUrl) {
    errors.projectUrl = 'Project URL is required.';
  } else if (projectUrl.length > PROJECT_URL_MAX_LENGTH || !isValidHttpsPortfolioUrl(projectUrl)) {
    errors.projectUrl = `Project URL must be a valid HTTPS URL (max ${PROJECT_URL_MAX_LENGTH} characters).`;
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: {},
    sanitized: {
      eventName,
      eventDate: normalizedDate,
      teamRole,
      projectTitle,
      projectUrl,
    },
  };
}

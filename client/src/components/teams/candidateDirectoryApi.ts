import { authFetch, AuthRequiredError } from '../../config/authFetch';
import type { ParticipantPrimaryRole, TeamGoal } from './teamTypes';
import type { ExperienceBadge, HackathonHistoryItem } from '../profile/hackathonHistoryValidation';

export { AuthRequiredError };

export type SkillMatchMode = 'AND' | 'OR';

export const MAX_FILTER_SKILLS = 10;
export const MAX_SKILL_LENGTH = 50;
export const MAX_SEARCH_LENGTH = 80;
export const MIN_COMMITMENT_HOURS = 1;
export const MAX_COMMITMENT_HOURS = 168;

export interface CandidateDirectoryFilters {
  skills?: string[];
  skillMatchMode?: SkillMatchMode;
  role?: ParticipantPrimaryRole | null;
  desiredRole?: ParticipantPrimaryRole | null;
  minHours?: number | null;
  maxHours?: number | null;
  badge?: ExperienceBadge | null;
  goal?: TeamGoal | null;
  search?: string | null;
}

export interface CandidateDirectoryFilterDraft {
  skillsInput?: string;
  skillMatchMode?: SkillMatchMode;
  role?: string;
  desiredRole?: string;
  badge?: string;
  minHours?: string;
  maxHours?: string;
  goal?: string;
  search?: string;
}

export interface CandidateDirectoryFieldErrors {
  skills?: string;
  skillMatchMode?: string;
  role?: string;
  desiredRole?: string;
  badge?: string;
  minHours?: string;
  maxHours?: string;
  hours?: string;
  goal?: string;
  search?: string;
  _form?: string;
}

export interface DirectoryCandidate {
  participantId: string;
  displayName: string;
  handle: string | null;
  institution: string | null;
  primaryRole: ParticipantPrimaryRole | null;
  desiredRole: ParticipantPrimaryRole | null;
  commitmentHours: number | null;
  goal: TeamGoal | null;
  skills: string[];
  matchedSkills: string[];
  skillsSelfDeclared: true;
  portfolioLinks: Array<{ url: string; label: string | null; isSelfDeclared: true }>;
  selfDeclaredNotice: string;
  hackathonCount: number;
  experienceBadge: ExperienceBadge;
  experienceBadgeSelfReported: true;
  selfReportedNotice: string;
  hackathonHistory: HackathonHistoryItem[];
  updatedAt: string | null;
}

export interface CandidateDirectoryExclusionSummary {
  inactive: number;
  unavailable: number;
  confirmed: number;
  owner: number;
  totalExcluded: number;
}

export interface CandidateDirectoryResponse {
  teamId: string;
  eventId: string;
  filters: {
    skills: string[];
    skillMatchMode: SkillMatchMode;
    role: ParticipantPrimaryRole | null;
    desiredRole: ParticipantPrimaryRole | null;
    minHours: number | null;
    maxHours: number | null;
    badge: ExperienceBadge | null;
    goal: TeamGoal | null;
    search: string | null;
  };
  candidates: DirectoryCandidate[];
  totalEligible: number;
  totalMatched: number;
  empty: boolean;
  message: string | null;
  exclusions: CandidateDirectoryExclusionSummary;
}

export class CandidateDirectoryApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly errors?: Record<string, string | undefined>,
    readonly details?: Record<string, unknown>,
    message?: string
  ) {
    super(message || code);
    this.name = 'CandidateDirectoryApiError';
  }
}

/**
 * Validates candidate directory filter draft on client side to prevent invalid network calls
 * while preserving all user-entered inputs on error (NR-010).
 */
export function validateCandidateDirectoryFilterDraft(
  draft: CandidateDirectoryFilterDraft
): { ok: boolean; errors: CandidateDirectoryFieldErrors; filters?: CandidateDirectoryFilters } {
  const errors: CandidateDirectoryFieldErrors = {};
  const filters: CandidateDirectoryFilters = {
    skills: [],
    skillMatchMode: draft.skillMatchMode === 'OR' ? 'OR' : 'AND',
    role: null,
    desiredRole: null,
    minHours: null,
    maxHours: null,
    badge: null,
    goal: null,
    search: null,
  };

  if (draft.skillsInput !== undefined && draft.skillsInput.trim() !== '') {
    const rawSkills = draft.skillsInput.split(',').map((s) => s.trim()).filter(Boolean);
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const skill of rawSkills) {
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

  if (draft.role !== undefined && draft.role.trim() !== '') {
    filters.role = draft.role.trim() as ParticipantPrimaryRole;
  }

  if (draft.desiredRole !== undefined && draft.desiredRole.trim() !== '') {
    filters.desiredRole = draft.desiredRole.trim() as ParticipantPrimaryRole;
  }

  if (draft.badge !== undefined && draft.badge.trim() !== '') {
    filters.badge = draft.badge.trim() as ExperienceBadge;
  }

  if (draft.goal !== undefined && draft.goal.trim() !== '') {
    filters.goal = draft.goal.trim() as TeamGoal;
  }

  let minH: number | null = null;
  let maxH: number | null = null;
  if (draft.minHours !== undefined && draft.minHours.trim() !== '') {
    const n = Number(draft.minHours.trim());
    if (!Number.isInteger(n) || n < MIN_COMMITMENT_HOURS || n > MAX_COMMITMENT_HOURS) {
      errors.minHours = `Minimum commitment hours must be an integer between ${MIN_COMMITMENT_HOURS} and ${MAX_COMMITMENT_HOURS}.`;
    } else {
      minH = n;
      filters.minHours = n;
    }
  }

  if (draft.maxHours !== undefined && draft.maxHours.trim() !== '') {
    const n = Number(draft.maxHours.trim());
    if (!Number.isInteger(n) || n < MIN_COMMITMENT_HOURS || n > MAX_COMMITMENT_HOURS) {
      errors.maxHours = `Maximum commitment hours must be an integer between ${MIN_COMMITMENT_HOURS} and ${MAX_COMMITMENT_HOURS}.`;
    } else {
      maxH = n;
      filters.maxHours = n;
    }
  }

  if (minH !== null && maxH !== null && minH > maxH) {
    errors.hours = 'Minimum commitment hours cannot exceed maximum commitment hours.';
  }

  if (draft.search !== undefined && draft.search.trim() !== '') {
    const trimmed = draft.search.trim();
    if (trimmed.length > MAX_SEARCH_LENGTH) {
      errors.search = `Search query cannot exceed ${MAX_SEARCH_LENGTH} characters.`;
    } else {
      filters.search = trimmed;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, errors: {}, filters };
}

/**
 * Builds standard query string for candidate directory search & filter parameters.
 */
export function buildCandidateDirectoryQuery(filters?: CandidateDirectoryFilters): string {
  if (!filters) return '';
  const params = new URLSearchParams();

  if (filters.skills && filters.skills.length > 0) {
    params.set('skills', filters.skills.join(','));
  }
  if (filters.skillMatchMode) {
    params.set('skillMatchMode', filters.skillMatchMode);
  }
  if (filters.role) {
    params.set('role', filters.role);
  }
  if (filters.desiredRole) {
    params.set('desiredRole', filters.desiredRole);
  }
  if (typeof filters.minHours === 'number') {
    params.set('minHours', String(filters.minHours));
  }
  if (typeof filters.maxHours === 'number') {
    params.set('maxHours', String(filters.maxHours));
  }
  if (filters.badge) {
    params.set('badge', filters.badge);
  }
  if (filters.goal) {
    params.set('goal', filters.goal);
  }
  if (filters.search) {
    params.set('search', filters.search.trim());
  }

  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) {
    return (await res.json()) as T;
  }

  let errBody: {
    code?: string;
    error?: string;
    errors?: Record<string, string | undefined>;
    details?: Record<string, unknown>;
  } = {};

  try {
    errBody = (await res.json()) as typeof errBody;
  } catch {
    // Non-JSON response
  }

  throw new CandidateDirectoryApiError(
    res.status,
    errBody.code || 'UNKNOWN_ERROR',
    errBody.errors,
    errBody.details,
    errBody.error || `Request failed with status ${res.status}`
  );
}

/**
 * Fetches eligible candidates directory for active team owner (US-014 / FR-040).
 */
export async function fetchTeamCandidateDirectory(
  teamId: string,
  filters?: CandidateDirectoryFilters,
  signal?: AbortSignal
): Promise<CandidateDirectoryResponse> {
  const qs = buildCandidateDirectoryQuery(filters);
  const url = `/api/teams/${encodeURIComponent(teamId)}/candidates${qs}`;

  let res: Response;
  try {
    res = await authFetch(url, { method: 'GET', signal });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new CandidateDirectoryApiError(
      0,
      'NETWORK',
      { _form: 'Network error. Existing candidate search filters have been preserved.' },
      undefined,
      'Network error. Existing candidate search filters have been preserved.'
    );
  }

  return parseOrThrow<CandidateDirectoryResponse>(res);
}

import { authFetch, AuthRequiredError } from '../../config/authFetch';
import type { ParticipantPrimaryRole, TeamGoal } from './teamTypes';
import type { ExperienceBadge, HackathonHistoryItem } from '../profile/hackathonHistoryValidation';

export { AuthRequiredError };

export type SkillMatchMode = 'AND' | 'OR';

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

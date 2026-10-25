import type { User } from 'firebase/auth';
import { authFetch } from '../../config/authFetch';

export type ParticipantPrimaryRole = 'Frontend' | 'Backend' | 'Mobile' | 'AI/ML' | 'UI/UX' | 'Pitch';
export type TeamGoal = 'Learning' | 'Project Completion' | 'Competitive';

export interface OpenTeamPartCard {
  id: string;
  name: string;
  pitch: string;
  goal: TeamGoal;
  commitmentHours: number;
  confirmedMembers: number;
  openSlots: number;
  isViewerMember: boolean;
  members: Array<{ displayName: string; role: 'Owner' | 'Member' }>;
  vacancies: Array<{ id: string; role: ParticipantPrimaryRole; skills: string[] }>;
  createdAt: string;
}

export interface OpenTeamVisitorPreview {
  displayLabel: 'Recruiting team';
  goal: TeamGoal;
  commitmentHours: number;
  confirmedMembers: number;
  openSlots: number;
  vacancies: Array<{ role: ParticipantPrimaryRole; skills: string[] }>;
}

export type OpenTeamsResult =
  | { viewer: 'PART'; total: number; teams: OpenTeamPartCard[] }
  | { viewer: 'VISITOR'; total: number; teams: OpenTeamVisitorPreview[] };

export interface OpenTeamsFilterDraft {
  skills: string;
  role: string;
  goal: string;
  minSlots: string;
}

export interface OpenTeamsFilterErrors {
  skills?: string;
  role?: string;
  goal?: string;
  minSlots?: string;
}

export interface OpenTeamApplyTarget {
  teamId: string;
  vacancyId: string;
  slotId?: string;
  role: ParticipantPrimaryRole;
  teamName: string;
}

export const EMPTY_FILTERS: OpenTeamsFilterDraft = {
  skills: '',
  role: '',
  goal: '',
  minSlots: '',
};

export const ALLOWED_PRIMARY_ROLES: readonly ParticipantPrimaryRole[] = [
  'Frontend',
  'Backend',
  'Mobile',
  'AI/ML',
  'UI/UX',
  'Pitch',
];

export const TEAM_GOALS: readonly TeamGoal[] = [
  'Learning',
  'Project Completion',
  'Competitive',
];

export class OpenTeamsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly errors?: Record<string, string>,
    message?: string
  ) {
    super(message || code);
    this.name = 'OpenTeamsApiError';
  }
}

/**
 * Validates the draft filters client-side before dispatching network request.
 * Normalization rules match the server validator (§2.4).
 */
export function validateFilterDraft(d: OpenTeamsFilterDraft): OpenTeamsFilterErrors {
  const errors: OpenTeamsFilterErrors = {};

  if (d.skills && d.skills.trim() !== '') {
    const rawTags = d.skills
      .split(',')
      .map((s) => s.trim().replace(/\s+/g, ' ').toLowerCase())
      .filter(Boolean);
    const deduped = Array.from(new Set(rawTags));
    if (deduped.length > 5) {
      errors.skills = 'Skills filter cannot exceed 5 tags.';
    } else {
      const invalidTag = deduped.find((tag) => tag.length > 50);
      if (invalidTag) {
        errors.skills = 'Each skill tag cannot exceed 50 characters.';
      }
    }
  }

  if (d.role && d.role.trim() !== '') {
    const normalized = d.role.trim().toLowerCase();
    const matched = ALLOWED_PRIMARY_ROLES.find((r) => r.toLowerCase() === normalized);
    if (!matched) {
      errors.role = 'Invalid role filter.';
    }
  }

  if (d.goal && d.goal.trim() !== '') {
    const normalized = d.goal.trim().replace(/\s+/g, ' ').toLowerCase();
    const matched = TEAM_GOALS.find((g) => g.toLowerCase() === normalized);
    if (!matched) {
      errors.goal = 'Invalid goal filter.';
    }
  }

  if (d.minSlots && d.minSlots.trim() !== '') {
    const trimmed = d.minSlots.trim();
    if (!/^\d{1,2}$/.test(trimmed)) {
      errors.minSlots = 'Minimum open slots must be an integer between 1 and 20.';
    } else {
      const val = parseInt(trimmed, 10);
      if (val < 1 || val > 20) {
        errors.minSlots = 'Minimum open slots must be an integer between 1 and 20.';
      }
    }
  }

  return errors;
}

/**
 * Constructs the query string for GET /api/teams, omitting unset / whitespace-only fields.
 */
export function buildOpenTeamsQuery(d: OpenTeamsFilterDraft): string {
  const params = new URLSearchParams();

  if (d.skills && d.skills.trim() !== '') {
    params.set('skills', d.skills.trim());
  }
  if (d.role && d.role.trim() !== '') {
    params.set('role', d.role.trim());
  }
  if (d.goal && d.goal.trim() !== '') {
    params.set('goal', d.goal.trim());
  }
  if (d.minSlots && d.minSlots.trim() !== '') {
    params.set('minSlots', d.minSlots.trim());
  }

  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function readApiError(
  res: Response
): Promise<{ error?: string; code?: string; errors?: Record<string, string> }> {
  try {
    return (await res.json()) as { error?: string; code?: string; errors?: Record<string, string> };
  } catch {
    return {};
  }
}

/**
 * Fetches open teams from Express API.
 * - Authenticated: authFetch with Bearer token → PART cards with Apply (#357).
 * - MFA_REQUIRED must NOT fall back to visitor (that caused "Sign in to apply" while signed in).
 * - Other 401/403 (expired/invalid token): retry once as visitor so browse still works.
 * - Visitor: plain fetch without Authorization header.
 */
export async function fetchOpenTeams(
  draft: OpenTeamsFilterDraft,
  user: User | null,
  signal?: AbortSignal
): Promise<OpenTeamsResult> {
  const qs = buildOpenTeamsQuery(draft);
  const url = `/api/teams${qs}`;

  let res: Response;

  if (user) {
    try {
      res = await authFetch(url, { method: 'GET', signal }, user);
    } catch {
      res = await fetch(url, { method: 'GET', signal });
    }

    if (res.status === 401 || res.status === 403) {
      const errBody = await readApiError(res);
      // #357 — signed-in Firebase user still needs OTP; do not pretend they are a guest.
      if (errBody.code === 'MFA_REQUIRED') {
        throw new OpenTeamsApiError(
          res.status,
          'MFA_REQUIRED',
          errBody.errors,
          errBody.error ||
            'Enter your email verification code before browsing teams as a participant.'
        );
      }
      res = await fetch(url, { method: 'GET', signal });
    }
  } else {
    res = await fetch(url, { method: 'GET', signal });
  }

  if (!res.ok) {
    const errBody = await readApiError(res);
    throw new OpenTeamsApiError(
      res.status,
      errBody.code || 'UNKNOWN_ERROR',
      errBody.errors,
      errBody.error || `Request failed with status ${res.status}`
    );
  }

  return (await res.json()) as OpenTeamsResult;
}

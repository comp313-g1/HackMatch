import { authFetch, AuthRequiredError } from '../../config/authFetch';
import {
  ALLOWED_PRIMARY_ROLES,
  type ParticipantPrimaryRole,
} from '../teams/openTeamsApi';

export { AuthRequiredError };

/**
 * US-016 / #156 — client for the participant's own recommended teams.
 *
 * GET /api/recommendations/teams  (signed-in participant; the server works out who is asking from
 * the sign-in token, so no id is ever sent). The response is checked here before the page uses it,
 * so a malformed answer becomes an error message instead of a wrong number on screen.
 */

/** Why a participant gets no suggestions at all (as opposed to "no teams match right now"). */
export type RecommendedTeamsIneligibleReason =
  | 'participant_not_looking'
  | 'participant_no_skills'
  | 'participant_profile_hidden'
  | 'participant_unavailable';

export interface RecommendedTeam {
  /** 1-based position, best first. */
  rank: number;
  teamId: string;
  vacancyId: string;
  teamName: string;
  goal: string | null;
  commitmentHours: number | null;
  /** The role the open slot is for. */
  vacancyRole: ParticipantPrimaryRole;
  /** Whole number, 0 to 100. */
  matchPercent: number;
  /** Required skills the participant has / does not have yet, in the team's spelling. */
  matchedSkills: string[];
  missingSkills: string[];
  roleMatched: boolean;
  /** Short plain explanations of the score; no ids. */
  contributions: { skill: string; goal: string; hours: string };
}

export interface RecommendedTeamsResponse {
  recommendations: RecommendedTeam[];
  /** True when there is nothing to show; `ineligibleReason` then says whether it is the person or the pool. */
  empty: boolean;
  ineligibleReason: RecommendedTeamsIneligibleReason | null;
  /** Server-written explanation for the empty state, if any. */
  message: string | null;
  /** Reminder that the scores come from self-declared information. */
  notice: string | null;
}

export class RecommendedTeamsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'RecommendedTeamsApiError';
  }
}

const INVALID_RESPONSE = 'The server returned an invalid recommendations response.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

const REASONS: readonly string[] = [
  'participant_not_looking',
  'participant_no_skills',
  'participant_profile_hidden',
  'participant_unavailable',
];

function parseTeam(raw: unknown): RecommendedTeam | null {
  if (!isRecord(raw)) return null;
  const contributions = raw.contributions;
  if (
    !Number.isInteger(raw.rank) ||
    (raw.rank as number) < 1 ||
    typeof raw.teamId !== 'string' || !raw.teamId ||
    typeof raw.vacancyId !== 'string' || !raw.vacancyId ||
    typeof raw.teamName !== 'string' || !raw.teamName.trim() ||
    typeof raw.vacancyRole !== 'string' ||
    !ALLOWED_PRIMARY_ROLES.includes(raw.vacancyRole as ParticipantPrimaryRole) ||
    !Number.isInteger(raw.matchPercent) ||
    (raw.matchPercent as number) < 0 ||
    (raw.matchPercent as number) > 100 ||
    !isStringArray(raw.matchedSkills) ||
    !isStringArray(raw.missingSkills) ||
    typeof raw.roleMatched !== 'boolean' ||
    !isRecord(contributions) ||
    typeof contributions.skill !== 'string' ||
    typeof contributions.goal !== 'string' ||
    typeof contributions.hours !== 'string'
  ) {
    return null;
  }
  const hours = raw.commitmentHours;
  return {
    rank: raw.rank as number,
    teamId: raw.teamId,
    vacancyId: raw.vacancyId,
    teamName: raw.teamName,
    goal: typeof raw.goal === 'string' ? raw.goal : null,
    commitmentHours: typeof hours === 'number' && Number.isFinite(hours) ? hours : null,
    vacancyRole: raw.vacancyRole as ParticipantPrimaryRole,
    matchPercent: raw.matchPercent as number,
    matchedSkills: raw.matchedSkills,
    missingSkills: raw.missingSkills,
    roleMatched: raw.roleMatched,
    contributions: {
      skill: contributions.skill,
      goal: contributions.goal,
      hours: contributions.hours,
    },
  };
}

/** Checks the server's answer and returns it in a safe shape, or throws an INVALID_RESPONSE error. */
export function parseRecommendedTeamsResponse(body: unknown): RecommendedTeamsResponse {
  if (!isRecord(body) || !Array.isArray(body.recommendations) || typeof body.empty !== 'boolean') {
    throw new RecommendedTeamsApiError(502, 'INVALID_RESPONSE', INVALID_RESPONSE);
  }
  const recommendations: RecommendedTeam[] = [];
  for (const raw of body.recommendations) {
    const team = parseTeam(raw);
    if (!team) throw new RecommendedTeamsApiError(502, 'INVALID_RESPONSE', INVALID_RESPONSE);
    recommendations.push(team);
  }
  const reason = body.ineligibleReason;
  if (reason != null && (typeof reason !== 'string' || !REASONS.includes(reason))) {
    throw new RecommendedTeamsApiError(502, 'INVALID_RESPONSE', INVALID_RESPONSE);
  }
  // A list and the "empty" flag must agree, and a reason only belongs with an empty list.
  if (body.empty !== (recommendations.length === 0) || (reason != null && recommendations.length > 0)) {
    throw new RecommendedTeamsApiError(502, 'INVALID_RESPONSE', INVALID_RESPONSE);
  }
  return {
    recommendations,
    empty: body.empty,
    ineligibleReason: (reason as RecommendedTeamsIneligibleReason | null | undefined) ?? null,
    message: typeof body.message === 'string' ? body.message : null,
    notice: typeof body.notice === 'string' ? body.notice : null,
  };
}

/** GET /api/recommendations/teams */
export async function fetchRecommendedTeams(): Promise<RecommendedTeamsResponse> {
  let res: Response;
  try {
    res = await authFetch('/api/recommendations/teams', { method: 'GET' });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new RecommendedTeamsApiError(0, 'NETWORK', 'Network error. Please check your connection and try again.');
  }

  if (!res.ok) {
    let body: { error?: string; code?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // non-JSON error body
    }
    throw new RecommendedTeamsApiError(
      res.status,
      body.code || 'UNKNOWN_ERROR',
      body.error || `Request failed with status ${res.status}`
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new RecommendedTeamsApiError(502, 'INVALID_RESPONSE', INVALID_RESPONSE);
  }
  return parseRecommendedTeamsResponse(json);
}

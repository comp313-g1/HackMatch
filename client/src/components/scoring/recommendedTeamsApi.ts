import { authFetch, AuthRequiredError } from '../../config/authFetch';
import type { ParticipantPrimaryRole, TeamGoal } from '../teams/openTeamsApi';

export { AuthRequiredError };

export interface RecommendedTeamExplanationItem {
  component: 'skill' | 'goal' | 'hours';
  label: string;
  value: number;
  detail: string;
}

export interface RecommendedTeam {
  teamId: string;
  teamName: string;
  vacancyId: string;
  role: ParticipantPrimaryRole;
  teamGoal: TeamGoal;
  commitmentHours: number;
  matchedSkills?: string[];
  roleMatched?: boolean;
  rank?: number;
  displayScore?: string;
  score?: number;
  components?: { skill: number; goal: number; hours: number };
  explanation?: {
    displayScore: string;
    score: number;
    notice: string;
    roleMatched: boolean;
    matchedSkills: string[];
    hadMissingInput: boolean;
    items: RecommendedTeamExplanationItem[];
    contributions: { skill: string; goal: string; hours: string };
  };
}

export interface RecommendedTeamsResponse {
  status: 'ok' | 'degraded';
  teams: RecommendedTeam[];
  empty: boolean;
  message: string | null;
  notice: string;
  degradedNotice?: string;
}

export class RecommendedTeamsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly errors?: Record<string, string>,
    readonly details?: Record<string, unknown>,
    message?: string
  ) {
    super(message || code);
    this.name = 'RecommendedTeamsApiError';
  }
}

/**
 * GET /api/scoring/teams/recommendations (US-016).
 *
 * The endpoint takes no parameters: the server derives the participant from the token,
 * so the client cannot ask for somebody else's ranking.
 */
async function requestRecommendedTeams(): Promise<RecommendedTeamsResponse> {
  let res: Response;
  try {
    res = await authFetch('/api/scoring/teams/recommendations', { method: 'GET' });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new RecommendedTeamsApiError(
      0,
      'NETWORK',
      { _form: 'Network error. Your loaded teams have been kept.' },
      undefined,
      'Network error. Your loaded teams have been kept.'
    );
  }

  if (res.ok) {
    return (await res.json()) as RecommendedTeamsResponse;
  }

  let errBody: {
    error?: string;
    code?: string;
    errors?: Record<string, string>;
    details?: Record<string, unknown>;
  } = {};
  try {
    errBody = (await res.json()) as typeof errBody;
  } catch {
    // non-JSON body
  }

  throw new RecommendedTeamsApiError(
    res.status,
    errBody.code || 'UNKNOWN_ERROR',
    errBody.errors,
    errBody.details,
    errBody.error || `Request failed with status ${res.status}`
  );
}

export async function fetchRecommendedTeams(): Promise<RecommendedTeamsResponse> {
  return requestRecommendedTeams();
}

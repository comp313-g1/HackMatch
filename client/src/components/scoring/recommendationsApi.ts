import { authFetch, AuthRequiredError } from '../../config/authFetch';
import type { RecommendationExclusionSummary } from './recommendationEligibilityMessages';

export { AuthRequiredError };

export interface RecommendationExplanationItem {
  component: 'skill' | 'goal' | 'hours';
  label: string;
  value: number;
  detail: string;
}

export interface RecommendationCandidate {
  participantId: string;
  displayName: string;
  handle: string | null;
  primaryRole: string | null;
  desiredRole: string | null;
  skills: string[];
  commitmentHours: number | null;
  goal: string | null;
  rank?: number;
  displayScore?: string;
  score?: number;
  components?: { skill: number; goal: number; hours: number };
  matchedSkills?: string[];
  roleMatched?: boolean;
  contributions?: { skill: string; goal: string; hours: string };
  explanation?: {
    displayScore: string;
    score: number;
    notice: string;
    roleMatched: boolean;
    matchedSkills: string[];
    hadMissingInput: boolean;
    items: RecommendationExplanationItem[];
    contributions: { skill: string; goal: string; hours: string };
  };
}

export interface RecommendationsResponse {
  status: 'ok' | 'degraded';
  teamId: string;
  vacancyId: string;
  slotId?: string;
  slot: {
    vacancyId: string;
    role: string;
    requiredSkills: string[];
    requestedHours: number;
    goal: string;
  };
  candidates: RecommendationCandidate[];
  empty: boolean;
  message: string | null;
  notice: string;
  exclusions: RecommendationExclusionSummary;
  degradedNotice?: string;
}

export class RecommendationsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly errors?: Record<string, string>,
    readonly details?: Record<string, unknown>,
    message?: string
  ) {
    super(message || code);
    this.name = 'RecommendationsApiError';
  }
}

async function requestRecommendations(path: string): Promise<RecommendationsResponse> {
  let res: Response;
  try {
    res = await authFetch(path, { method: 'GET' });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new RecommendationsApiError(
      0,
      'NETWORK',
      { _form: 'Network error. Your entered values have been kept.' },
      undefined,
      'Network error. Your entered values have been kept.'
    );
  }

  if (res.ok) {
    return (await res.json()) as RecommendationsResponse;
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
    // non-JSON
  }

  throw new RecommendationsApiError(
    res.status,
    errBody.code || 'UNKNOWN_ERROR',
    errBody.errors,
    errBody.details,
    errBody.error || `Request failed with status ${res.status}`
  );
}

/**
 * GET /api/teams/:teamId/slots/:slotId/recommendations
 */
export async function fetchSlotRecommendations(
  teamId: string,
  slotId: string
): Promise<RecommendationsResponse> {
  return requestRecommendations(
    `/api/teams/${encodeURIComponent(teamId)}/slots/${encodeURIComponent(slotId)}/recommendations`
  );
}

/**
 * GET /api/teams/:teamId/vacancies/:vacancyId/recommendations
 */
export async function fetchVacancyRecommendations(
  teamId: string,
  vacancyId: string
): Promise<RecommendationsResponse> {
  return requestRecommendations(
    `/api/teams/${encodeURIComponent(teamId)}/vacancies/${encodeURIComponent(vacancyId)}/recommendations`
  );
}

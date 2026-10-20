import { authFetch, AuthRequiredError } from '../../config/authFetch';
import type {
  TeamView,
  TeamFieldErrors,
  TeamLimits,
  CreateTeamPayload,
  UpdateTeamPayload,
  ParticipantPrimaryRole,
  RosterLockValidationResult,
} from './teamTypes';

export { AuthRequiredError };

export class TeamApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly errors?: TeamFieldErrors,
    readonly details?: Record<string, unknown>,
    readonly limits?: TeamLimits,
    message?: string
  ) {
    super(message || code);
    this.name = 'TeamApiError';
  }
}

async function parseResponseOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) {
    return (await res.json()) as T;
  }

  let errBody: {
    error?: string;
    code?: string;
    errors?: TeamFieldErrors;
    details?: Record<string, unknown>;
    limits?: TeamLimits;
  } = {};

  try {
    errBody = (await res.json()) as typeof errBody;
  } catch {
    // Non-JSON error payload
  }

  throw new TeamApiError(
    res.status,
    errBody.code || 'UNKNOWN_ERROR',
    errBody.errors,
    errBody.details,
    errBody.limits,
    errBody.error || `Request failed with status ${res.status}`
  );
}

async function handleApiCall<T>(call: () => Promise<Response>): Promise<T> {
  let res: Response;
  try {
    res = await call();
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) {
      throw err;
    }
    throw new TeamApiError(
      0,
      'NETWORK',
      { _form: 'Network error. Your entered values have been kept.' },
      undefined,
      undefined,
      'Network error. Your entered values have been kept.'
    );
  }
  return parseResponseOrThrow<T>(res);
}

export async function fetchMyTeam(eventId?: string): Promise<TeamView | null> {
  const url = eventId ? `/api/teams/mine?eventId=${encodeURIComponent(eventId)}` : '/api/teams/mine';
  const result = await handleApiCall<{ team: TeamView | null }>(() =>
    authFetch(url, {
      method: 'GET',
    })
  );
  return result.team;
}

export async function fetchMyTeams(): Promise<TeamView[]> {
  const result = await handleApiCall<{ teams?: TeamView[]; team?: TeamView | null }>(() =>
    authFetch('/api/teams/mine', {
      method: 'GET',
    })
  );
  if (result.teams && Array.isArray(result.teams)) {
    return result.teams;
  }
  return result.team ? [result.team] : [];
}

export async function fetchTeam(teamId: string): Promise<TeamView> {
  const result = await handleApiCall<{ team: TeamView }>(() =>
    authFetch(`/api/teams/${encodeURIComponent(teamId)}`, {
      method: 'GET',
    })
  );
  return result.team;
}

export async function createTeam(payload: CreateTeamPayload): Promise<TeamView> {
  const result = await handleApiCall<{ team: TeamView }>(() =>
    authFetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  );
  return result.team;
}

export async function updateTeam(
  teamId: string,
  patch: UpdateTeamPayload
): Promise<TeamView> {
  const result = await handleApiCall<{ team: TeamView }>(() =>
    authFetch(`/api/teams/${encodeURIComponent(teamId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  );
  return result.team;
}

export async function addVacancy(
  teamId: string,
  payload: { role: ParticipantPrimaryRole; skills: string[] }
): Promise<TeamView> {
  const result = await handleApiCall<{ team: TeamView }>(() =>
    authFetch(`/api/teams/${encodeURIComponent(teamId)}/vacancies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  );
  return result.team;
}

export async function updateVacancy(
  teamId: string,
  vacancyId: string,
  payload: { role: ParticipantPrimaryRole; skills: string[] }
): Promise<TeamView> {
  const result = await handleApiCall<{ team: TeamView }>(() =>
    authFetch(
      `/api/teams/${encodeURIComponent(teamId)}/vacancies/${encodeURIComponent(vacancyId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )
  );
  return result.team;
}

export async function removeVacancy(
  teamId: string,
  vacancyId: string
): Promise<{ canceledRequests: number; team: TeamView }> {
  return handleApiCall<{ canceledRequests: number; team: TeamView }>(() =>
    authFetch(
      `/api/teams/${encodeURIComponent(teamId)}/vacancies/${encodeURIComponent(vacancyId)}`,
      {
        method: 'DELETE',
      }
    )
  );
}

export async function removeMember(
  teamId: string,
  participantId: string,
  reason: string
): Promise<{ availabilityRestored: boolean; team: TeamView }> {
  return handleApiCall<{ availabilityRestored: boolean; team: TeamView }>(() =>
    authFetch(
      `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(participantId)}/remove`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      }
    )
  );
}

export async function disbandTeam(
  teamId: string
): Promise<{ releasedMembers: number; canceledRequests: number }> {
  return handleApiCall<{ releasedMembers: number; canceledRequests: number }>(() =>
    authFetch(`/api/teams/${encodeURIComponent(teamId)}/disband`, {
      method: 'POST',
    })
  );
}

/** POST /api/teams/:teamId/leave — US-019 / #183 / FR-059 pre-lock non-owner leave. */
export async function leaveTeam(teamId: string): Promise<{
  message: string;
  availabilityRestored: boolean;
  leftParticipantId: string;
  teamId: string;
}> {
  return handleApiCall<{
    message: string;
    availabilityRestored: boolean;
    leftParticipantId: string;
    teamId: string;
  }>(() =>
    authFetch(`/api/teams/${encodeURIComponent(teamId)}/leave`, {
      method: 'POST',
    })
  );
}

/** GET /api/teams/:teamId/lock/validate — US-022 / #207 / FR-066 owner lock preflight. */
export async function validateTeamLock(
  teamId: string
): Promise<RosterLockValidationResult> {
  const result = await handleApiCall<{ validation: RosterLockValidationResult }>(() =>
    authFetch(`/api/teams/${encodeURIComponent(teamId)}/lock/validate`, {
      method: 'GET',
    })
  );
  return result.validation;
}

/** POST /api/teams/:teamId/lock — US-022 / #208 / FR-066 atomic roster lock. */
export async function lockTeam(teamId: string): Promise<{
  message: string;
  lockedAt: string;
  memberCount: number;
  minRequired: number;
  maxAllowed: number;
  canceledRequests: number;
  team: TeamView;
}> {
  return handleApiCall<{
    message: string;
    lockedAt: string;
    memberCount: number;
    minRequired: number;
    maxAllowed: number;
    canceledRequests: number;
    team: TeamView;
  }>(() =>
    authFetch(`/api/teams/${encodeURIComponent(teamId)}/lock`, {
      method: 'POST',
    })
  );
}

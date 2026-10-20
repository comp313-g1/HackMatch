import { authFetch, AuthRequiredError } from '../../config/authFetch';

export { AuthRequiredError };

export class TeamInvitationsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly errors?: Record<string, string | undefined>,
    readonly details?: Record<string, unknown>,
    message?: string
  ) {
    super(message || code);
    this.name = 'TeamInvitationsApiError';
  }
}

export interface OwnerInvitationListItem {
  id: string;
  teamId: string;
  eventId: string;
  vacancyId: string | null;
  inviteeParticipantId: string;
  inviteeHandle: string | null;
  inviteeDisplayName: string;
  status: string;
  requestType: 'Invitation';
  expiresAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
  vacancyRole: string | null;
  teamName: string;
  expiredByClock: boolean;
}

export interface OwnerInvitationsListResponse {
  teamId: string;
  invitations: OwnerInvitationListItem[];
  empty: boolean;
  message: string | null;
}

export interface IssueInvitationPayload {
  vacancyId: string;
  inviteeParticipantId: string;
  source?: 'recommendation' | 'direct';
}

export interface IssuedInvitation {
  id: string;
  teamId: string;
  eventId: string;
  vacancyId: string | null;
  inviteeParticipantId: string;
  status: string;
  requestType: 'Invitation';
  expiresAt: string;
  createdAt: string;
  teamName: string;
  vacancyRole: string;
  source: 'recommendation' | 'direct';
  notice: string;
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) {
    return (await res.json()) as T;
  }

  let errBody: {
    error?: string;
    code?: string;
    errors?: Record<string, string | undefined>;
    details?: Record<string, unknown>;
  } = {};

  try {
    errBody = (await res.json()) as typeof errBody;
  } catch {
    // Non-JSON
  }

  throw new TeamInvitationsApiError(
    res.status,
    errBody.code || 'UNKNOWN_ERROR',
    errBody.errors,
    errBody.details,
    errBody.error || `Request failed with status ${res.status}`
  );
}

async function authCall<T>(call: () => Promise<Response>): Promise<T> {
  let res: Response;
  try {
    res = await call();
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new TeamInvitationsApiError(
      0,
      'NETWORK',
      { _form: 'Network error. Your invitation form values have been kept.' },
      undefined,
      'Network error. Your invitation form values have been kept.'
    );
  }
  return parseOrThrow<T>(res);
}

/** GET /api/teams/:teamId/invitations — owner outbound list (#162). */
export async function fetchTeamInvitations(teamId: string): Promise<OwnerInvitationsListResponse> {
  return authCall(() =>
    authFetch(`/api/teams/${encodeURIComponent(teamId)}/invitations`, { method: 'GET' })
  );
}

/** POST /api/teams/:teamId/invitations — owner issuance (#162 / FR-049). */
export async function issueTeamInvitation(
  teamId: string,
  payload: IssueInvitationPayload
): Promise<IssuedInvitation> {
  const data = await authCall<{ invitation: IssuedInvitation }>(() =>
    authFetch(`/api/teams/${encodeURIComponent(teamId)}/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vacancyId: payload.vacancyId,
        inviteeParticipantId: payload.inviteeParticipantId,
        source: payload.source ?? 'direct',
      }),
    })
  );
  return data.invitation;
}

export interface AcceptanceRevalidationResult {
  eligible: true;
  invitation: {
    id: string;
    teamId: string;
    eventId: string;
    vacancyId: string | null;
    inviteeParticipantId: string;
    status: string;
    expiresAt: string;
    teamName: string;
    vacancyRole: string | null;
  };
  notice: string;
}

/**
 * POST /api/invitations/:id/accept — US-017 / #165 acceptance-time revalidation.
 * Rejects expired / unusable invitations; does not confirm membership yet (US-019).
 */
export async function revalidateInvitationAcceptance(
  invitationId: string
): Promise<AcceptanceRevalidationResult> {
  return authCall(() =>
    authFetch(`/api/invitations/${encodeURIComponent(invitationId)}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
  );
}

export interface CanceledInvitationResult {
  invitation: {
    id: string;
    teamId: string;
    eventId: string;
    vacancyId: string | null;
    inviteeParticipantId: string;
    status: string;
    requestType: 'Invitation';
    expiresAt: string | null;
    resolvedAt: string | null;
    cancelReason: string | null;
    teamName: string;
    vacancyRole: string | null;
  };
  changed: boolean;
  idempotent: boolean;
  alerts: Array<{ audience: string; type: string; message: string }>;
  notice: string;
}

/** DELETE /api/invitations/:id — owner cancel Pending invite (#166 / FR-052). */
export async function cancelTeamInvitation(
  invitationId: string
): Promise<CanceledInvitationResult> {
  return authCall(() =>
    authFetch(`/api/invitations/${encodeURIComponent(invitationId)}`, {
      method: 'DELETE',
    })
  );
}

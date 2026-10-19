import { authFetch, AuthRequiredError } from '../../config/authFetch';

export { AuthRequiredError };

export class InvitationsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly errors?: Record<string, string | undefined>,
    readonly details?: Record<string, unknown>,
    message?: string
  ) {
    super(message || code);
    this.name = 'InvitationsApiError';
  }
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

export interface IssueInvitationPayload {
  vacancyId: string;
  inviteeParticipantId: string;
  source?: 'recommendation' | 'direct';
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

  throw new InvitationsApiError(
    res.status,
    errBody.code || 'UNKNOWN_ERROR',
    errBody.errors,
    errBody.details,
    errBody.error || `Request failed with status ${res.status}`
  );
}

/**
 * POST /api/teams/:teamId/invitations — US-017 issuance used by FR-048 from recommendations.
 */
export async function issueTeamInvitation(
  teamId: string,
  payload: IssueInvitationPayload
): Promise<IssuedInvitation> {
  let res: Response;
  try {
    res = await authFetch(`/api/teams/${encodeURIComponent(teamId)}/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vacancyId: payload.vacancyId,
        inviteeParticipantId: payload.inviteeParticipantId,
        source: payload.source ?? 'recommendation',
      }),
    });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new InvitationsApiError(
      0,
      'NETWORK',
      { _form: 'Network error. Your invitation draft has been kept.' },
      undefined,
      'Network error. Your invitation draft has been kept.'
    );
  }

  const data = await parseOrThrow<{ invitation: IssuedInvitation }>(res);
  return data.invitation;
}

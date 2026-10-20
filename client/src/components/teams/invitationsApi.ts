import { authFetch, AuthRequiredError } from '../../config/authFetch';

export { AuthRequiredError };

/** Shared invitation API error (US-017). Scoring UI aliases this as InvitationsApiError. */
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

/** Alias for recommendation invite flows (FR-048) that expect this class name. */
export class InvitationsApiError extends TeamInvitationsApiError {
  constructor(
    status: number,
    code: string,
    errors?: Record<string, string | undefined>,
    details?: Record<string, unknown>,
    message?: string
  ) {
    super(status, code, errors, details, message);
    this.name = 'InvitationsApiError';
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
  eventId?: string;
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

  throw new InvitationsApiError(
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
    throw new InvitationsApiError(
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
  accepted: true;
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
  membership: {
    id: string;
    teamId: string;
    eventId: string;
    participantId: string;
    role: string;
    status: string;
    joinedAt: string;
  };
  vacancy: { id: string; status: string; role: string };
  memberCount: number;
  maxTeamSize: number;
  availabilityCleared: boolean;
  notice: string;
}

/**
 * POST /api/invitations/:id/accept — US-019 / #180 atomic acceptance.
 * Revalidates the invitation and confirms membership in one transaction.
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

export interface InviteeInvitationListItem {
  id: string;
  teamId: string;
  eventId: string;
  vacancyId: string | null;
  inviteeParticipantId: string;
  status: string;
  statusLabel: string;
  requestType: 'Invitation';
  expiresAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
  cancelReason: string | null;
  teamName: string;
  vacancyRole: string | null;
  expiredByClock: boolean;
  canRespond: boolean;
  permittedDetails?: {
    teamName: string;
    vacancyRole: string | null;
    expiresAt: string | null;
    statusLabel: string;
  };
}

export interface InviteeInvitationsListResponse {
  invitations: InviteeInvitationListItem[];
  empty: boolean;
  message: string | null;
}

export type InvitationResponseDecision = 'accept' | 'decline';

export interface InvitationRespondResult {
  decision: InvitationResponseDecision;
  membershipCommitted: boolean;
  invitation: {
    id: string;
    teamId: string;
    eventId: string;
    vacancyId: string | null;
    inviteeParticipantId: string;
    status: string;
    statusLabel: string;
    requestType: 'Invitation';
    expiresAt: string | null;
    resolvedAt: string | null;
    cancelReason: string | null;
    teamName: string;
    vacancyRole: string | null;
  };
  changed: boolean;
  idempotent: boolean;
  eligible?: boolean;
  membership?: {
    id: string;
    teamId: string;
    eventId: string;
    participantId: string;
    role: string;
    status: string;
    joinedAt: string;
  };
  vacancy?: { id: string; status: string; role: string };
  memberCount?: number;
  maxTeamSize?: number;
  availabilityCleared?: boolean;
  cascade?: {
    eventInvitationsCanceled: number;
    eventApplicationsWithdrawn: number;
    slotRequestsCanceled: number;
    teamRequestsCanceled: number;
    teamNowFull: boolean;
  };
  effects?: {
    invitationChanged: boolean;
    ownerAlertCreated: boolean;
    inviteeAlertCreated: boolean;
    availabilityChanged: false;
    membershipChanged: false;
    vacancyChanged: false;
  };
  alerts: Array<{
    audience: string;
    type: string;
    message: string;
    notificationId?: string;
    createdAt?: string;
  }>;
  notice: string;
}

/** GET /api/invitations/mine — invitee inbound list (US-019 / #179). */
export async function fetchMyInvitations(): Promise<InviteeInvitationsListResponse> {
  return authCall(() => authFetch('/api/invitations/mine', { method: 'GET' }));
}

/** GET /api/invitations/:id — invitee detail with permitted team fields (#179). */
export async function fetchInvitationDetail(
  invitationId: string
): Promise<InviteeInvitationListItem> {
  const data = await authCall<{ invitation: InviteeInvitationListItem }>(() =>
    authFetch(`/api/invitations/${encodeURIComponent(invitationId)}`, { method: 'GET' })
  );
  return data.invitation;
}

/**
 * POST /api/invitations/:id/respond — atomic accept (FR-051/FR-056) or decline (FR-058).
 */
export async function respondToInvitation(
  invitationId: string,
  decision: InvitationResponseDecision
): Promise<InvitationRespondResult> {
  return authCall(() =>
    authFetch(`/api/invitations/${encodeURIComponent(invitationId)}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    })
  );
}

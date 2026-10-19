export type TeamErrorCode =
  | 'EVENT_NOT_FOUND'
  | 'EVENT_NOT_RECRUITING'
  | 'ALREADY_CONFIRMED_MEMBER'
  | 'PARTICIPANT_NOT_ELIGIBLE'
  | 'VALIDATION_ERROR'
  | 'TEAM_NOT_FOUND'
  | 'FORBIDDEN_NOT_TEAM_OWNER'
  | 'TEAM_NOT_MUTABLE'
  | 'CAPACITY_EXCEEDED'
  | 'VACANCY_NOT_FOUND'
  | 'VACANCY_NOT_OPEN'
  | 'MEMBER_NOT_FOUND'
  | 'CANNOT_REMOVE_OWNER'
  | 'RECOMMENDATIONS_FORBIDDEN'
  | 'SLOT_NOT_OPEN_FOR_RECOMMENDATIONS'
  | 'CANNOT_INVITE_SELF'
  | 'INVITEE_NOT_ELIGIBLE'
  | 'INVITEE_NOT_AVAILABLE'
  | 'INVITEE_ALREADY_CONFIRMED'
  | 'DUPLICATE_PENDING_INVITATION'
  | 'SLOT_PENDING_INVITATION_EXISTS'
  | 'INVITATION_NOT_FOUND'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_NOT_ACCEPTABLE'
  | 'FORBIDDEN_NOT_INVITEE';

export const TEAM_ERROR_CATALOG: Record<TeamErrorCode, { status: number; message: string }> = {
  EVENT_NOT_FOUND: { status: 404, message: 'Event not found.' },
  EVENT_NOT_RECRUITING: { status: 409, message: 'Event is not actively recruiting teams.' },
  ALREADY_CONFIRMED_MEMBER: { status: 409, message: 'You are already a confirmed member of a team in this event.' },
  PARTICIPANT_NOT_ELIGIBLE: { status: 403, message: 'Participant is not eligible to create a team.' },
  VALIDATION_ERROR: { status: 400, message: 'Validation failed.' },
  TEAM_NOT_FOUND: { status: 404, message: 'Team not found.' },
  FORBIDDEN_NOT_TEAM_OWNER: { status: 403, message: 'You are not the owner of this team.' },
  TEAM_NOT_MUTABLE: { status: 409, message: 'Team recruitment is not open or event is concluded.' },
  CAPACITY_EXCEEDED: { status: 409, message: 'Team capacity exceeded.' },
  VACANCY_NOT_FOUND: { status: 404, message: 'Vacancy not found or not open.' },
  VACANCY_NOT_OPEN: {
    status: 409,
    message: 'This vacancy is not open. Invitations require an open slot.',
  },
  MEMBER_NOT_FOUND: { status: 404, message: 'Confirmed member not found on this team.' },
  CANNOT_REMOVE_OWNER: { status: 409, message: 'Team owner cannot be removed. To step down, disband the team.' },
  RECOMMENDATIONS_FORBIDDEN: {
    status: 403,
    message: 'Only the team owner can request candidate recommendations for an open slot.',
  },
  SLOT_NOT_OPEN_FOR_RECOMMENDATIONS: {
    status: 409,
    message: 'Recommendations require an open vacancy on a recruiting team in an active event.',
  },
  CANNOT_INVITE_SELF: { status: 400, message: 'You cannot invite yourself to your own team.' },
  INVITEE_NOT_ELIGIBLE: {
    status: 409,
    message: 'This candidate is not eligible for an invitation (inactive, unverified, or suspended).',
  },
  INVITEE_NOT_AVAILABLE: {
    status: 409,
    message: 'This candidate is not Looking for Team and cannot be invited.',
  },
  INVITEE_ALREADY_CONFIRMED: {
    status: 409,
    message: 'This candidate is already confirmed on a team for this event.',
  },
  DUPLICATE_PENDING_INVITATION: {
    status: 409,
    message: 'A pending invitation already exists for this candidate on this team.',
  },
  SLOT_PENDING_INVITATION_EXISTS: {
    status: 409,
    message: 'This open slot already has a pending invitation.',
  },
  INVITATION_NOT_FOUND: { status: 404, message: 'Invitation not found.' },
  INVITATION_EXPIRED: {
    status: 409,
    message:
      'This invitation has expired after 48 hours and can no longer be accepted.',
  },
  INVITATION_NOT_ACCEPTABLE: {
    status: 409,
    message: 'This invitation is no longer acceptable (canceled, declined, or otherwise closed).',
  },
  FORBIDDEN_NOT_INVITEE: {
    status: 403,
    message: 'Only the invited participant can accept this invitation.',
  },
};

export class TeamServiceError extends Error {
  constructor(
    readonly code: TeamErrorCode,
    readonly details?: Record<string, unknown>
  ) {
    super(TEAM_ERROR_CATALOG[code]?.message ?? code);
    this.name = 'TeamServiceError';
  }

  get status(): number {
    return TEAM_ERROR_CATALOG[this.code]?.status ?? 500;
  }
}

/**
 * Maps known database or PostgREST errors into a structured TeamServiceError.
 * Returns null for unmapped/internal errors so callers can rethrow safely.
 */
export function toTeamServiceError(err: unknown): TeamServiceError | null {
  if (err instanceof TeamServiceError) {
    return err;
  }

  if (typeof err === 'object' && err !== null) {
    const errorObj = err as {
      message?: string;
      code?: string;
      details?: string;
      detail?: string;
    };

    const message = errorObj.message;

    if (message && message in TEAM_ERROR_CATALOG) {
      let parsedDetails: Record<string, unknown> | undefined;
      const rawDetail = errorObj.detail || errorObj.details;
      if (rawDetail && typeof rawDetail === 'string') {
        try {
          parsedDetails = JSON.parse(rawDetail);
        } catch {
          parsedDetails = { raw: rawDetail };
        }
      }
      return new TeamServiceError(message as TeamErrorCode, parsedDetails);
    }

    const code = errorObj.code;
    if (code === '23505') {
      const combined = `${message ?? ''} ${errorObj.details ?? ''} ${errorObj.detail ?? ''}`;
      if (
        combined.includes('uq_team_memberships_confirmed_per_event') ||
        combined.includes('team_memberships')
      ) {
        return new TeamServiceError('ALREADY_CONFIRMED_MEMBER');
      }
      if (combined.includes('uq_team_requests_pending_invite_per_slot')) {
        return new TeamServiceError('SLOT_PENDING_INVITATION_EXISTS');
      }
      if (combined.includes('uq_team_requests_pending_invite')) {
        return new TeamServiceError('DUPLICATE_PENDING_INVITATION');
      }
    }

    if (code && ['23514', '22001', '22003', '22P02'].includes(code)) {
      return new TeamServiceError('VALIDATION_ERROR');
    }
  }

  return null;
}

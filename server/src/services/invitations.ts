/**
 * US-017 invitation issuance and US-015 FR-048 recommendation handoff.
 *
 * Pending invitations do not confirm membership or reserve capacity against applications.
 * Expiry is 48 hours from issuance; acceptance revalidation is a later US-019 concern.
 */

import { INVITATION_TTL_HOURS } from '../db/invitationModel.js';
import { teamsRepository } from '../db/teams.repository.js';
import type { TeamRequest } from '../db/types.js';
import { TeamServiceError, toTeamServiceError } from './teamErrors.js';

export { INVITATION_TTL_HOURS };

export interface IssueInvitationInput {
  actorParticipantId: string;
  teamId: string;
  vacancyId: string;
  inviteeParticipantId: string;
  source?: 'recommendation' | 'direct';
}

export interface IssuedInvitationView {
  id: string;
  teamId: string;
  eventId: string;
  vacancyId: string | null;
  inviteeParticipantId: string;
  status: TeamRequest['status'];
  requestType: 'Invitation';
  expiresAt: string;
  createdAt: string;
  teamName: string;
  vacancyRole: string;
  source: 'recommendation' | 'direct';
  notice: string;
}

function toView(
  invitation: TeamRequest,
  meta: { expiresAt: string; vacancyRole: string; teamName: string },
  source: 'recommendation' | 'direct'
): IssuedInvitationView {
  return {
    id: invitation.id,
    teamId: invitation.team_id,
    eventId: invitation.event_id,
    vacancyId: invitation.vacancy_id,
    inviteeParticipantId: invitation.participant_id,
    status: invitation.status,
    requestType: 'Invitation',
    expiresAt: meta.expiresAt || invitation.expires_at || '',
    createdAt: invitation.created_at,
    teamName: meta.teamName,
    vacancyRole: meta.vacancyRole,
    source,
    notice:
      'Pending invitation created. It expires in 48 hours and does not reserve the slot against applications.',
  };
}

export interface OwnerInvitationListItem {
  id: string;
  teamId: string;
  eventId: string;
  vacancyId: string | null;
  inviteeParticipantId: string;
  inviteeHandle: string | null;
  inviteeDisplayName: string;
  status: TeamRequest['status'];
  requestType: 'Invitation';
  expiresAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
  vacancyRole: string | null;
  teamName: string;
  /** True when Pending but clock expiry has passed (cleanup may lag). */
  expiredByClock: boolean;
}

export interface OwnerInvitationsListResult {
  teamId: string;
  invitations: OwnerInvitationListItem[];
  empty: boolean;
  message: string | null;
}

/**
 * Owner issues a slot-specific Pending invitation (FR-049).
 * Same authorization/eligibility path for recommendation and direct entry points (FR-048).
 */
export async function issueInvitation(input: IssueInvitationInput): Promise<IssuedInvitationView> {
  const source = input.source ?? 'direct';

  if (input.actorParticipantId === input.inviteeParticipantId) {
    throw new TeamServiceError('CANNOT_INVITE_SELF');
  }

  try {
    const result = await teamsRepository.issueTeamInvitation(
      input.actorParticipantId,
      input.teamId,
      input.vacancyId,
      input.inviteeParticipantId
    );
    return toView(result.invitation, result, source);
  } catch (err: unknown) {
    const mapped = toTeamServiceError(err);
    if (mapped) throw mapped;
    throw err;
  }
}

/**
 * Owner-only outbound invitation list (US-017 / #162).
 * requireTeamOwner on the route is the primary gate; service double-checks ownership.
 */
export async function listOwnerInvitations(
  actorParticipantId: string,
  teamId: string,
  now: Date = new Date()
): Promise<OwnerInvitationsListResult> {
  const team = await teamsRepository.findTeamById(teamId);
  if (!team) {
    throw new TeamServiceError('TEAM_NOT_FOUND');
  }
  if (team.owner_participant_id !== actorParticipantId) {
    throw new TeamServiceError('FORBIDDEN_NOT_TEAM_OWNER');
  }

  const rows = await teamsRepository.listTeamInvitations(teamId);
  const invitations: OwnerInvitationListItem[] = rows.map((row) => {
    const expiresAt = row.invitation.expires_at;
    const expiredByClock =
      row.invitation.status === 'Pending' &&
      (!expiresAt || Date.parse(expiresAt) <= now.getTime());

    return {
      id: row.invitation.id,
      teamId: row.invitation.team_id,
      eventId: row.invitation.event_id,
      vacancyId: row.invitation.vacancy_id,
      inviteeParticipantId: row.invitation.participant_id,
      inviteeHandle: row.inviteeHandle,
      inviteeDisplayName: row.inviteeDisplayName,
      status: row.invitation.status,
      requestType: 'Invitation',
      expiresAt,
      createdAt: row.invitation.created_at,
      resolvedAt: row.invitation.resolved_at,
      vacancyRole: row.vacancyRole,
      teamName: row.teamName,
      expiredByClock,
    };
  });

  return {
    teamId,
    invitations,
    empty: invitations.length === 0,
    message:
      invitations.length === 0
        ? 'No invitations yet. Invite a Looking-for-Team candidate to an open slot.'
        : null,
  };
}

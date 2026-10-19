/**
 * US-017 invitation issuance and US-015 FR-048 recommendation handoff.
 *
 * Pending invitations do not confirm membership or reserve capacity against applications.
 * Expiry is 48 hours from issuance; acceptance revalidation is a later US-019 concern.
 */

import { teamsRepository } from '../db/teams.repository.js';
import type { TeamRequest } from '../db/types.js';
import { TeamServiceError, toTeamServiceError } from './teamErrors.js';

export const INVITATION_TTL_HOURS = 48;

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

/**
 * US-017 invitation issuance and US-015 FR-048 recommendation handoff.
 *
 * Pending invitations do not confirm membership or reserve capacity against applications.
 * Expiry is 48 hours from issuance; acceptance atomically revalidates FR-051
 * and commits US-019 / FR-056 membership through the #180 transaction.
 */

import { INVITATION_TTL_HOURS } from '../db/invitationModel.js';
import { teamsRepository } from '../db/teams.repository.js';
import type { TeamRequest } from '../db/types.js';
import {
  assertInvitationIssuanceContext,
  type InvitationEligibilityDeps,
} from './invitationEligibility.js';
import {
  assertInvitationQuotas,
  type InvitationQuotaDeps,
} from './invitationQuota.js';
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
  eventId?: string;
  vacancyId: string | null;
  slotId?: string | null;
  inviteeParticipantId: string;
  inviteeId?: string;
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
    slotId: invitation.vacancy_id,
    inviteeParticipantId: invitation.participant_id,
    inviteeId: invitation.participant_id,
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
  eventId?: string;
  vacancyId: string | null;
  slotId?: string | null;
  inviteeParticipantId: string;
  inviteeId?: string;
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

export interface IssueInvitationDeps {
  eligibility?: Partial<InvitationEligibilityDeps>;
  quotas?: Partial<InvitationQuotaDeps>;
}

/**
 * Owner issues a slot-specific Pending invitation (FR-049).
 * Express preflight (#163) validates availability, team/event mutability, and open slot;
 * #164 / FR-050 enforces one Pending per slot and per invitee/team before the RPC;
 * Postgres unique indexes + RPC re-check quotas atomically.
 */
export async function issueInvitation(
  input: IssueInvitationInput,
  deps?: IssueInvitationDeps
): Promise<IssuedInvitationView> {
  const source = input.source ?? 'direct';

  await assertInvitationIssuanceContext(
    {
      actorParticipantId: input.actorParticipantId,
      teamId: input.teamId,
      vacancyId: input.vacancyId,
      inviteeParticipantId: input.inviteeParticipantId,
    },
    deps?.eligibility
  );

  await assertInvitationQuotas(
    {
      teamId: input.teamId,
      vacancyId: input.vacancyId,
      inviteeParticipantId: input.inviteeParticipantId,
    },
    deps?.quotas
  );

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
      slotId: row.invitation.vacancy_id,
      inviteeParticipantId: row.invitation.participant_id,
      inviteeId: row.invitation.participant_id,
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

export interface InvitationStatusAlert {
  audience: 'invitee' | 'owner' | string;
  type: string;
  message: string;
}

export interface CanceledInvitationResult {
  invitation: {
    id: string;
    teamId: string;
    eventId?: string;
    vacancyId: string | null;
    slotId?: string | null;
    inviteeParticipantId: string;
    inviteeId?: string;
    status: TeamRequest['status'];
    requestType: 'Invitation';
    expiresAt: string | null;
    resolvedAt: string | null;
    cancelReason: string | null;
    teamName: string;
    vacancyRole: string | null;
  };
  changed: boolean;
  idempotent: boolean;
  alerts: InvitationStatusAlert[];
  notice: string;
}

/**
 * Owner cancels a Pending invitation (US-017 / #166 / FR-052).
 * Releases pending quotas; writes basic status alerts for owner and invitee.
 * Repeated cancel of an already-Canceled invite is idempotent.
 */
export async function cancelInvitation(
  actorParticipantId: string,
  invitationId: string
): Promise<CanceledInvitationResult> {
  try {
    const result = await teamsRepository.cancelTeamInvitation(
      actorParticipantId,
      invitationId
    );
    const inv = result.invitation;
    return {
      invitation: {
        id: inv.id,
        teamId: inv.team_id,
        eventId: inv.event_id,
        vacancyId: inv.vacancy_id,
        slotId: inv.vacancy_id,
        inviteeParticipantId: inv.participant_id,
        inviteeId: inv.participant_id,
        status: inv.status,
        requestType: 'Invitation',
        expiresAt: inv.expires_at,
        resolvedAt: inv.resolved_at,
        cancelReason: inv.cancel_reason,
        teamName: result.teamName,
        vacancyRole: result.vacancyRole,
      },
      changed: result.changed,
      idempotent: result.idempotent,
      alerts: result.alerts,
      notice: result.notice,
    };
  } catch (err: unknown) {
    const mapped = toTeamServiceError(err);
    if (mapped) throw mapped;
    throw err;
  }
}

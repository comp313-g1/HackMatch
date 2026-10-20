/**
 * US-019 / #179 — invitee invitation detail and respond (accept revalidation / decline).
 *
 * Accept path uses the #180 atomic transaction for FR-051 revalidation and FR-056 membership.
 * Decline commits FR-058 (Pending → Declined) with basic owner/invitee alerts.
 */

import {
  isInvitationExpiredByClock,
  isInvitationPendingAcceptable,
} from '../db/invitationModel.js';
import { teamsRepository } from '../db/teams.repository.js';
import type { TeamRequest } from '../db/types.js';
import { acceptInvitation } from './invitationAcceptance.js';
import { TeamServiceError, toTeamServiceError } from './teamErrors.js';

export type InvitationResponseDecision = 'accept' | 'decline';

export function invitationStatusLabel(status: string, expiredByClock = false): string {
  if (expiredByClock && status === 'Pending') return 'Expired';
  return status;
}

export interface InviteeInvitationListItem {
  id: string;
  teamId: string;
  eventId: string;
  vacancyId: string | null;
  inviteeParticipantId: string;
  status: TeamRequest['status'];
  statusLabel: string;
  requestType: 'Invitation';
  expiresAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
  cancelReason: string | null;
  teamName: string;
  vacancyRole: string | null;
  expiredByClock: boolean;
  /** Pending and not clock-expired — invitee may Accept or Decline. */
  canRespond: boolean;
}

export interface InviteeInvitationsListResult {
  invitations: InviteeInvitationListItem[];
  empty: boolean;
  message: string | null;
}

export interface InvitationDetailView extends InviteeInvitationListItem {
  /** Permitted team/slot summary for the addressed PART (US-019 AC1). */
  permittedDetails: {
    teamName: string;
    vacancyRole: string | null;
    expiresAt: string | null;
    statusLabel: string;
  };
}

function toListItem(
  invitation: TeamRequest,
  meta: { teamName: string; vacancyRole: string | null },
  now: Date
): InviteeInvitationListItem {
  const expiredByClock =
    invitation.status === 'Pending' &&
    isInvitationExpiredByClock(invitation.expires_at, now);
  const canRespond = isInvitationPendingAcceptable(
    invitation.status,
    invitation.expires_at,
    now
  );

  return {
    id: invitation.id,
    teamId: invitation.team_id,
    eventId: invitation.event_id,
    vacancyId: invitation.vacancy_id,
    inviteeParticipantId: invitation.participant_id,
    status: invitation.status,
    statusLabel: invitationStatusLabel(invitation.status, expiredByClock),
    requestType: 'Invitation',
    expiresAt: invitation.expires_at,
    createdAt: invitation.created_at,
    resolvedAt: invitation.resolved_at,
    cancelReason: invitation.cancel_reason,
    teamName: meta.teamName,
    vacancyRole: meta.vacancyRole,
    expiredByClock,
    canRespond,
  };
}

/**
 * Invitee inspects inbound invitations (US-019 / #179).
 */
export async function listMyInvitations(
  actorParticipantId: string,
  now: Date = new Date()
): Promise<InviteeInvitationsListResult> {
  const rows = await teamsRepository.listMyInvitations(actorParticipantId);
  const invitations = rows.map((row) =>
    toListItem(row.invitation, { teamName: row.teamName, vacancyRole: row.vacancyRole }, now)
  );

  return {
    invitations,
    empty: invitations.length === 0,
    message:
      invitations.length === 0
        ? 'No invitations yet. When a team invites you to an open slot, it will appear here.'
        : null,
  };
}

/**
 * Invitee-only detail with permitted team/slot fields (US-019 AC1 / #179).
 */
export async function getInvitationDetailForInvitee(
  actorParticipantId: string,
  invitationId: string,
  now: Date = new Date()
): Promise<InvitationDetailView> {
  const invitation = await teamsRepository.findInvitationById(invitationId);
  if (!invitation) {
    throw new TeamServiceError('INVITATION_NOT_FOUND');
  }
  if (invitation.participant_id !== actorParticipantId) {
    throw new TeamServiceError('FORBIDDEN_NOT_INVITEE');
  }

  const team = await teamsRepository.findTeamById(invitation.team_id);
  if (!team) {
    throw new TeamServiceError('TEAM_NOT_FOUND');
  }

  let vacancyRole: string | null = null;
  if (invitation.vacancy_id) {
    const parts = await teamsRepository.getTeamViewParts(invitation.team_id);
    const vacancy = parts.vacancies.find((v) => v.id === invitation.vacancy_id);
    vacancyRole = vacancy?.role ?? null;
  }

  const item = toListItem(
    invitation,
    { teamName: team.name, vacancyRole },
    now
  );

  return {
    ...item,
    permittedDetails: {
      teamName: item.teamName,
      vacancyRole: item.vacancyRole,
      expiresAt: item.expiresAt,
      statusLabel: item.statusLabel,
    },
  };
}

export interface InvitationStatusAlert {
  audience: 'invitee' | 'owner' | string;
  type: string;
  message: string;
}

export interface InvitationRespondResult {
  decision: InvitationResponseDecision;
  /** True only after FR-056 membership commit (not yet for accept revalidation). */
  membershipCommitted: boolean;
  invitation: {
    id: string;
    teamId: string;
    eventId: string;
    vacancyId: string | null;
    inviteeParticipantId: string;
    status: TeamRequest['status'];
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
  vacancy?: {
    id: string;
    status: string;
    role: string;
  };
  memberCount?: number;
  maxTeamSize?: number;
  availabilityCleared?: boolean;
  alerts: InvitationStatusAlert[];
  notice: string;
}

/**
 * Addressed PART responds to a Pending invitation (US-019 / #179).
 * - accept: atomically revalidates and commits membership (FR-051 / FR-056 / #180)
 * - decline: FR-058 Pending → Declined with owner/invitee alerts
 */
export async function respondToInvitation(
  actorParticipantId: string,
  invitationId: string,
  decision: InvitationResponseDecision
): Promise<InvitationRespondResult> {
  if (decision === 'accept') {
    const result = await acceptInvitation({
      actorParticipantId,
      invitationId,
    });
    return {
      decision: 'accept',
      membershipCommitted: true,
      invitation: {
        id: result.invitation.id,
        teamId: result.invitation.team_id,
        eventId: result.invitation.event_id,
        vacancyId: result.invitation.vacancy_id,
        inviteeParticipantId: result.invitation.participant_id,
        status: result.invitation.status,
        statusLabel: 'Accepted',
        requestType: 'Invitation',
        expiresAt: result.invitation.expires_at,
        resolvedAt: result.invitation.resolved_at,
        cancelReason: result.invitation.cancel_reason,
        teamName: result.teamName,
        vacancyRole: result.vacancyRole,
      },
      changed: true,
      idempotent: false,
      eligible: true,
      membership: {
        id: result.membership.id,
        teamId: result.membership.team_id,
        eventId: result.membership.event_id,
        participantId: result.membership.participant_id,
        role: result.membership.role,
        status: result.membership.status,
        joinedAt: result.membership.joined_at,
      },
      vacancy: {
        id: result.vacancy.id,
        status: result.vacancy.status,
        role: result.vacancy.role,
      },
      memberCount: result.memberCount,
      maxTeamSize: result.maxTeamSize,
      availabilityCleared: result.availabilityCleared,
      alerts: [
        {
          audience: 'owner',
          type: 'team_invitation_accepted',
          message: 'The invited participant accepted the team invitation.',
        },
      ],
      notice: result.notice,
    };
  }

  try {
    const result = await teamsRepository.declineTeamInvitation(
      actorParticipantId,
      invitationId
    );
    const inv = result.invitation;
    return {
      decision: 'decline',
      membershipCommitted: false,
      invitation: {
        id: inv.id,
        teamId: inv.team_id,
        eventId: inv.event_id,
        vacancyId: inv.vacancy_id,
        inviteeParticipantId: inv.participant_id,
        status: inv.status,
        statusLabel: invitationStatusLabel(inv.status),
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

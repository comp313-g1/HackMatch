/**
 * US-017 / #165 / FR-051 — 48-hour expiry and acceptance-time revalidation.
 *
 * Acceptance fails at/after expires_at even when cleanup has not marked Expired yet.
 * Slot closure, locked teams, and non-recruiting events also make invitations unusable.
 * Full membership commit remains US-019 / FR-056; this module gates acceptance.
 */

import {
  isInvitationExpiredByClock,
  isInvitationPendingAcceptable,
} from '../db/invitationModel.js';
import type { ITeamsRepository } from '../db/teams.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import type { Participant, Team, TeamRequest, TeamVacancy } from '../db/types.js';
import type { IParticipantRepository } from '../db/participants.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import { deriveTeamLifecycle } from './teamLifecycle.js';
import { TeamServiceError } from './teamErrors.js';

export type AcceptanceRevalidationFailure =
  | 'INVITATION_NOT_FOUND'
  | 'FORBIDDEN_NOT_INVITEE'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_NOT_ACCEPTABLE'
  | 'VACANCY_NOT_OPEN'
  | 'VACANCY_NOT_FOUND'
  | 'TEAM_NOT_MUTABLE'
  | 'EVENT_NOT_RECRUITING'
  | 'INVITEE_NOT_ELIGIBLE'
  | 'INVITEE_ALREADY_CONFIRMED';

export interface AcceptanceRevalidationDecision {
  ok: boolean;
  code: AcceptanceRevalidationFailure | null;
}

/** Clock + Pending status (FR-051 — delayed cleanup must not extend validity). */
export function evaluateInvitationStillCurrent(
  invitation: Pick<TeamRequest, 'status' | 'expires_at'> | null | undefined,
  now: Date = new Date()
): AcceptanceRevalidationDecision {
  if (!invitation) {
    return { ok: false, code: 'INVITATION_NOT_FOUND' };
  }
  if (invitation.status === 'Expired' || isInvitationExpiredByClock(invitation.expires_at, now)) {
    return { ok: false, code: 'INVITATION_EXPIRED' };
  }
  if (!isInvitationPendingAcceptable(invitation.status, invitation.expires_at, now)) {
    return { ok: false, code: 'INVITATION_NOT_ACCEPTABLE' };
  }
  return { ok: true, code: null };
}

export function evaluateInviteeIsAddressee(
  actorParticipantId: string,
  invitation: Pick<TeamRequest, 'participant_id'>
): AcceptanceRevalidationDecision {
  if (invitation.participant_id !== actorParticipantId) {
    return { ok: false, code: 'FORBIDDEN_NOT_INVITEE' };
  }
  return { ok: true, code: null };
}

export function evaluateAcceptanceSlotStillOpen(
  vacancy: TeamVacancy | null | undefined,
  teamId: string
): AcceptanceRevalidationDecision {
  if (!vacancy || vacancy.team_id !== teamId) {
    return { ok: false, code: 'VACANCY_NOT_FOUND' };
  }
  if (vacancy.status !== 'Open') {
    return { ok: false, code: 'VACANCY_NOT_OPEN' };
  }
  return { ok: true, code: null };
}

export function evaluateAcceptanceTeamAndEvent(
  team: Pick<Team, 'recruitment_status'>,
  event: { status: 'Published' | 'Archived' | 'Disabled'; end_date: string },
  now: Date = new Date()
): AcceptanceRevalidationDecision {
  const lifecycle = deriveTeamLifecycle(team, event, now);
  if (!lifecycle.mutable) {
    if (lifecycle.reason === 'EventNotRecruiting') {
      return { ok: false, code: 'EVENT_NOT_RECRUITING' };
    }
    return { ok: false, code: 'TEAM_NOT_MUTABLE' };
  }
  return { ok: true, code: null };
}

export function evaluateAcceptorAccount(
  invitee: Participant | null | undefined
): AcceptanceRevalidationDecision {
  if (
    !invitee ||
    invitee.role !== 'PART' ||
    !invitee.is_verified ||
    invitee.is_suspended
  ) {
    return { ok: false, code: 'INVITEE_NOT_ELIGIBLE' };
  }
  return { ok: true, code: null };
}

export interface RevalidateAcceptanceInput {
  actorParticipantId: string;
  invitationId: string;
}

export interface InvitationAcceptanceDeps {
  teamsRepo: Pick<
    ITeamsRepository,
    | 'findInvitationById'
    | 'markInvitationExpiredIfDue'
    | 'getTeamViewParts'
    | 'listConfirmedParticipantIdsForEvent'
  >;
  participantsRepo: Pick<IParticipantRepository, 'findById'>;
  now?: () => Date;
}

export interface AcceptanceRevalidationResult {
  eligible: true;
  invitation: TeamRequest;
  expiresAt: string;
  teamName: string;
  vacancyRole: string | null;
  notice: string;
}

function resolveDeps(partial?: Partial<InvitationAcceptanceDeps>): InvitationAcceptanceDeps {
  return {
    teamsRepo: partial?.teamsRepo ?? teamsRepository,
    participantsRepo: partial?.participantsRepo ?? participantsRepository,
    now: partial?.now,
  };
}

/**
 * Acceptance-time revalidation gate (US-017 / #165).
 * Marks clock-due invitations Expired, then throws TeamServiceError when unusable.
 * On success returns eligibility metadata without confirming membership (US-019).
 */
export async function revalidateInvitationForAcceptance(
  input: RevalidateAcceptanceInput,
  partialDeps?: Partial<InvitationAcceptanceDeps>
): Promise<AcceptanceRevalidationResult> {
  const deps = resolveDeps(partialDeps);
  const now = deps.now ? deps.now() : new Date();

  let invitation = await deps.teamsRepo.findInvitationById(input.invitationId);
  if (!invitation || invitation.request_type !== 'Invitation') {
    throw new TeamServiceError('INVITATION_NOT_FOUND');
  }

  const addressee = evaluateInviteeIsAddressee(input.actorParticipantId, invitation);
  if (!addressee.ok && addressee.code) {
    throw new TeamServiceError(addressee.code);
  }

  // Persist Expired when clock is due so quota is restored even if batch cleanup lagged.
  if (
    invitation.status === 'Pending' &&
    isInvitationExpiredByClock(invitation.expires_at, now)
  ) {
    const marked = await deps.teamsRepo.markInvitationExpiredIfDue(input.invitationId);
    invitation = marked.invitation;
  }

  const current = evaluateInvitationStillCurrent(invitation, now);
  if (!current.ok && current.code) {
    throw new TeamServiceError(current.code, {
      status: invitation.status,
      expiresAt: invitation.expires_at,
    });
  }

  const parts = await deps.teamsRepo.getTeamViewParts(invitation.team_id);
  const eventMeta = {
    status: (parts.event.status ?? 'Published') as 'Published' | 'Archived' | 'Disabled',
    end_date: parts.event.end_date ?? '2099-12-31T23:59:59.000Z',
  };

  const teamEvent = evaluateAcceptanceTeamAndEvent(parts.team, eventMeta, now);
  if (!teamEvent.ok && teamEvent.code) {
    throw new TeamServiceError(teamEvent.code, {
      reason: deriveTeamLifecycle(parts.team, eventMeta, now).reason,
    });
  }

  const vacancy = parts.vacancies.find((v) => v.id === invitation!.vacancy_id) ?? null;
  const slot = evaluateAcceptanceSlotStillOpen(vacancy, invitation.team_id);
  if (!slot.ok && slot.code) {
    throw new TeamServiceError(slot.code, {
      vacancyStatus: vacancy?.status ?? null,
    });
  }

  const invitee = await deps.participantsRepo.findById(input.actorParticipantId);
  const account = evaluateAcceptorAccount(invitee);
  if (!account.ok && account.code) {
    throw new TeamServiceError(account.code);
  }

  const confirmedIds = await deps.teamsRepo.listConfirmedParticipantIdsForEvent(
    invitation.event_id
  );
  if (confirmedIds.includes(input.actorParticipantId)) {
    throw new TeamServiceError('INVITEE_ALREADY_CONFIRMED');
  }

  return {
    eligible: true,
    invitation,
    expiresAt: invitation.expires_at || '',
    teamName: parts.team.name,
    vacancyRole: vacancy?.role ?? null,
    notice:
      'Invitation is still valid within its 48-hour window. Slot, team, and event checks passed at acceptance time.',
  };
}

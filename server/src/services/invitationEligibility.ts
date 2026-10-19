/**
 * US-017 / #163 — invitation issuance guards:
 * candidate availability, team state, event recruiting, and open slot.
 *
 * Pure decisions are unit-tested; assertInvitationIssuanceContext loads deps and
 * throws TeamServiceError before the Postgres RPC runs (Express-layer evidence).
 */

import type { ITeamsRepository } from '../db/teams.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import type { IParticipantRepository } from '../db/participants.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { Participant, Team, TeamVacancy } from '../db/types.js';
import type { IAvailabilityRepository } from '../repositories/availability.repository.js';
import { availabilityRepository } from '../repositories/availability.repository.js';
import { deriveTeamLifecycle } from './teamLifecycle.js';
import { TeamServiceError } from './teamErrors.js';

export type InvitationEligibilityFailure =
  | 'CANNOT_INVITE_SELF'
  | 'FORBIDDEN_NOT_TEAM_OWNER'
  | 'TEAM_NOT_MUTABLE'
  | 'EVENT_NOT_RECRUITING'
  | 'VACANCY_NOT_FOUND'
  | 'VACANCY_NOT_OPEN'
  | 'INVITEE_NOT_ELIGIBLE'
  | 'INVITEE_NOT_AVAILABLE'
  | 'INVITEE_ALREADY_CONFIRMED';

export interface InvitationEligibilityDecision {
  ok: boolean;
  code: InvitationEligibilityFailure | null;
}

/** Active verified PART who is not suspended. */
export function evaluateInviteeAccount(
  invitee: Participant | null | undefined
): InvitationEligibilityDecision {
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

/** Looking-for-Team on the platform availability pool. */
export function evaluateInviteeAvailability(
  isLooking: boolean | null | undefined
): InvitationEligibilityDecision {
  if (isLooking !== true) {
    return { ok: false, code: 'INVITEE_NOT_AVAILABLE' };
  }
  return { ok: true, code: null };
}

export function evaluateInviteeNotConfirmed(
  alreadyConfirmedForEvent: boolean
): InvitationEligibilityDecision {
  if (alreadyConfirmedForEvent) {
    return { ok: false, code: 'INVITEE_ALREADY_CONFIRMED' };
  }
  return { ok: true, code: null };
}

export function evaluateOpenSlot(
  vacancy: TeamVacancy | null | undefined,
  teamId: string
): InvitationEligibilityDecision {
  if (!vacancy || vacancy.team_id !== teamId) {
    return { ok: false, code: 'VACANCY_NOT_FOUND' };
  }
  if (vacancy.status !== 'Open') {
    return { ok: false, code: 'VACANCY_NOT_OPEN' };
  }
  return { ok: true, code: null };
}

export function evaluateOwnerAndTeamMutable(
  actorParticipantId: string,
  team: Pick<Team, 'owner_participant_id' | 'recruitment_status'>,
  event: { status: 'Published' | 'Archived' | 'Disabled'; end_date: string },
  now: Date = new Date()
): InvitationEligibilityDecision {
  if (team.owner_participant_id !== actorParticipantId) {
    return { ok: false, code: 'FORBIDDEN_NOT_TEAM_OWNER' };
  }

  const lifecycle = deriveTeamLifecycle(team, event, now);
  if (!lifecycle.mutable) {
    if (lifecycle.reason === 'EventNotRecruiting') {
      return { ok: false, code: 'EVENT_NOT_RECRUITING' };
    }
    return { ok: false, code: 'TEAM_NOT_MUTABLE' };
  }
  return { ok: true, code: null };
}

export interface InvitationIssuanceContextInput {
  actorParticipantId: string;
  teamId: string;
  vacancyId: string;
  inviteeParticipantId: string;
}

export interface InvitationEligibilityDeps {
  teamsRepo: Pick<
    ITeamsRepository,
    'getTeamViewParts' | 'listConfirmedParticipantIdsForEvent' | 'findTeamById'
  >;
  participantsRepo: Pick<IParticipantRepository, 'findById'>;
  availabilityRepo: Pick<IAvailabilityRepository, 'findByParticipantId'>;
  now?: () => Date;
}

function resolveDeps(partial?: Partial<InvitationEligibilityDeps>): InvitationEligibilityDeps {
  return {
    teamsRepo: partial?.teamsRepo ?? teamsRepository,
    participantsRepo: partial?.participantsRepo ?? participantsRepository,
    availabilityRepo: partial?.availabilityRepo ?? availabilityRepository,
    now: partial?.now,
  };
}

/**
 * Express-layer preflight for invitation issuance (US-017 / #163).
 * Throws TeamServiceError; on success the RPC still re-checks atomically.
 */
export async function assertInvitationIssuanceContext(
  input: InvitationIssuanceContextInput,
  partialDeps?: Partial<InvitationEligibilityDeps>
): Promise<void> {
  if (input.actorParticipantId === input.inviteeParticipantId) {
    throw new TeamServiceError('CANNOT_INVITE_SELF');
  }

  const deps = resolveDeps(partialDeps);
  const now = deps.now ? deps.now() : new Date();

  const parts = await deps.teamsRepo.getTeamViewParts(input.teamId);
  const eventMeta = {
    status: (parts.event.status ?? 'Published') as 'Published' | 'Archived' | 'Disabled',
    end_date: parts.event.end_date ?? '2099-12-31T23:59:59.000Z',
  };

  const ownerDecision = evaluateOwnerAndTeamMutable(
    input.actorParticipantId,
    parts.team,
    eventMeta,
    now
  );
  if (!ownerDecision.ok && ownerDecision.code) {
    throw new TeamServiceError(ownerDecision.code, {
      reason: deriveTeamLifecycle(parts.team, eventMeta, now).reason,
    });
  }

  const vacancy = parts.vacancies.find((v) => v.id === input.vacancyId);
  const slotDecision = evaluateOpenSlot(vacancy, input.teamId);
  if (!slotDecision.ok && slotDecision.code) {
    throw new TeamServiceError(slotDecision.code, {
      vacancyStatus: vacancy?.status ?? null,
    });
  }

  const invitee = await deps.participantsRepo.findById(input.inviteeParticipantId);
  const accountDecision = evaluateInviteeAccount(invitee);
  if (!accountDecision.ok && accountDecision.code) {
    throw new TeamServiceError(accountDecision.code);
  }

  const availability = await deps.availabilityRepo.findByParticipantId(input.inviteeParticipantId);
  const lookingDecision = evaluateInviteeAvailability(availability?.isLooking);
  if (!lookingDecision.ok && lookingDecision.code) {
    throw new TeamServiceError(lookingDecision.code);
  }

  const confirmedIds = await deps.teamsRepo.listConfirmedParticipantIdsForEvent(parts.team.event_id);
  const confirmedDecision = evaluateInviteeNotConfirmed(
    confirmedIds.includes(input.inviteeParticipantId)
  );
  if (!confirmedDecision.ok && confirmedDecision.code) {
    throw new TeamServiceError(confirmedDecision.code);
  }
}

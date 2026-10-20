/**
 * US-018 / #173 — application submission guards:
 * verified PART, active unlocked team, open slot, and one-team-per-event.
 *
 * Pure decisions are unit-tested; assertApplicationSubmissionContext loads deps and
 * throws TeamServiceError before the Postgres RPC runs (Express-layer evidence).
 * RPC submit_team_application still re-checks atomically.
 */

import type { ITeamsRepository } from '../db/teams.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import type { IParticipantRepository } from '../db/participants.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { Participant, Team, TeamVacancy } from '../db/types.js';
import { deriveTeamLifecycle } from './teamLifecycle.js';
import { TeamServiceError } from './teamErrors.js';

export type ApplicationEligibilityFailure =
  | 'TEAM_NOT_FOUND'
  | 'CANNOT_APPLY_TO_OWN_TEAM'
  | 'TEAM_NOT_MUTABLE'
  | 'EVENT_NOT_RECRUITING'
  | 'VACANCY_NOT_FOUND'
  | 'VACANCY_NOT_OPEN'
  | 'APPLICANT_NOT_ELIGIBLE'
  | 'APPLICANT_ALREADY_CONFIRMED';

export interface ApplicationEligibilityDecision {
  ok: boolean;
  code: ApplicationEligibilityFailure | null;
}

/** Active verified PART who is not suspended (US-018-T6 / FR-053). */
export function evaluateApplicantAccount(
  applicant: Participant | null | undefined
): ApplicationEligibilityDecision {
  if (
    !applicant ||
    applicant.role !== 'PART' ||
    !applicant.is_verified ||
    applicant.is_suspended
  ) {
    return { ok: false, code: 'APPLICANT_NOT_ELIGIBLE' };
  }
  return { ok: true, code: null };
}

/** One confirmed team per participant per event. */
export function evaluateApplicantNotConfirmed(
  alreadyConfirmedForEvent: boolean
): ApplicationEligibilityDecision {
  if (alreadyConfirmedForEvent) {
    return { ok: false, code: 'APPLICANT_ALREADY_CONFIRMED' };
  }
  return { ok: true, code: null };
}

export function evaluateApplicantNotOwner(
  actorParticipantId: string,
  ownerParticipantId: string
): ApplicationEligibilityDecision {
  if (actorParticipantId === ownerParticipantId) {
    return { ok: false, code: 'CANNOT_APPLY_TO_OWN_TEAM' };
  }
  return { ok: true, code: null };
}

/** Open vacancy on the target team. */
export function evaluateApplicationOpenSlot(
  vacancy: TeamVacancy | null | undefined,
  teamId: string
): ApplicationEligibilityDecision {
  if (!vacancy || vacancy.team_id !== teamId) {
    return { ok: false, code: 'VACANCY_NOT_FOUND' };
  }
  if (vacancy.status !== 'Open') {
    return { ok: false, code: 'VACANCY_NOT_OPEN' };
  }
  return { ok: true, code: null };
}

/** Unlocked recruiting team in an active Published event (not owner-gated). */
export function evaluateTeamUnlockedAndRecruiting(
  team: Pick<Team, 'recruitment_status'> | null | undefined,
  event: { status: 'Published' | 'Archived' | 'Disabled'; end_date: string },
  now: Date = new Date()
): ApplicationEligibilityDecision {
  if (!team) {
    return { ok: false, code: 'TEAM_NOT_FOUND' };
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

export interface ApplicationSubmissionContextInput {
  actorParticipantId: string;
  teamId: string;
  vacancyId: string;
}

export interface ApplicationEligibilityDeps {
  teamsRepo: Pick<
    ITeamsRepository,
    'getTeamViewParts' | 'listConfirmedParticipantIdsForEvent' | 'findTeamById'
  >;
  participantsRepo: Pick<IParticipantRepository, 'findById'>;
  now?: () => Date;
}

function resolveDeps(partial?: Partial<ApplicationEligibilityDeps>): ApplicationEligibilityDeps {
  return {
    teamsRepo: partial?.teamsRepo ?? teamsRepository,
    participantsRepo: partial?.participantsRepo ?? participantsRepository,
    now: partial?.now,
  };
}

/**
 * Express-layer preflight for application submission (US-018 / #173).
 * Throws TeamServiceError; on success the RPC still re-checks atomically.
 */
export async function assertApplicationSubmissionContext(
  input: ApplicationSubmissionContextInput,
  partialDeps?: Partial<ApplicationEligibilityDeps>
): Promise<void> {
  const deps = resolveDeps(partialDeps);
  const now = deps.now ? deps.now() : new Date();

  const applicant = await deps.participantsRepo.findById(input.actorParticipantId);
  const accountDecision = evaluateApplicantAccount(applicant);
  if (!accountDecision.ok && accountDecision.code) {
    throw new TeamServiceError(accountDecision.code);
  }

  const team = await deps.teamsRepo.findTeamById(input.teamId);
  if (!team) {
    throw new TeamServiceError('TEAM_NOT_FOUND');
  }

  const ownerDecision = evaluateApplicantNotOwner(
    input.actorParticipantId,
    team.owner_participant_id
  );
  if (!ownerDecision.ok && ownerDecision.code) {
    throw new TeamServiceError(ownerDecision.code);
  }

  const parts = await deps.teamsRepo.getTeamViewParts(input.teamId);
  const eventMeta = {
    status: (parts.event.status ?? 'Published') as 'Published' | 'Archived' | 'Disabled',
    end_date: parts.event.end_date ?? '2099-12-31T23:59:59.000Z',
  };

  const teamDecision = evaluateTeamUnlockedAndRecruiting(parts.team, eventMeta, now);
  if (!teamDecision.ok && teamDecision.code) {
    throw new TeamServiceError(teamDecision.code, {
      reason: deriveTeamLifecycle(parts.team, eventMeta, now).reason,
    });
  }

  const vacancy = parts.vacancies.find((v) => v.id === input.vacancyId);
  const slotDecision = evaluateApplicationOpenSlot(vacancy, input.teamId);
  if (!slotDecision.ok && slotDecision.code) {
    throw new TeamServiceError(slotDecision.code, {
      vacancyStatus: vacancy?.status ?? null,
    });
  }

  const confirmedIds = await deps.teamsRepo.listConfirmedParticipantIdsForEvent(
    parts.team.event_id
  );
  const confirmedDecision = evaluateApplicantNotConfirmed(
    confirmedIds.includes(input.actorParticipantId)
  );
  if (!confirmedDecision.ok && confirmedDecision.code) {
    throw new TeamServiceError(confirmedDecision.code);
  }
}

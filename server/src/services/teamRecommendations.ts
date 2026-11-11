/**
 * US-016 / #154 — eligible open-team vacancy query for the authenticated participant.
 * Scoring, matched skills, recommendation UI, and application integration are later tasks.
 */

import { participantsRepository } from '../db/participants.repository.js';
import { profileRepository, type IProfileRepository } from '../db/profile.repository.js';
import {
  teamRecommendationsRepository,
  type ITeamRecommendationsRepository,
  type RecommendationTeamRecord,
} from '../db/teamRecommendations.repository.js';
import type { ParticipantPrimaryRole, TeamGoal } from '../db/types.js';
import {
  availabilityRepository,
  type IAvailabilityRepository,
} from '../repositories/availability.repository.js';
import {
  buildReverseMatchInputs,
  partitionTeamVacancies,
  type ParticipantExclusionReason,
} from './teamRecommendationEligibility.js';

export interface EligibleTeamRecommendation {
  teamId: string;
  teamName: string;
  pitch: string;
  goal: TeamGoal;
  commitmentHours: number;
  recruitmentStatus: 'Open';
  vacancyId: string;
  vacancyRole: ParticipantPrimaryRole;
  desiredSkills: string[];
}

export interface TeamRecommendationsResult {
  status: 'ok';
  recommendations: EligibleTeamRecommendation[];
  empty: boolean;
  message: string | null;
  eligibilityReason: ParticipantExclusionReason | null;
}

export interface TeamRecommendationsServiceDeps {
  participantsRepo: Pick<typeof participantsRepository, 'findById'>;
  profileRepo: Pick<
    IProfileRepository,
    'findProfileByParticipantId' | 'findSkillsByParticipantId'
  >;
  availabilityRepo: Pick<IAvailabilityRepository, 'findByParticipantId'>;
  recommendationsRepo: ITeamRecommendationsRepository;
}

const EMPTY_MESSAGE = 'No eligible open team vacancies are available right now.';

const PARTICIPANT_MESSAGES: Partial<Record<ParticipantExclusionReason, string>> = {
  participant_not_looking: 'Turn on Looking for Team to receive team recommendations.',
  participant_no_skills: 'Add at least one skill to receive team recommendations.',
  participant_profile_hidden: 'Team recommendations are not available for this profile.',
};

function resolveDeps(
  partial?: Partial<TeamRecommendationsServiceDeps>
): TeamRecommendationsServiceDeps {
  return {
    participantsRepo: partial?.participantsRepo ?? participantsRepository,
    profileRepo: partial?.profileRepo ?? profileRepository,
    availabilityRepo: partial?.availabilityRepo ?? availabilityRepository,
    recommendationsRepo: partial?.recommendationsRepo ?? teamRecommendationsRepository,
  };
}

function stableOrder(a: RecommendationTeamRecord, b: RecommendationTeamRecord): number {
  const byName = a.team.name.localeCompare(b.team.name, 'en', { sensitivity: 'base' });
  if (byName !== 0) return byName;
  const byTeam = a.team.id.localeCompare(b.team.id);
  return byTeam !== 0 ? byTeam : a.vacancy.id.localeCompare(b.vacancy.id);
}

function toSafeDto(candidate: RecommendationTeamRecord): EligibleTeamRecommendation {
  return {
    teamId: candidate.team.id,
    teamName: candidate.team.name,
    pitch: candidate.team.pitch,
    goal: candidate.team.goal,
    commitmentHours: Number(candidate.team.commitment_hours),
    recruitmentStatus: 'Open',
    vacancyId: candidate.vacancy.id,
    vacancyRole: candidate.vacancy.role,
    desiredSkills: [...(candidate.vacancy.skills ?? [])],
  };
}

/**
 * Builds #153 inputs for the authenticated participant, loads a database-prefiltered vacancy set,
 * then applies the #153 helper once more as a stale-state/contract backstop before projection.
 */
export async function getEligibleTeamRecommendations(
  participantId: string,
  partialDeps?: Partial<TeamRecommendationsServiceDeps>
): Promise<TeamRecommendationsResult> {
  const deps = resolveDeps(partialDeps);

  const [participant, profile, skills, availability] = await Promise.all([
    deps.participantsRepo.findById(participantId),
    deps.profileRepo.findProfileByParticipantId(participantId),
    deps.profileRepo.findSkillsByParticipantId(participantId),
    deps.availabilityRepo.findByParticipantId(participantId),
  ]);

  const inputResult = buildReverseMatchInputs({
    participant,
    profile,
    skills: (skills ?? []).map((skill) => skill.skill_name),
    availability,
  });

  if (!inputResult.ok) {
    return {
      status: 'ok',
      recommendations: [],
      empty: true,
      message: PARTICIPANT_MESSAGES[inputResult.reason] ?? EMPTY_MESSAGE,
      eligibilityReason: inputResult.reason,
    };
  }

  const queryResult = await deps.recommendationsRepo.listEligibleTeamVacanciesForParticipant(
    inputResult.inputs.participantId
  );
  const partitioned = partitionTeamVacancies(
    queryResult.candidates,
    inputResult.inputs,
    { pendingRequestTeamIds: queryResult.pendingRequestTeamIds }
  );

  const recommendations = [...partitioned.eligible]
    .sort(stableOrder)
    .map(toSafeDto);

  return {
    status: 'ok',
    recommendations,
    empty: recommendations.length === 0,
    message: recommendations.length === 0 ? EMPTY_MESSAGE : null,
    eligibilityReason: null,
  };
}

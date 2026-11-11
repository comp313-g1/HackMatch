/**
 * US-016 / #154 + #155 — recommended open-team vacancies for the authenticated participant.
 *
 * #154 finds the eligible vacancies; #155 scores each one (match percentage, matched and missing
 * skills) and orders them best first. The recommendation page (#156) and the application hook-up
 * (#157) build on this result.
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
import { rankTeamVacancies, type RankedTeamMatch } from './teamRecommendationScoring.js';

/** The empty-state reasons the participant-facing page understands (the exact cause is not shared). */
export type RecommendationIneligibleReason =
  | 'participant_not_looking'
  | 'participant_no_skills'
  | 'participant_profile_hidden'
  | 'participant_unavailable';

export const RECOMMENDATION_SCORE_NOTICE =
  'Match percentages compare the skills, goal and hours you and each team have declared. They are suggestions, not predictions.';

export interface EligibleTeamRecommendation {
  /** 1-based position, best match first. */
  rank: number;
  teamId: string;
  teamName: string;
  pitch: string;
  goal: TeamGoal;
  commitmentHours: number;
  recruitmentStatus: 'Open';
  vacancyId: string;
  vacancyRole: ParticipantPrimaryRole;
  desiredSkills: string[];
  /** Whole number, 0 to 100. */
  matchPercent: number;
  /** Required skills the participant has / does not have yet, in the team's spelling. */
  matchedSkills: string[];
  missingSkills: string[];
  roleMatched: boolean;
  contributions: { skill: string; goal: string; hours: string };
}

export interface TeamRecommendationsResult {
  status: 'ok';
  recommendations: EligibleTeamRecommendation[];
  empty: boolean;
  message: string | null;
  /**
   * Why the participant gets no suggestions at all, or null. Only the reasons the participant may
   * see: account problems (suspended, deactivated, unverified, missing) are not spelled out.
   */
  eligibilityReason: RecommendationIneligibleReason | null;
  notice: string;
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

/**
 * Maps the exact cause to what the page may show. A suspended, deactivated, unverified or missing
 * account is not spelled out: the participant only learns that suggestions are unavailable.
 */
function toPageReason(reason: ParticipantExclusionReason): RecommendationIneligibleReason {
  switch (reason) {
    case 'participant_not_looking':
    case 'participant_no_skills':
    case 'participant_profile_hidden':
      return reason;
    default:
      return 'participant_unavailable';
  }
}

function toSafeDto(
  candidate: RecommendationTeamRecord,
  match: RankedTeamMatch
): EligibleTeamRecommendation {
  return {
    rank: match.rank,
    teamId: candidate.team.id,
    teamName: candidate.team.name,
    pitch: candidate.team.pitch,
    goal: candidate.team.goal,
    commitmentHours: Number(candidate.team.commitment_hours),
    recruitmentStatus: 'Open',
    vacancyId: candidate.vacancy.id,
    vacancyRole: candidate.vacancy.role,
    desiredSkills: [...(candidate.vacancy.skills ?? [])],
    matchPercent: match.matchPercent,
    matchedSkills: match.matchedSkills,
    missingSkills: match.missingSkills,
    roleMatched: match.roleMatched,
    contributions: match.contributions,
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
      eligibilityReason: toPageReason(inputResult.reason),
      notice: RECOMMENDATION_SCORE_NOTICE,
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

  // Best match first (ties: more matched skills, team name, vacancy id), so the order is the same
  // every time for the same data.
  const ranked = rankTeamVacancies(inputResult.inputs, partitioned.eligible as RecommendationTeamRecord[]);
  const byVacancyId = new Map(
    (partitioned.eligible as RecommendationTeamRecord[]).map((candidate) => [candidate.vacancy.id, candidate])
  );
  const recommendations = ranked.map((match) => toSafeDto(byVacancyId.get(match.vacancyId)!, match));

  return {
    status: 'ok',
    recommendations,
    empty: recommendations.length === 0,
    message: recommendations.length === 0 ? EMPTY_MESSAGE : null,
    eligibilityReason: null,
    notice: RECOMMENDATION_SCORE_NOTICE,
  };
}

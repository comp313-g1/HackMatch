/**
 * Participant-facing team recommendations (US-016 / FR-043–045 / FR-047 / NR-016).
 *
 * Reverse of US-015: instead of ranking candidates against one owned slot, rank every
 * open vacancy on the platform against the signed-in participant's declared profile.
 *
 * Platform-wide by design: US-008–010 dropped the event catalogue and US-015 (#300/#302)
 * already removed event scoping, so no `event_id` filter exists or should be added here.
 *
 * Reuse only — nothing in the scoring / eligibility / privacy layer is rewritten:
 *   - teamsRepository.findOpenTeamRecords       → open team + open vacancy pool
 *   - services/openTeams.filterOpenTeams        → moderation, lifecycle and open-slot eligibility
 *   - compatibilityScoring.computeCompatibilityScore / sortWithCompatibilityRanks
 *   - scoreExplanation.buildPublicScoreExplanation / assertPublicExplanationSafe /
 *     omitInternalIdentifierFields   (FR-047: no internal ranking ids in the response)
 *
 * Pure read-time computation: no new tables, no migrations, no new error codes.
 *
 * Reverse mapping (FR-043–045 inputs, fixed here so the scorer stays untouched):
 *
 *   SlotScoringInput      ← team + open vacancy
 *     role            ← vacancy.role
 *     requiredSkills  ← vacancy.skills
 *     requestedHours  ← Number(team.commitment_hours)
 *     goal            ← team.goal
 *
 *   CandidateScoringInput ← the signed-in participant
 *     primaryRole     ← availability.desiredRole ?? profile.primary_role
 *     skills          ← participant_skills.skill_name
 *     commitmentHours ← availability.commitmentHours
 *     goal            ← availability.goal
 *     displayHandle   ← team.name              (display-side tie-break only)
 *     internalId      ← `${teamId}:${vacancyId}` (ranking only, never serialized)
 */

import type { ParticipantPrimaryRole, Team, TeamGoal, TeamVacancy } from '../db/types.js';
import { teamsRepository, type ITeamsRepository } from '../db/teams.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import {
  profileRepository,
  type IProfileRepository,
} from '../db/profile.repository.js';
import {
  availabilityRepository,
  type IAvailabilityRepository,
} from '../repositories/availability.repository.js';
import type { OpenTeamsQuery } from '../validators/openTeams.validator.js';
import {
  computeCompatibilityScore,
  type CandidateScoringInput,
  type CompatibilityScoreResult,
  type SlotScoringInput,
} from './compatibilityScoring.js';
import { SELF_DECLARED_RECOMMENDATION_NOTICE } from './recommendations.js';
import type { PublicScoreExplanation } from './scoreExplanation.js';

/** Maximum number of ranked teams returned to one participant (AC-1). */
export const RECOMMENDED_TEAMS_CAP = 10;

/** Empty-state copy shown to the participant when nothing matches. */
export const EMPTY_RECOMMENDED_TEAMS_MESSAGE =
  'No open teams match your profile yet. Teams appear here as soon as they post an open vacancy.';

/** NR-016-style fallback copy when scoring is unavailable. */
export const RECOMMENDED_TEAMS_DEGRADED_NOTICE =
  'Scores are temporarily unavailable. Showing open teams without ranking.';

/**
 * Eligibility query handed to the existing `filterOpenTeams` pure function.
 * Deliberately unset (`minSlots: 1` only): every open vacancy is a candidate, ranked later.
 */
export const RECOMMENDED_TEAMS_OPEN_QUERY: OpenTeamsQuery = {
  skills: [],
  role: null,
  goal: null,
  minSlots: 1,
};

/** One recommended team/vacancy pair as returned by the API (§4.2 DTO). */
export interface RecommendedTeam {
  teamId: string;
  teamName: string;
  vacancyId: string;
  role: ParticipantPrimaryRole;
  teamGoal: TeamGoal;
  commitmentHours: number;
  /** Required tags the participant covers (FR-044). */
  matchedSkills?: string[];
  /** True when the participant's primary/desired role equals the vacancy role (×1.2). */
  roleMatched?: boolean;
  /** 1-based position after scoring. Omitted when `status === 'degraded'`. */
  rank?: number;
  /** One decimal, e.g. "87.5". Omitted when degraded. */
  displayScore?: string;
  /** 0–100, bounded. Omitted when degraded. */
  score?: number;
  components?: { skill: number; goal: number; hours: number };
  /** FR-047 structured explanation (no internal ranking ids). */
  explanation?: PublicScoreExplanation;
}

export interface RecommendedTeamsResponse {
  status: 'ok' | 'degraded';
  teams: RecommendedTeam[];
  empty: boolean;
  message: string | null;
  notice: string;
  degradedNotice?: string;
}

/** Participant inputs used as the scoring candidate side. */
export interface ParticipantScoringProfile {
  primaryRole: ParticipantPrimaryRole | null;
  skills: string[];
  commitmentHours: number | null;
  goal: TeamGoal | null;
}

export interface RecommendedTeamsServiceDeps {
  participantsRepo: Pick<typeof participantsRepository, 'findById'>;
  profileRepo: Pick<
    IProfileRepository,
    'findProfileByParticipantId' | 'findSkillsByParticipantId'
  >;
  availabilityRepo: Pick<IAvailabilityRepository, 'findByParticipantId'>;
  teamsRepo: Pick<
    ITeamsRepository,
    'findOpenTeamRecords' | 'findConfirmedTeamIdsForParticipant'
  >;
  /** Optional clock for lifecycle checks (tests). */
  now?: () => Date;
  /** Injectable scorer for NR-016 degraded-path tests. */
  computeScore?: (
    slot: SlotScoringInput,
    candidate: CandidateScoringInput
  ) => CompatibilityScoreResult;
}

/** Lazy defaults so Vitest spies on repository exports still apply. */
function resolveDeps(
  deps?: Partial<RecommendedTeamsServiceDeps>
): Required<Omit<RecommendedTeamsServiceDeps, 'now'>> & Pick<RecommendedTeamsServiceDeps, 'now'> {
  return {
    participantsRepo: deps?.participantsRepo ?? participantsRepository,
    profileRepo: deps?.profileRepo ?? profileRepository,
    availabilityRepo: deps?.availabilityRepo ?? availabilityRepository,
    teamsRepo: deps?.teamsRepo ?? teamsRepository,
    now: deps?.now,
    computeScore: deps?.computeScore ?? computeCompatibilityScore,
  };
}

/** Exported for Step 2; keeps the lazy-default wiring in one place. */
export { resolveDeps as resolveRecommendedTeamsDeps };

/** Ranking-only identifier for the (team, vacancy) pair. Never serialized (FR-047). */
export function toRankingEntryId(teamId: string, vacancyId: string): string {
  return `${teamId}:${vacancyId}`;
}

/** Builds the slot side of the FR-043–045 scorer from a team and one of its open vacancies. */
export function toSlotScoringInput(
  team: Team,
  vacancy: Pick<TeamVacancy, 'role' | 'skills'>
): SlotScoringInput {
  return {
    role: vacancy.role,
    requiredSkills: vacancy.skills ?? [],
    requestedHours: Number(team.commitment_hours),
    goal: team.goal,
  };
}

/**
 * Builds the candidate side from the participant's declared profile.
 * `displayHandle` uses the team name: ties are broken on the response side, not on the
 * participant, because the participant never competes with themselves here.
 */
export function toCandidateScoringInput(
  profile: ParticipantScoringProfile,
  team: Team,
  vacancyId: string
): CandidateScoringInput {
  return {
    primaryRole: profile.primaryRole,
    skills: profile.skills,
    commitmentHours: profile.commitmentHours,
    goal: profile.goal,
    displayHandle: team.name,
    internalId: toRankingEntryId(team.id, vacancyId),
  };
}

/** Self-declared-data disclaimer reused verbatim from US-015. */
export const RECOMMENDED_TEAMS_NOTICE = SELF_DECLARED_RECOMMENDATION_NOTICE;

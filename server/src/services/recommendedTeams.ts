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
import {
  teamsRepository,
  type ITeamsRepository,
  type OpenTeamRecord,
} from '../db/teams.repository.js';
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
import { filterOpenTeams } from './openTeams.js';
import type { PublicScoreExplanation } from './scoreExplanation.js';
import { TeamServiceError } from './teamErrors.js';

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

interface RecommendationPair {
  record: OpenTeamRecord;
  vacancy: OpenTeamRecord['openVacancies'][number];
}

/**
 * Loads the signed-in participant's scoring candidate side.
 *
 * Missing profile / skills / availability rows are not errors: FR-043 scores a missing
 * input as 0 instead of inventing a value. A missing participant row is an error because
 * the auth guard already resolved one — reuses the existing 403 code rather than adding one.
 */
async function loadParticipantScoringProfile(
  actorId: string,
  deps: RecommendedTeamsServiceDeps
): Promise<ParticipantScoringProfile> {
  const participant = await deps.participantsRepo.findById(actorId);
  if (!participant) {
    throw new TeamServiceError('PARTICIPANT_NOT_ELIGIBLE', {
      reason: 'PARTICIPANT_NOT_FOUND',
    });
  }

  const [profile, skills, availability] = await Promise.all([
    deps.profileRepo.findProfileByParticipantId(actorId),
    deps.profileRepo.findSkillsByParticipantId(actorId),
    deps.availabilityRepo.findByParticipantId(actorId),
  ]);

  return {
    primaryRole: availability?.desiredRole ?? profile?.primary_role ?? null,
    skills: skills
      .map((skill) => skill.skill_name.trim())
      .filter((name) => name.length > 0),
    commitmentHours: availability?.commitmentHours ?? null,
    goal: availability?.goal ?? null,
  };
}

/**
 * Expands eligible open teams into (team, vacancy) pairs.
 *
 * Exclusions, in addition to everything `filterOpenTeams` already applies (moderation
 * hidden, non-mutable lifecycle, no open vacancy):
 *   - teams the actor already holds a Confirmed membership in
 *   - teams the actor owns
 */
function selectEligiblePairs(
  records: OpenTeamRecord[],
  excludedTeamIds: ReadonlySet<string>,
  actorId: string,
  now: Date
): RecommendationPair[] {
  const openTeams = filterOpenTeams(records, RECOMMENDED_TEAMS_OPEN_QUERY, now);
  const pairs: RecommendationPair[] = [];

  for (const record of openTeams) {
    if (record.team.owner_participant_id === actorId) continue;
    if (excludedTeamIds.has(record.team.id)) continue;
    for (const vacancy of record.openVacancies) {
      pairs.push({ record, vacancy });
    }
  }

  return pairs;
}

function toUnrankedTeam(pair: RecommendationPair): RecommendedTeam {
  return {
    teamId: pair.record.team.id,
    teamName: pair.record.team.name,
    vacancyId: pair.vacancy.id,
    role: pair.vacancy.role,
    teamGoal: pair.record.team.goal,
    commitmentHours: Number(pair.record.team.commitment_hours),
  };
}

/**
 * Recommends open team vacancies to the signed-in participant (AC-1 / AC-6).
 *
 * Platform-wide, zero-argument by design: the actor is the token subject, never a query
 * parameter, so a participant can only ever see their own ranking.
 */
export async function getRecommendedTeamsForParticipant(
  actorId: string,
  partialDeps?: Partial<RecommendedTeamsServiceDeps>
): Promise<RecommendedTeamsResponse> {
  const deps = resolveDeps(partialDeps);
  const now = deps.now ? deps.now() : new Date();

  // Fails fast for an authenticated-but-missing participant; the declared inputs are
  // consumed by the scoring projection.
  await loadParticipantScoringProfile(actorId, deps);

  const [records, confirmedTeamIds] = await Promise.all([
    deps.teamsRepo.findOpenTeamRecords({ withMemberIdentities: false }),
    deps.teamsRepo.findConfirmedTeamIdsForParticipant(actorId),
  ]);

  const pairs = selectEligiblePairs(
    records,
    new Set(confirmedTeamIds),
    actorId,
    now
  ).slice(0, RECOMMENDED_TEAMS_CAP);

  if (pairs.length === 0) {
    return {
      status: 'ok',
      teams: [],
      empty: true,
      message: EMPTY_RECOMMENDED_TEAMS_MESSAGE,
      notice: RECOMMENDED_TEAMS_NOTICE,
    };
  }

  return {
    status: 'ok',
    teams: pairs.map(toUnrankedTeam),
    empty: false,
    message: null,
    notice: RECOMMENDED_TEAMS_NOTICE,
  };
}

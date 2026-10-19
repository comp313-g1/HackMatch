/**
 * Owner + open-slot candidate recommendations (US-015).
 *
 * Authorization: only the team owner may request recommendations for an Open vacancy
 * on a recruiting team whose event is still Published and not past end_date.
 * Scoring uses FR-043–045; missing inputs score 0. Ranking ties use handle then id.
 * FR-046 exclusions: inactive, not Looking for Team, confirmed for event (revalidated).
 * Response contributions never expose internal ranking ids as display fields (FR-047).
 * NR-016: scoring failure falls back to an unranked eligible list with a notice.
 */

import type { ITeamsRepository } from '../db/teams.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { Participant, ParticipantPrimaryRole, Team, TeamVacancy } from '../db/types.js';
import {
  availabilityRepository,
  type IAvailabilityRepository,
  type PlatformAvailabilityRecord,
} from '../repositories/availability.repository.js';
import {
  listAvailableCandidates,
  type AvailableCandidateCard,
  type AvailabilityServiceDeps,
} from './availability.service.js';
import {
  compareCompatibilityResults,
  computeCompatibilityScore,
  type CandidateScoringInput,
  type CompatibilityScoreResult,
  type RankableCompatibilityResult,
  type SlotScoringInput,
} from './compatibilityScoring.js';
import {
  EXCLUSION_EMPTY_HINT,
  partitionRecommendationCandidates,
  type RecommendationExclusionSummary,
} from './recommendationEligibility.js';
import { TeamServiceError } from './teamErrors.js';

export {
  filterEligibleRecommendationCandidates,
  evaluateRecommendationEligibility,
  evaluateParticipantActivity,
  evaluateAvailabilityLooking,
  partitionRecommendationCandidates,
  EXCLUSION_EMPTY_HINT,
} from './recommendationEligibility.js';

export const SELF_DECLARED_RECOMMENDATION_NOTICE =
  'Scores use self-declared skills, role, goal, and hours. Compatibility is a recommendation aid, not a probability of team success.';

export const EMPTY_RECOMMENDATIONS_MESSAGE =
  `No eligible candidates found for this open slot. ${EXCLUSION_EMPTY_HINT}`;

export const SCORING_DEGRADED_NOTICE =
  'Scores are temporarily unavailable. Showing eligible candidates without ranking.';

export interface RecommendationSlotView {
  vacancyId: string;
  role: ParticipantPrimaryRole;
  requiredSkills: string[];
  requestedHours: number;
  goal: string;
}

export interface RankedRecommendationCandidate {
  participantId: string;
  displayName: string;
  handle: string | null;
  primaryRole: ParticipantPrimaryRole | null;
  desiredRole: string | null;
  skills: string[];
  commitmentHours: number | null;
  goal: string | null;
  /** Present when scoring succeeded. */
  displayScore?: string;
  score?: number;
  components?: { skill: number; goal: number; hours: number };
  matchedSkills?: string[];
  roleMatched?: boolean;
  contributions?: { skill: string; goal: string; hours: string };
}

export interface RecommendationsResult {
  status: 'ok' | 'degraded';
  teamId: string;
  vacancyId: string;
  slot: RecommendationSlotView;
  candidates: RankedRecommendationCandidate[];
  empty: boolean;
  message: string | null;
  notice: string;
  /** FR-046 exclusion tallies (user-visible outcome summary; no PII of excluded users). */
  exclusions: RecommendationExclusionSummary;
  /** Set when status === 'degraded' (NR-016). */
  degradedNotice?: string;
}

export interface RecommendationsServiceDeps {
  teamsRepo: Pick<
    ITeamsRepository,
    'getTeamViewParts' | 'listConfirmedParticipantIdsForEvent'
  >;
  listCandidates: (deps?: AvailabilityServiceDeps) => Promise<AvailableCandidateCard[]>;
  availabilityDeps?: AvailabilityServiceDeps;
  participantsRepo: Pick<typeof participantsRepository, 'findById'>;
  availabilityRepo: Pick<IAvailabilityRepository, 'findByParticipantId'>;
  /** When false, skip per-candidate revalidation (tests only). Default true. */
  revalidateEligibility?: boolean;
  /** Optional clock for tests (event end_date checks). */
  now?: () => Date;
  /** Injectable scorer for NR-016 degraded-path tests. */
  computeScore?: (
    slot: SlotScoringInput,
    candidate: CandidateScoringInput
  ) => CompatibilityScoreResult;
}

/** Lazy defaults so Vitest spies on repository/availability exports still apply. */
function resolveDeps(deps?: Partial<RecommendationsServiceDeps>): RecommendationsServiceDeps {
  return {
    teamsRepo: deps?.teamsRepo ?? teamsRepository,
    listCandidates: deps?.listCandidates ?? listAvailableCandidates,
    availabilityDeps: deps?.availabilityDeps,
    participantsRepo: deps?.participantsRepo ?? participantsRepository,
    availabilityRepo: deps?.availabilityRepo ?? availabilityRepository,
    revalidateEligibility: deps?.revalidateEligibility ?? true,
    now: deps?.now,
    computeScore: deps?.computeScore ?? computeCompatibilityScore,
  };
}

function assertOwnerMayRequest(
  actorParticipantId: string,
  team: Team,
  vacancy: TeamVacancy | undefined,
  event: { status?: string; end_date?: string },
  now: Date
): asserts vacancy is TeamVacancy {
  if (team.owner_participant_id !== actorParticipantId) {
    throw new TeamServiceError('RECOMMENDATIONS_FORBIDDEN');
  }

  if (team.recruitment_status !== 'Open') {
    throw new TeamServiceError('SLOT_NOT_OPEN_FOR_RECOMMENDATIONS', {
      reason: 'TEAM_NOT_RECRUITING',
      recruitmentStatus: team.recruitment_status,
    });
  }

  if (event.status && event.status !== 'Published') {
    throw new TeamServiceError('SLOT_NOT_OPEN_FOR_RECOMMENDATIONS', {
      reason: 'EVENT_NOT_RECRUITING',
      eventStatus: event.status,
    });
  }

  if (event.end_date) {
    const end = new Date(event.end_date);
    if (!Number.isNaN(end.getTime()) && end.getTime() < now.getTime()) {
      throw new TeamServiceError('SLOT_NOT_OPEN_FOR_RECOMMENDATIONS', {
        reason: 'EVENT_ENDED',
        endDate: event.end_date,
      });
    }
  }

  if (!vacancy) {
    throw new TeamServiceError('VACANCY_NOT_FOUND');
  }

  if (vacancy.status !== 'Open') {
    throw new TeamServiceError('SLOT_NOT_OPEN_FOR_RECOMMENDATIONS', {
      reason: 'VACANCY_NOT_OPEN',
      vacancyStatus: vacancy.status,
    });
  }
}

function toSlotInput(team: Team, vacancy: TeamVacancy): SlotScoringInput {
  return {
    role: vacancy.role,
    requiredSkills: vacancy.skills ?? [],
    requestedHours: Number(team.commitment_hours),
    goal: team.goal,
  };
}

function toUnrankedCard(c: AvailableCandidateCard): RankedRecommendationCandidate {
  return {
    participantId: c.participantId,
    displayName: c.displayName,
    handle: c.handle,
    primaryRole: c.primaryRole,
    desiredRole: c.desiredRole,
    skills: c.skills,
    commitmentHours: c.commitmentHours,
    goal: c.goal,
  };
}

function toRankedCard(
  c: AvailableCandidateCard,
  scored: RankableCompatibilityResult
): RankedRecommendationCandidate {
  return {
    ...toUnrankedCard(c),
    displayScore: scored.displayScore,
    score: scored.score,
    components: scored.components,
    matchedSkills: scored.matchedSkills,
    roleMatched: scored.roleMatched,
    contributions: scored.contributions,
  };
}

async function buildRevalidationExtras(
  pool: AvailableCandidateCard[],
  deps: RecommendationsServiceDeps
): Promise<
  Map<
    string,
    {
      participant: Participant | null;
      availability: PlatformAvailabilityRecord | null;
    }
  >
> {
  const map = new Map<
    string,
    {
      participant: Participant | null;
      availability: PlatformAvailabilityRecord | null;
    }
  >();

  await Promise.all(
    pool.map(async (card) => {
      const [participant, availability] = await Promise.all([
        deps.participantsRepo.findById(card.participantId),
        deps.availabilityRepo.findByParticipantId(card.participantId),
      ]);
      map.set(card.participantId, { participant, availability });
    })
  );

  return map;
}

/**
 * Loads an open slot for the owner and returns ranked compatible candidates.
 * Applies FR-046 exclusions with optional per-candidate revalidation.
 */
export async function getRecommendationsForOpenSlot(
  actorParticipantId: string,
  teamId: string,
  vacancyId: string,
  partialDeps?: Partial<RecommendationsServiceDeps>
): Promise<RecommendationsResult> {
  const deps = resolveDeps(partialDeps);
  const now = deps.now ? deps.now() : new Date();
  const parts = await deps.teamsRepo.getTeamViewParts(teamId);
  const vacancy = parts.vacancies.find((v) => v.id === vacancyId);

  assertOwnerMayRequest(actorParticipantId, parts.team, vacancy, parts.event, now);

  const slotView: RecommendationSlotView = {
    vacancyId: vacancy.id,
    role: vacancy.role,
    requiredSkills: vacancy.skills ?? [],
    requestedHours: Number(parts.team.commitment_hours),
    goal: parts.team.goal,
  };

  const confirmedIds = new Set(
    await deps.teamsRepo.listConfirmedParticipantIdsForEvent(parts.team.event_id)
  );

  const pool = await deps.listCandidates(deps.availabilityDeps);

  const extras =
    deps.revalidateEligibility && pool.length > 0
      ? await buildRevalidationExtras(pool, deps)
      : undefined;

  const partitioned = partitionRecommendationCandidates(
    pool,
    {
      eventId: parts.team.event_id,
      ownerParticipantId: parts.team.owner_participant_id,
      confirmedParticipantIds: confirmedIds,
    },
    extras
  );

  const eligible = partitioned.eligible;
  const exclusions = partitioned.summary;

  if (eligible.length === 0) {
    return {
      status: 'ok',
      teamId,
      vacancyId,
      slot: slotView,
      candidates: [],
      empty: true,
      message: EMPTY_RECOMMENDATIONS_MESSAGE,
      notice: SELF_DECLARED_RECOMMENDATION_NOTICE,
      exclusions,
    };
  }

  const slotInput = toSlotInput(parts.team, vacancy);
  const scoreFn = deps.computeScore ?? computeCompatibilityScore;

  try {
    const scoredEntries: Array<{ card: AvailableCandidateCard; ranked: RankableCompatibilityResult }> =
      eligible.map((card) => {
        const scored = scoreFn(slotInput, {
          primaryRole: card.primaryRole ?? card.desiredRole,
          skills: card.skills,
          commitmentHours: card.commitmentHours,
          goal: card.goal,
          displayHandle: card.handle ?? card.displayName,
          internalId: card.participantId,
        });
        return {
          card,
          ranked: {
            ...scored,
            displayHandle: (card.handle ?? card.displayName ?? '').trim(),
            internalId: card.participantId,
          },
        };
      });

    scoredEntries.sort((a, b) => compareCompatibilityResults(a.ranked, b.ranked));

    return {
      status: 'ok',
      teamId,
      vacancyId,
      slot: slotView,
      candidates: scoredEntries.map(({ card, ranked }) => toRankedCard(card, ranked)),
      empty: false,
      message: null,
      notice: SELF_DECLARED_RECOMMENDATION_NOTICE,
      exclusions,
    };
  } catch {
    return {
      status: 'degraded',
      teamId,
      vacancyId,
      slot: slotView,
      candidates: eligible.map(toUnrankedCard),
      empty: false,
      message: null,
      notice: SELF_DECLARED_RECOMMENDATION_NOTICE,
      exclusions,
      degradedNotice: SCORING_DEGRADED_NOTICE,
    };
  }
}

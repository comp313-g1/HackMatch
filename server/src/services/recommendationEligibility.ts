/**
 * FR-046 / US-015: exclude inactive, unavailable, and confirmed event participants
 * from candidate recommendation rankings.
 *
 * Eligible: active verified PART, Looking for Team, not confirmed for the team event,
 * and not the requesting owner. Confirmed members of any team in the event are excluded
 * (including unlocked/non-full teams).
 */

import type { Participant } from '../db/types.js';
import type { PlatformAvailabilityRecord } from '../repositories/availability.repository.js';
import type { AvailableCandidateCard } from './availability.service.js';

export type RecommendationExclusionReason =
  | 'inactive_missing_account'
  | 'inactive_not_part'
  | 'inactive_unverified'
  | 'inactive_suspended'
  | 'unavailable_not_looking'
  | 'confirmed_on_team'
  | 'confirmed_for_event'
  | 'is_team_owner';

export interface RecommendationEligibilityContext {
  teamId?: string;
  /** @deprecated Legacy shadow event identifier; optional for backward compatibility. */
  eventId?: string;
  ownerParticipantId: string;
  confirmedParticipantIds: ReadonlySet<string>;
}

export interface RecommendationEligibilityDecision {
  eligible: boolean;
  reason: RecommendationExclusionReason | null;
}

export interface RecommendationExclusionSummary {
  inactive: number;
  unavailable: number;
  confirmed: number;
  owner: number;
  totalExcluded: number;
}

export interface PartitionedRecommendationCandidates {
  eligible: AvailableCandidateCard[];
  excluded: Array<{
    participantId: string;
    reason: RecommendationExclusionReason;
  }>;
  summary: RecommendationExclusionSummary;
}

export const EXCLUSION_EMPTY_HINT =
  'Inactive accounts, participants not Looking for Team, and anyone already confirmed on this team are excluded.';

/** Active account gate used by FR-046 ("inactive accounts"). */
export function evaluateParticipantActivity(
  participant: Participant | null | undefined
): RecommendationEligibilityDecision {
  if (!participant) {
    return { eligible: false, reason: 'inactive_missing_account' };
  }
  if (participant.role !== 'PART') {
    return { eligible: false, reason: 'inactive_not_part' };
  }
  if (!participant.is_verified) {
    return { eligible: false, reason: 'inactive_unverified' };
  }
  if (participant.is_suspended) {
    return { eligible: false, reason: 'inactive_suspended' };
  }
  return { eligible: true, reason: null };
}

/** Looking-for-Team gate ("unavailable"). */
export function evaluateAvailabilityLooking(
  availability: Pick<PlatformAvailabilityRecord, 'isLooking'> | null | undefined
): RecommendationEligibilityDecision {
  if (!availability || !availability.isLooking) {
    return { eligible: false, reason: 'unavailable_not_looking' };
  }
  return { eligible: true, reason: null };
}

/**
 * Full FR-046 decision for one candidate against an owner + open-slot request context.
 * `availability` / `participant` may be omitted when the caller already trusts the pool
 * and only needs confirmed/owner checks; prefer passing them for revalidation.
 */
export function evaluateRecommendationEligibility(
  candidate: { participantId: string },
  context: RecommendationEligibilityContext,
  extras?: {
    participant?: Participant | null;
    availability?: Pick<PlatformAvailabilityRecord, 'isLooking'> | null;
  }
): RecommendationEligibilityDecision {
  if (candidate.participantId === context.ownerParticipantId) {
    return { eligible: false, reason: 'is_team_owner' };
  }

  if (context.confirmedParticipantIds.has(candidate.participantId)) {
    return { eligible: false, reason: 'confirmed_on_team' };
  }

  if (extras && 'participant' in (extras ?? {})) {
    const activity = evaluateParticipantActivity(extras.participant);
    if (!activity.eligible) return activity;
  }

  if (extras && 'availability' in (extras ?? {})) {
    const looking = evaluateAvailabilityLooking(extras.availability);
    if (!looking.eligible) return looking;
  }

  return { eligible: true, reason: null };
}

function emptySummary(): RecommendationExclusionSummary {
  return { inactive: 0, unavailable: 0, confirmed: 0, owner: 0, totalExcluded: 0 };
}

function bumpSummary(
  summary: RecommendationExclusionSummary,
  reason: RecommendationExclusionReason
): void {
  summary.totalExcluded += 1;
  switch (reason) {
    case 'inactive_missing_account':
    case 'inactive_not_part':
    case 'inactive_unverified':
    case 'inactive_suspended':
      summary.inactive += 1;
      break;
    case 'unavailable_not_looking':
      summary.unavailable += 1;
      break;
    case 'confirmed_on_team':
    case 'confirmed_for_event':
      summary.confirmed += 1;
      break;
    case 'is_team_owner':
      summary.owner += 1;
      break;
  }
}

/**
 * Partitions a candidate pool into eligible vs excluded with FR-046 reason tallies.
 * Does not invent candidates; only filters the provided pool.
 */
export function partitionRecommendationCandidates(
  candidates: readonly AvailableCandidateCard[],
  context: RecommendationEligibilityContext,
  extrasByParticipantId?: ReadonlyMap<
    string,
    {
      participant?: Participant | null;
      availability?: Pick<PlatformAvailabilityRecord, 'isLooking'> | null;
    }
  >
): PartitionedRecommendationCandidates {
  const eligible: AvailableCandidateCard[] = [];
  const excluded: PartitionedRecommendationCandidates['excluded'] = [];
  const summary = emptySummary();

  for (const candidate of candidates) {
    const extras = extrasByParticipantId?.get(candidate.participantId);
    const decision = evaluateRecommendationEligibility(candidate, context, extras);
    if (decision.eligible) {
      eligible.push(candidate);
    } else if (decision.reason) {
      excluded.push({ participantId: candidate.participantId, reason: decision.reason });
      bumpSummary(summary, decision.reason);
    }
  }

  return { eligible, excluded, summary };
}

/** Fast path used when the pool is already Looking-for-Team + active (availability list). */
export function filterEligibleRecommendationCandidates(
  candidates: AvailableCandidateCard[],
  context: RecommendationEligibilityContext
): AvailableCandidateCard[] {
  return partitionRecommendationCandidates(candidates, context).eligible;
}

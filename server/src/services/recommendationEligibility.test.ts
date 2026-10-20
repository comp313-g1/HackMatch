import { describe, it, expect } from 'vitest';
import {
  evaluateAvailabilityLooking,
  evaluateParticipantActivity,
  evaluateRecommendationEligibility,
  partitionRecommendationCandidates,
  EXCLUSION_EMPTY_HINT,
} from './recommendationEligibility.js';
import type { AvailableCandidateCard } from './availability.service.js';
import type { Participant } from '../db/types.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const lookingId = '22222222-2222-4222-8222-222222222222';
const confirmedId = '33333333-3333-4333-8333-333333333333';
const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function card(id: string): AvailableCandidateCard {
  return {
    participantId: id,
    displayName: 'Cand',
    handle: 'cand',
    institution: null,
    primaryRole: 'Frontend',
    desiredRole: 'Frontend',
    commitmentHours: 10,
    goal: 'Learning',
    skills: ['React'],
    portfolioLinks: [],
    updatedAt: null,
  };
}

function part(overrides: Partial<Participant> = {}): Participant {
  return {
    id: lookingId,
    firebase_uid: 'fb',
    email: 'a@b.com',
    full_name: 'A',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('evaluateParticipantActivity (inactive exclusion)', () => {
  it('rejects missing, non-PART, unverified, and suspended accounts', () => {
    expect(evaluateParticipantActivity(null).reason).toBe('inactive_missing_account');
    expect(evaluateParticipantActivity(part({ role: 'ADMIN' })).reason).toBe('inactive_not_part');
    expect(evaluateParticipantActivity(part({ is_verified: false })).reason).toBe(
      'inactive_unverified'
    );
    expect(evaluateParticipantActivity(part({ is_suspended: true })).reason).toBe(
      'inactive_suspended'
    );
    expect(evaluateParticipantActivity(part()).eligible).toBe(true);
  });
});

describe('evaluateAvailabilityLooking (unavailable exclusion)', () => {
  it('rejects missing or not-looking availability', () => {
    expect(evaluateAvailabilityLooking(null).reason).toBe('unavailable_not_looking');
    expect(evaluateAvailabilityLooking({ isLooking: false }).reason).toBe(
      'unavailable_not_looking'
    );
    expect(evaluateAvailabilityLooking({ isLooking: true }).eligible).toBe(true);
  });
});

describe('evaluateRecommendationEligibility / partition (FR-046)', () => {
  const context = {
    eventId,
    ownerParticipantId: ownerId,
    confirmedParticipantIds: new Set([confirmedId]),
  };

  it('excludes owner and confirmed members', () => {
    expect(
      evaluateRecommendationEligibility({ participantId: ownerId }, context).reason
    ).toBe('is_team_owner');
    expect(
      evaluateRecommendationEligibility({ participantId: confirmedId }, context).reason
    ).toBe('confirmed_on_team');
  });

  it('revalidates inactive and unavailable when extras are provided', () => {
    expect(
      evaluateRecommendationEligibility(
        { participantId: lookingId },
        context,
        { participant: part({ is_suspended: true }), availability: { isLooking: true } }
      ).reason
    ).toBe('inactive_suspended');

    expect(
      evaluateRecommendationEligibility(
        { participantId: lookingId },
        context,
        { participant: part(), availability: { isLooking: false } }
      ).reason
    ).toBe('unavailable_not_looking');
  });

  it('partitions pool with exclusion summary counts', () => {
    const pool = [card(ownerId), card(confirmedId), card(lookingId)];
    const extras = new Map([
      [
        lookingId,
        { participant: part({ id: lookingId }), availability: { isLooking: true } },
      ],
      [
        ownerId,
        {
          participant: part({ id: ownerId }),
          availability: { isLooking: true },
        },
      ],
      [
        confirmedId,
        {
          participant: part({ id: confirmedId }),
          availability: { isLooking: true },
        },
      ],
    ]);

    const result = partitionRecommendationCandidates(pool, context, extras);

    expect(result.eligible.map((c) => c.participantId)).toEqual([lookingId]);
    expect(result.summary.owner).toBe(1);
    expect(result.summary.confirmed).toBe(1);
    expect(result.summary.totalExcluded).toBe(2);
    expect(EXCLUSION_EMPTY_HINT).toMatch(/Looking for Team/);
  });
});

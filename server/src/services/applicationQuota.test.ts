import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  assertApplicationQuotas,
  evaluatePendingApplicationsPerEventQuota,
} from './applicationQuota.js';
import { MAX_PENDING_APPLICATIONS_PER_EVENT } from '../db/applicationModel.js';
import {
  otherParticipant,
  sampleEventId,
  sampleTeam,
  sampleTeamId,
} from '../routes/team.testUtils.js';

describe('applicationQuota pure guards (US-018 / #174 / FR-054)', () => {
  it('allows pending counts below the limit of 3', () => {
    expect(evaluatePendingApplicationsPerEventQuota(0).ok).toBe(true);
    expect(evaluatePendingApplicationsPerEventQuota(2).ok).toBe(true);
    expect(evaluatePendingApplicationsPerEventQuota(2).limit).toBe(
      MAX_PENDING_APPLICATIONS_PER_EVENT
    );
  });

  it('rejects when pending count is already at or above 3', () => {
    expect(evaluatePendingApplicationsPerEventQuota(3).code).toBe('APPLICATION_PENDING_LIMIT');
    expect(evaluatePendingApplicationsPerEventQuota(4).code).toBe('APPLICATION_PENDING_LIMIT');
    expect(evaluatePendingApplicationsPerEventQuota(3).pendingCount).toBe(3);
  });
});

describe('assertApplicationQuotas (US-018 / #174)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('passes when applicant has fewer than 3 Pending apps for the event', async () => {
    await expect(
      assertApplicationQuotas(
        { actorParticipantId: otherParticipant.id, teamId: sampleTeamId },
        {
          teamsRepo: {
            findTeamById: vi.fn().mockResolvedValue(sampleTeam),
            countPendingApplicationsForEvent: vi.fn().mockResolvedValue(2),
          },
        }
      )
    ).resolves.toBeUndefined();
  });

  it('throws APPLICATION_PENDING_LIMIT at the 3-pending boundary (US-018-T4)', async () => {
    const countSpy = vi.fn().mockResolvedValue(3);

    await expect(
      assertApplicationQuotas(
        { actorParticipantId: otherParticipant.id, teamId: sampleTeamId },
        {
          teamsRepo: {
            findTeamById: vi.fn().mockResolvedValue(sampleTeam),
            countPendingApplicationsForEvent: countSpy,
          },
        }
      )
    ).rejects.toMatchObject({
      code: 'APPLICATION_PENDING_LIMIT',
      status: 409,
      details: expect.objectContaining({
        limit: 3,
        pendingCount: 3,
        eventId: sampleEventId,
      }),
    });

    expect(countSpy).toHaveBeenCalledWith(otherParticipant.id, sampleEventId);
  });

  it('throws TEAM_NOT_FOUND when the team cannot be resolved for quota', async () => {
    await expect(
      assertApplicationQuotas(
        { actorParticipantId: otherParticipant.id, teamId: sampleTeamId },
        {
          teamsRepo: {
            findTeamById: vi.fn().mockResolvedValue(null),
            countPendingApplicationsForEvent: vi.fn(),
          },
        }
      )
    ).rejects.toMatchObject({ code: 'TEAM_NOT_FOUND', status: 404 });
  });
});

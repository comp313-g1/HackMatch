import { describe, it, expect, vi } from 'vitest';
import {
  EMPTY_RECOMMENDATIONS_MESSAGE,
  SCORING_DEGRADED_NOTICE,
  filterEligibleRecommendationCandidates,
  getRecommendationsForOpenSlot,
} from './recommendations.js';
import { TeamServiceError } from './teamErrors.js';
import type { AvailableCandidateCard } from './availability.service.js';
import type { Participant, Team, TeamVacancy } from '../db/types.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const confirmedId = '33333333-3333-4333-8333-333333333333';
const teamId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const vacancyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function baseTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: teamId,
    event_id: eventId,
    owner_participant_id: ownerId,
    name: 'Test Team',
    pitch: 'Pitch',
    goal: 'Project Completion',
    commitment_hours: 20,
    communication_link: null,
    recruitment_status: 'Open',
    disbanded_at: null,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
    ...overrides,
  };
}

function openVacancy(overrides: Partial<TeamVacancy> = {}): TeamVacancy {
  return {
    id: vacancyId,
    team_id: teamId,
    role: 'Frontend',
    skills: ['React', 'TypeScript', 'CSS', 'Testing'],
    status: 'Open',
    removed_at: null,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
    ...overrides,
  };
}

function candidate(
  id: string,
  partial: Partial<AvailableCandidateCard> = {}
): AvailableCandidateCard {
  return {
    participantId: id,
    displayName: `User ${id.slice(0, 4)}`,
    handle: `handle-${id.slice(0, 4)}`,
    institution: null,
    primaryRole: 'Frontend',
    desiredRole: 'Frontend',
    commitmentHours: 10,
    goal: 'Project Completion',
    skills: ['React', 'TypeScript'],
    portfolioLinks: [],
    updatedAt: '2026-10-18T00:00:00.000Z',
    ...partial,
  };
}

function activePart(id: string): Participant {
  return {
    id,
    firebase_uid: `fb-${id.slice(0, 8)}`,
    email: `${id.slice(0, 8)}@example.com`,
    full_name: 'Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };
}

/** Shared deps that skip live revalidation unless a test opts in. */
function baseRecDeps(
  teamsRepo: {
    getTeamViewParts: ReturnType<typeof vi.fn>;
    listConfirmedParticipantIdsForTeam?: ReturnType<typeof vi.fn>;
    listConfirmedParticipantIdsForEvent?: ReturnType<typeof vi.fn>;
  },
  listCandidates: () => Promise<AvailableCandidateCard[]>,
  extra: Partial<Parameters<typeof getRecommendationsForOpenSlot>[3]> = {}
) {
  const defaultConfirmedTeam = teamsRepo.listConfirmedParticipantIdsForTeam
    ? teamsRepo.listConfirmedParticipantIdsForTeam
    : teamsRepo.listConfirmedParticipantIdsForEvent
      ? teamsRepo.listConfirmedParticipantIdsForEvent
      : vi.fn().mockResolvedValue([ownerId]);

  return {
    teamsRepo: {
      listConfirmedParticipantIdsForTeam: defaultConfirmedTeam,
      ...teamsRepo,
    },
    listCandidates,
    revalidateEligibility: false as const,
    participantsRepo: { findById: vi.fn() },
    availabilityRepo: { findByParticipantId: vi.fn() },
    ...extra,
  };
}

describe('filterEligibleRecommendationCandidates', () => {
  it('excludes the owner and confirmed team members', () => {
    const pool = [
      candidate(ownerId),
      candidate(confirmedId),
      candidate(otherId),
    ];
    const filtered = filterEligibleRecommendationCandidates(pool, {
      teamId,
      ownerParticipantId: ownerId,
      confirmedParticipantIds: new Set([confirmedId]),
    });
    expect(filtered.map((c) => c.participantId)).toEqual([otherId]);
  });
});

describe('getRecommendationsForOpenSlot', () => {
  it('returns ranked candidates with FR example displayScore 70.0 for the owner', async () => {
    const teamsRepo = {
      getTeamViewParts: vi.fn().mockResolvedValue({
        team: baseTeam(),
        event: {
          max_team_size: 4,
          status: 'Published',
          end_date: '2099-01-01T00:00:00.000Z',
        },
        members: [],
        vacancies: [openVacancy()],
      }),
      listConfirmedParticipantIdsForEvent: vi.fn().mockResolvedValue([ownerId]),
    };

    const result = await getRecommendationsForOpenSlot(
      ownerId,
      teamId,
      vacancyId,
      baseRecDeps(teamsRepo, async () => [candidate(otherId)])
    );

    expect(result.status).toBe('ok');
    expect(result.empty).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].displayScore).toBe('70.0');
    expect(result.candidates[0].score).toBeGreaterThanOrEqual(0);
    expect(result.candidates[0].score).toBeLessThanOrEqual(100);
    expect(result.candidates[0].rank).toBe(1);
    expect(result.candidates[0].contributions?.skill).toMatch(/Matched 2 of 4/);
    expect(result.candidates[0].explanation?.items).toHaveLength(3);
    expect(result.candidates[0].explanation?.items.map((i) => i.label)).toEqual([
      'Skills',
      'Goal',
      'Hours',
    ]);
    expect(result.candidates[0].participantId).toBe(otherId);
    expect(JSON.stringify(result.candidates[0])).not.toMatch(/internalId/i);
    expect(result.notice).toMatch(/self-declared/);
    expect(result.slot.role).toBe('Frontend');
    expect(result.exclusions.totalExcluded).toBe(0);
  });

  it('returns empty state when no eligible candidates remain', async () => {
    const teamsRepo = {
      getTeamViewParts: vi.fn().mockResolvedValue({
        team: baseTeam(),
        event: { max_team_size: 4, status: 'Published', end_date: '2099-01-01T00:00:00.000Z' },
        members: [],
        vacancies: [openVacancy()],
      }),
      listConfirmedParticipantIdsForEvent: vi.fn().mockResolvedValue([ownerId, otherId]),
    };

    const result = await getRecommendationsForOpenSlot(
      ownerId,
      teamId,
      vacancyId,
      baseRecDeps(teamsRepo, async () => [candidate(otherId)])
    );

    expect(result.empty).toBe(true);
    expect(result.candidates).toEqual([]);
    expect(result.message).toBe(EMPTY_RECOMMENDATIONS_MESSAGE);
    expect(result.exclusions.confirmed).toBe(1);
  });

  it('revalidates and drops suspended or not-looking candidates (FR-046)', async () => {
    const teamsRepo = {
      getTeamViewParts: vi.fn().mockResolvedValue({
        team: baseTeam(),
        event: { max_team_size: 4, status: 'Published', end_date: '2099-01-01T00:00:00.000Z' },
        members: [],
        vacancies: [openVacancy()],
      }),
      listConfirmedParticipantIdsForEvent: vi.fn().mockResolvedValue([ownerId]),
    };

    const suspendedId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const notLookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';

    const result = await getRecommendationsForOpenSlot(ownerId, teamId, vacancyId, {
      teamsRepo,
      listCandidates: async () => [
        candidate(otherId),
        candidate(suspendedId),
        candidate(notLookingId),
      ],
      revalidateEligibility: true,
      participantsRepo: {
        findById: vi.fn(async (id: string) => {
          if (id === suspendedId) return { ...activePart(id), is_suspended: true };
          return activePart(id);
        }),
      },
      availabilityRepo: {
        findByParticipantId: vi.fn(async (id: string) => ({
          participantId: id,
          isLooking: id !== notLookingId,
          desiredRole: 'Frontend' as const,
          commitmentHours: 10,
          goal: 'Project Completion' as const,
          updatedAt: null,
        })),
      },
    });

    expect(result.candidates.map((c) => c.participantId)).toEqual([otherId]);
    expect(result.exclusions.inactive).toBe(1);
    expect(result.exclusions.unavailable).toBe(1);
    expect(result.exclusions.totalExcluded).toBe(2);
  });

  it('denies non-owners at the service layer', async () => {
    const teamsRepo = {
      getTeamViewParts: vi.fn().mockResolvedValue({
        team: baseTeam(),
        event: { max_team_size: 4, status: 'Published', end_date: '2099-01-01T00:00:00.000Z' },
        members: [],
        vacancies: [openVacancy()],
      }),
      listConfirmedParticipantIdsForEvent: vi.fn(),
    };

    await expect(
      getRecommendationsForOpenSlot(
        otherId,
        teamId,
        vacancyId,
        baseRecDeps(teamsRepo, async () => [])
      )
    ).rejects.toMatchObject({ code: 'RECOMMENDATIONS_FORBIDDEN' } satisfies Partial<TeamServiceError>);
  });

  it('rejects when vacancy is missing', async () => {
    const teamsRepo = {
      getTeamViewParts: vi.fn().mockResolvedValue({
        team: baseTeam(),
        event: { max_team_size: 4, status: 'Published', end_date: '2099-01-01T00:00:00.000Z' },
        members: [],
        vacancies: [],
      }),
      listConfirmedParticipantIdsForEvent: vi.fn(),
    };

    await expect(
      getRecommendationsForOpenSlot(
        ownerId,
        teamId,
        vacancyId,
        baseRecDeps(teamsRepo, async () => [])
      )
    ).rejects.toMatchObject({ code: 'VACANCY_NOT_FOUND' });
  });

  it('rejects when vacancy is not Open', async () => {
    const teamsRepo = {
      getTeamViewParts: vi.fn().mockResolvedValue({
        team: baseTeam(),
        event: { max_team_size: 4, status: 'Published', end_date: '2099-01-01T00:00:00.000Z' },
        members: [],
        vacancies: [openVacancy({ status: 'Filled' })],
      }),
      listConfirmedParticipantIdsForEvent: vi.fn(),
    };

    await expect(
      getRecommendationsForOpenSlot(
        ownerId,
        teamId,
        vacancyId,
        baseRecDeps(teamsRepo, async () => [])
      )
    ).rejects.toMatchObject({ code: 'SLOT_NOT_OPEN_FOR_RECOMMENDATIONS' });
  });

  it('rejects when team recruitment is Locked', async () => {
    const teamsRepo = {
      getTeamViewParts: vi.fn().mockResolvedValue({
        team: baseTeam({ recruitment_status: 'Locked' }),
        event: { max_team_size: 4, status: 'Published', end_date: '2099-01-01T00:00:00.000Z' },
        members: [],
        vacancies: [openVacancy()],
      }),
      listConfirmedParticipantIdsForEvent: vi.fn(),
    };

    await expect(
      getRecommendationsForOpenSlot(
        ownerId,
        teamId,
        vacancyId,
        baseRecDeps(teamsRepo, async () => [])
      )
    ).rejects.toMatchObject({ code: 'SLOT_NOT_OPEN_FOR_RECOMMENDATIONS' });
  });

  it('falls back to unranked eligible list when scoring throws (NR-016)', async () => {
    const teamsRepo = {
      getTeamViewParts: vi.fn().mockResolvedValue({
        team: baseTeam(),
        event: { max_team_size: 4, status: 'Published', end_date: '2099-01-01T00:00:00.000Z' },
        members: [],
        vacancies: [openVacancy()],
      }),
      listConfirmedParticipantIdsForEvent: vi.fn().mockResolvedValue([ownerId]),
    };

    const result = await getRecommendationsForOpenSlot(
      ownerId,
      teamId,
      vacancyId,
      baseRecDeps(teamsRepo, async () => [candidate(otherId)], {
        computeScore: () => {
          throw new Error('scoring exploded');
        },
      })
    );

    expect(result.status).toBe('degraded');
    expect(result.degradedNotice).toBe(SCORING_DEGRADED_NOTICE);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].displayScore).toBeUndefined();
    expect(result.candidates[0].participantId).toBe(otherId);
  });

  it('ranks by unrounded score then display handle', async () => {
    const teamsRepo = {
      getTeamViewParts: vi.fn().mockResolvedValue({
        team: baseTeam({ commitment_hours: 0, goal: 'Learning' }),
        event: { max_team_size: 4, status: 'Published', end_date: '2099-01-01T00:00:00.000Z' },
        members: [],
        vacancies: [openVacancy({ skills: [], role: 'Backend' })],
      }),
      listConfirmedParticipantIdsForEvent: vi.fn().mockResolvedValue([ownerId]),
    };

    const zoe = candidate('dddddddd-dddd-4ddd-8ddd-dddddddddddd', {
      handle: 'zoe',
      primaryRole: 'Backend',
      desiredRole: 'Backend',
      skills: [],
      commitmentHours: 0,
      goal: 'Learning',
    });
    const amy = candidate('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', {
      handle: 'amy',
      primaryRole: 'Backend',
      desiredRole: 'Backend',
      skills: [],
      commitmentHours: 0,
      goal: 'Learning',
    });

    const result = await getRecommendationsForOpenSlot(
      ownerId,
      teamId,
      vacancyId,
      baseRecDeps(teamsRepo, async () => [zoe, amy])
    );

    expect(result.candidates.map((c) => c.handle)).toEqual(['amy', 'zoe']);
    expect(result.candidates.map((c) => c.rank)).toEqual([1, 2]);
    expect(result.candidates.every((c) => c.score === 100)).toBe(true);
  });

  it('recommends candidates with Looking for Team enabled regardless of shadow event_id and allows members of other teams who re-enabled LFT while excluding confirmed members of the requesting team', async () => {
    const otherTeamMemberId = '77777777-7777-4777-8777-777777777777';
    const thisTeamConfirmedId = confirmedId;

    const teamsRepo = {
      getTeamViewParts: vi.fn().mockResolvedValue({
        team: baseTeam(),
        event: { max_team_size: 4, status: 'Published', end_date: '2099-01-01T00:00:00.000Z' },
        members: [{ participant_id: ownerId }, { participant_id: thisTeamConfirmedId }],
        vacancies: [openVacancy()],
      }),
      listConfirmedParticipantIdsForTeam: vi.fn().mockResolvedValue([ownerId, thisTeamConfirmedId]),
    };

    const eligibleMultiTeamCandidate = candidate(otherTeamMemberId, {
      handle: 'multiteam_dev',
      displayName: 'Multi Team Dev',
    });
    const excludedCandidate = candidate(thisTeamConfirmedId);

    const result = await getRecommendationsForOpenSlot(
      ownerId,
      teamId,
      vacancyId,
      baseRecDeps(teamsRepo, async () => [eligibleMultiTeamCandidate, excludedCandidate])
    );

    expect(result.status).toBe('ok');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].participantId).toBe(otherTeamMemberId);
    expect(result.exclusions.confirmed).toBe(1);
  });

  it('does not block recommendations based on shadow event status or end_date when team and slot are Open', async () => {
    const teamsRepo = {
      getTeamViewParts: vi.fn().mockResolvedValue({
        team: baseTeam(),
        event: {
          max_team_size: 4,
          status: 'Archived', // Shadow event is archived
          end_date: '2020-01-01T00:00:00.000Z', // Shadow event ended years ago
        },
        members: [],
        vacancies: [openVacancy()],
      }),
      listConfirmedParticipantIdsForTeam: vi.fn().mockResolvedValue([ownerId]),
    };

    const result = await getRecommendationsForOpenSlot(
      ownerId,
      teamId,
      vacancyId,
      baseRecDeps(teamsRepo, async () => [candidate(otherId)])
    );

    expect(result.status).toBe('ok');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].participantId).toBe(otherId);
  });
});

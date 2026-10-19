import { describe, it, expect, vi } from 'vitest';
import {
  EMPTY_RECOMMENDATIONS_MESSAGE,
  SCORING_DEGRADED_NOTICE,
  filterEligibleRecommendationCandidates,
  getRecommendationsForOpenSlot,
} from './recommendations.js';
import { TeamServiceError } from './teamErrors.js';
import type { AvailableCandidateCard } from './availability.service.js';
import type { Team, TeamVacancy } from '../db/types.js';

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

describe('filterEligibleRecommendationCandidates', () => {
  it('excludes the owner and confirmed event participants', () => {
    const pool = [
      candidate(ownerId),
      candidate(confirmedId),
      candidate(otherId),
    ];
    const filtered = filterEligibleRecommendationCandidates(pool, {
      eventId,
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

    const result = await getRecommendationsForOpenSlot(ownerId, teamId, vacancyId, {
      teamsRepo,
      listCandidates: async () => [candidate(otherId)],
    });

    expect(result.status).toBe('ok');
    expect(result.empty).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].displayScore).toBe('70.0');
    expect(result.candidates[0].contributions?.skill).toMatch(/Matched 2 of 4/);
    expect(result.candidates[0].participantId).toBe(otherId);
    expect(result.notice).toMatch(/self-declared/);
    expect(result.slot.role).toBe('Frontend');
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

    const result = await getRecommendationsForOpenSlot(ownerId, teamId, vacancyId, {
      teamsRepo,
      listCandidates: async () => [candidate(otherId)],
    });

    expect(result.empty).toBe(true);
    expect(result.candidates).toEqual([]);
    expect(result.message).toBe(EMPTY_RECOMMENDATIONS_MESSAGE);
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
      getRecommendationsForOpenSlot(otherId, teamId, vacancyId, {
        teamsRepo,
        listCandidates: async () => [],
      })
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
      getRecommendationsForOpenSlot(ownerId, teamId, vacancyId, {
        teamsRepo,
        listCandidates: async () => [],
      })
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
      getRecommendationsForOpenSlot(ownerId, teamId, vacancyId, {
        teamsRepo,
        listCandidates: async () => [],
      })
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
      getRecommendationsForOpenSlot(ownerId, teamId, vacancyId, {
        teamsRepo,
        listCandidates: async () => [],
      })
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

    const result = await getRecommendationsForOpenSlot(ownerId, teamId, vacancyId, {
      teamsRepo,
      listCandidates: async () => [candidate(otherId)],
      computeScore: () => {
        throw new Error('scoring exploded');
      },
    });

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

    const result = await getRecommendationsForOpenSlot(ownerId, teamId, vacancyId, {
      teamsRepo,
      listCandidates: async () => [zoe, amy],
    });

    expect(result.candidates.map((c) => c.handle)).toEqual(['amy', 'zoe']);
  });
});

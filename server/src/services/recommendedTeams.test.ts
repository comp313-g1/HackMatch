import { describe, it, expect } from 'vitest';
import {
  EMPTY_RECOMMENDED_TEAMS_MESSAGE,
  RECOMMENDED_TEAMS_CAP,
  getRecommendedTeamsForParticipant,
  type RecommendedTeamsServiceDeps,
} from './recommendedTeams.js';
import { TeamServiceError } from './teamErrors.js';
import type { OpenTeamRecord } from '../db/teams.repository.js';
import type {
  Participant,
  ParticipantPrimaryRole,
  ParticipantProfile,
  ParticipantSkill,
  Team,
  TeamGoal,
  TeamRecruitmentStatus,
} from '../db/types.js';
import type { PlatformAvailabilityRecord } from '../repositories/availability.repository.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const otherOwnerId = '22222222-2222-4222-8222-222222222222';
const joinedTeamId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-11-10T12:00:00.000Z');

const participant: Participant = {
  id: actorId,
  firebase_uid: 'firebase-uid-actor',
  email: 'actor@example.test',
  full_name: 'Actor Participant',
  role: 'PART',
  is_verified: true,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

const profile: ParticipantProfile = {
  participant_id: actorId,
  handle: 'actor_dev',
  primary_role: 'Frontend',
  institution: null,
  shared_contact_handle: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

const skills: ParticipantSkill[] = [
  { id: 'skill-1', participant_id: actorId, skill_name: 'React', created_at: '2026-10-01T00:00:00.000Z' },
  { id: 'skill-2', participant_id: actorId, skill_name: 'TypeScript', created_at: '2026-10-01T00:00:00.000Z' },
];

const availability: PlatformAvailabilityRecord = {
  participantId: actorId,
  isLooking: true,
  desiredRole: 'Frontend',
  commitmentHours: 20,
  goal: 'Project Completion',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

function baseTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    event_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    owner_participant_id: otherOwnerId,
    name: 'Alpha Team',
    pitch: 'We ship fast.',
    goal: 'Project Completion' as TeamGoal,
    commitment_hours: 20,
    communication_link: null,
    recruitment_status: 'Open' as TeamRecruitmentStatus,
    locked_at: null,
    disbanded_at: null,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function openRecord(options: {
  team?: Partial<Team>;
  vacancies?: Array<{ id: string; role: ParticipantPrimaryRole; skills: string[] }>;
} = {}): OpenTeamRecord {
  const team = baseTeam(options.team);
  return {
    team,
    event: { status: 'Published', end_date: '2099-01-01T00:00:00.000Z' },
    openVacancies:
      options.vacancies ??
      [{ id: `${team.id}-v1`, role: 'Frontend', skills: ['React', 'TypeScript'] }],
    members: [],
  };
}

function buildDeps(options: {
  records: OpenTeamRecord[];
  confirmedTeamIds?: string[];
  availabilityRecord?: PlatformAvailabilityRecord | null;
  profileRecord?: ParticipantProfile | null;
}): RecommendedTeamsServiceDeps {
  return {
    participantsRepo: {
      findById: async (id: string) => (id === actorId ? participant : null),
    },
    profileRepo: {
      findProfileByParticipantId: async () => options.profileRecord ?? profile,
      findSkillsByParticipantId: async () => skills,
    },
    availabilityRepo: {
      findByParticipantId: async () =>
        options.availabilityRecord === undefined ? availability : options.availabilityRecord,
    },
    teamsRepo: {
      findOpenTeamRecords: async () => options.records,
      findConfirmedTeamIdsForParticipant: async () => options.confirmedTeamIds ?? [],
    },
    now: () => now,
  };
}

describe('getRecommendedTeamsForParticipant (US-016)', () => {
  it('returns open teams in deterministic order (newest first, id ascending)', async () => {
    const older = openRecord({
      team: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Older Team',
        created_at: '2026-10-01T00:00:00.000Z',
      },
    });
    const newer = openRecord({
      team: {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        name: 'Newer Team',
        created_at: '2026-11-05T00:00:00.000Z',
      },
    });

    const result = await getRecommendedTeamsForParticipant(
      actorId,
      buildDeps({ records: [older, newer] })
    );

    expect(result.status).toBe('ok');
    expect(result.empty).toBe(false);
    expect(result.message).toBeNull();
    expect(result.teams.map((t) => t.teamName)).toEqual(['Newer Team', 'Older Team']);
  });

  it('returns the empty state with a user-visible message when nothing is open', async () => {
    const result = await getRecommendedTeamsForParticipant(actorId, buildDeps({ records: [] }));

    expect(result.teams).toEqual([]);
    expect(result.empty).toBe(true);
    expect(result.message).toBe(EMPTY_RECOMMENDED_TEAMS_MESSAGE);
    expect(result.notice.length).toBeGreaterThan(0);
  });

  it('excludes teams the participant already joined', async () => {
    const joined = openRecord({
      team: { id: joinedTeamId, name: 'Already Joined' },
    });
    const open = openRecord({
      team: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Still Open' },
    });

    const result = await getRecommendedTeamsForParticipant(
      actorId,
      buildDeps({ records: [joined, open], confirmedTeamIds: [joinedTeamId] })
    );

    expect(result.teams.map((t) => t.teamName)).toEqual(['Still Open']);
  });

  it('excludes teams the participant owns', async () => {
    const owned = openRecord({
      team: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'My Own Team', owner_participant_id: actorId },
    });
    const open = openRecord({
      team: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Still Open' },
    });

    const result = await getRecommendedTeamsForParticipant(
      actorId,
      buildDeps({ records: [owned, open] })
    );

    expect(result.teams.map((t) => t.teamName)).toEqual(['Still Open']);
  });

  it('drops teams hidden by moderation and locked or disbanded teams', async () => {
    const hidden = openRecord({
      team: {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        name: 'Hidden Team',
        moderation_hidden_at: '2026-11-01T00:00:00.000Z',
      },
    });
    const locked = openRecord({
      team: { id: '99999999-9999-4999-8999-999999999999', name: 'Locked Team', recruitment_status: 'Locked' },
    });
    const open = openRecord({
      team: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Still Open' },
    });

    const result = await getRecommendedTeamsForParticipant(
      actorId,
      buildDeps({ records: [hidden, locked, open] })
    );

    expect(result.teams.map((t) => t.teamName)).toEqual(['Still Open']);
  });

  it(`caps the response at ${RECOMMENDED_TEAMS_CAP} vacancies`, async () => {
    const records = Array.from({ length: RECOMMENDED_TEAMS_CAP + 3 }, (_, index) =>
      openRecord({
        team: {
          id: `0000000${index.toString(16)}-0000-4000-8000-000000000000`,
          name: `Team ${index}`,
          created_at: `2026-11-${(index + 1).toString().padStart(2, '0')}T00:00:00.000Z`,
        },
      })
    );

    const result = await getRecommendedTeamsForParticipant(actorId, buildDeps({ records }));

    expect(result.teams).toHaveLength(RECOMMENDED_TEAMS_CAP);
  });

  it('fails with the existing 403 when the authenticated participant no longer exists', async () => {
    await expect(
      getRecommendedTeamsForParticipant(
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        buildDeps({ records: [] })
      )
    ).rejects.toBeInstanceOf(TeamServiceError);
  });

  it('scores missing declared inputs as zero instead of failing', async () => {
    const result = await getRecommendedTeamsForParticipant(
      actorId,
      buildDeps({
        records: [openRecord()],
        availabilityRecord: null,
        profileRecord: null,
      })
    );

    expect(result.empty).toBe(false);
    expect(result.teams).toHaveLength(1);
  });
});

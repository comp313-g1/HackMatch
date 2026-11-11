import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Participant,
  ParticipantProfile,
  ParticipantSkill,
} from '../db/types.js';
import type { RecommendationTeamRecord } from '../db/teamRecommendations.repository.js';
import { getEligibleTeamRecommendations } from './teamRecommendations.js';

const ME = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const TEAM_A = '33333333-3333-4333-8333-333333333333';
const TEAM_B = '44444444-4444-4444-8444-444444444444';
const VACANCY_A = '55555555-5555-4555-8555-555555555555';
const VACANCY_B = '66666666-6666-4666-8666-666666666666';

function participant(over: Partial<Participant> = {}): Participant {
  return {
    id: ME,
    firebase_uid: 'firebase-me',
    email: 'private@example.test',
    full_name: 'Private Name',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    is_deactivated: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function profile(over: Partial<ParticipantProfile> = {}): ParticipantProfile {
  return {
    participant_id: ME,
    handle: 'me_dev',
    primary_role: 'Backend',
    institution: 'Private Institution',
    shared_contact_handle: '@private',
    moderation_status: 'None',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function skills(...names: string[]): ParticipantSkill[] {
  return names.map((skill_name, index) => ({
    id: `7000000${index}-0000-4000-8000-000000000000`,
    participant_id: ME,
    skill_name,
    created_at: '2026-01-01T00:00:00.000Z',
  }));
}

function candidate(
  over: {
    team?: Partial<RecommendationTeamRecord['team']>;
    vacancy?: Partial<RecommendationTeamRecord['vacancy']>;
    members?: string[];
  } = {}
): RecommendationTeamRecord {
  return {
    team: {
      id: TEAM_A,
      owner_participant_id: OWNER,
      name: 'Alpha Team',
      pitch: 'Build something useful.',
      goal: 'Learning',
      commitment_hours: 10,
      recruitment_status: 'Open',
      locked_at: null,
      disbanded_at: null,
      moderation_hidden_at: null,
      moderation_status: 'None',
      created_at: '2026-01-01T00:00:00.000Z',
      ...over.team,
    },
    vacancy: {
      id: VACANCY_A,
      team_id: over.team?.id ?? TEAM_A,
      role: 'Backend',
      skills: ['Node.js'],
      status: 'Open',
      removed_at: null,
      created_at: '2026-01-02T00:00:00.000Z',
      ...over.vacancy,
    },
    confirmedMemberIds: new Set(over.members ?? [OWNER]),
  };
}

function deps(over: Record<string, unknown> = {}) {
  const recommendationsRepo = {
    listEligibleTeamVacanciesForParticipant: vi.fn().mockResolvedValue({
      candidates: [candidate()],
      pendingRequestTeamIds: new Set<string>(),
    }),
  };
  return {
    participantsRepo: { findById: vi.fn().mockResolvedValue(participant()) },
    profileRepo: {
      findProfileByParticipantId: vi.fn().mockResolvedValue(profile()),
      findSkillsByParticipantId: vi.fn().mockResolvedValue(skills(' Node.js ', 'node.js')),
    },
    availabilityRepo: {
      findByParticipantId: vi.fn().mockResolvedValue({
        participantId: ME,
        isLooking: true,
        desiredRole: 'Backend',
        commitmentHours: 12,
        goal: 'Learning',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    },
    recommendationsRepo,
    ...over,
  };
}

describe('participant team recommendation query (US-016 / #154)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns participant-safe eligible vacancies for the authenticated profile', async () => {
    const d = deps();
    const result = await getEligibleTeamRecommendations(ME, d);

    expect(d.participantsRepo.findById).toHaveBeenCalledWith(ME);
    expect(d.recommendationsRepo.listEligibleTeamVacanciesForParticipant).toHaveBeenCalledWith(ME);
    expect(result).toEqual({
      status: 'ok',
      recommendations: [
        {
          teamId: TEAM_A,
          teamName: 'Alpha Team',
          pitch: 'Build something useful.',
          goal: 'Learning',
          commitmentHours: 10,
          recruitmentStatus: 'Open',
          vacancyId: VACANCY_A,
          vacancyRole: 'Backend',
          desiredSkills: ['Node.js'],
        },
      ],
      empty: false,
      message: null,
      eligibilityReason: null,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private@example.test');
    expect(serialized).not.toContain('firebase-me');
    expect(serialized).not.toContain('Private Institution');
    expect(serialized).not.toContain('@private');
    expect(serialized).not.toMatch(/owner_participant_id|confirmedMemberIds|event_id|communication_link/i);
    expect(serialized).not.toMatch(/match(ed)?Skills|score|percentage/i);
  });

  it('uses stable team-name, team-id, then vacancy-id ordering without match ranking', async () => {
    const d = deps();
    d.recommendationsRepo.listEligibleTeamVacanciesForParticipant.mockResolvedValue({
      candidates: [
        candidate({
          team: { id: TEAM_B, name: 'Zulu Team' },
          vacancy: { id: VACANCY_B, team_id: TEAM_B },
        }),
        candidate(),
      ],
      pendingRequestTeamIds: new Set(),
    });

    const result = await getEligibleTeamRecommendations(ME, d);
    expect(result.recommendations.map((item) => item.teamName)).toEqual([
      'Alpha Team',
      'Zulu Team',
    ]);
  });

  it.each([
    ['locked team', { team: { recruitment_status: 'Locked', locked_at: '2026-01-03T00:00:00.000Z' } }],
    ['disbanded team', { team: { recruitment_status: 'Disbanded', disbanded_at: '2026-01-03T00:00:00.000Z' } }],
    ['hidden team', { team: { moderation_status: 'Hidden' } }],
    ['filled vacancy', { vacancy: { status: 'Filled' } }],
    ['removed vacancy', { vacancy: { status: 'Removed', removed_at: '2026-01-03T00:00:00.000Z' } }],
    ['wrong-team vacancy', { vacancy: { team_id: TEAM_B } }],
  ] as const)('defensively excludes a stale %s returned during a state change', async (_label, over) => {
    const d = deps();
    d.recommendationsRepo.listEligibleTeamVacanciesForParticipant.mockResolvedValue({
      candidates: [candidate(over as Parameters<typeof candidate>[0])],
      pendingRequestTeamIds: new Set(),
    });

    const result = await getEligibleTeamRecommendations(ME, d);
    expect(result.recommendations).toEqual([]);
    expect(result.empty).toBe(true);
  });

  it('defensively excludes owner/confirmed membership and pending request states from #153', async () => {
    for (const queryResult of [
      { candidates: [candidate({ team: { owner_participant_id: ME } })], pendingRequestTeamIds: new Set<string>() },
      { candidates: [candidate({ members: [OWNER, ME] })], pendingRequestTeamIds: new Set<string>() },
      { candidates: [candidate()], pendingRequestTeamIds: new Set([TEAM_A]) },
    ]) {
      const d = deps();
      d.recommendationsRepo.listEligibleTeamVacanciesForParticipant.mockResolvedValue(queryResult);
      const result = await getEligibleTeamRecommendations(ME, d);
      expect(result.recommendations).toEqual([]);
    }
  });

  it.each([
    ['not looking', 'participant_not_looking'],
    ['no skills', 'participant_no_skills'],
    ['hidden profile', 'participant_profile_hidden'],
  ] as const)('returns an empty success and skips the team query when the profile is %s', async (label, reason) => {
    const d = deps();
    if (label === 'not looking') {
      d.availabilityRepo.findByParticipantId.mockResolvedValue(null);
    } else if (label === 'no skills') {
      d.profileRepo.findSkillsByParticipantId.mockResolvedValue([]);
    } else {
      d.profileRepo.findProfileByParticipantId.mockResolvedValue(
        profile({ moderation_status: 'Hidden' })
      );
    }
    const result = await getEligibleTeamRecommendations(ME, d);
    expect(result.status).toBe('ok');
    expect(result.empty).toBe(true);
    expect(result.recommendations).toEqual([]);
    expect(result.eligibilityReason).toBe(reason);
    expect(d.recommendationsRepo.listEligibleTeamVacanciesForParticipant).not.toHaveBeenCalled();
  });

  it('returns a successful standard empty collection when no team qualifies', async () => {
    const d = deps();
    d.recommendationsRepo.listEligibleTeamVacanciesForParticipant.mockResolvedValue({
      candidates: [],
      pendingRequestTeamIds: new Set(),
    });
    const result = await getEligibleTeamRecommendations(ME, d);
    expect(result).toMatchObject({ status: 'ok', recommendations: [], empty: true });
    expect(result.message).toMatch(/No eligible open team vacancies/);
  });

  it('does not treat role, goal, or the participant pending-application quota as candidate exclusions', async () => {
    const d = deps({
      availabilityRepo: {
        findByParticipantId: vi.fn().mockResolvedValue({
          participantId: ME,
          isLooking: true,
          desiredRole: 'Frontend',
          commitmentHours: 1,
          goal: 'Competitive',
          updatedAt: null,
        }),
      },
    });
    const result = await getEligibleTeamRecommendations(ME, d);
    expect(result.recommendations).toHaveLength(1);
  });
});

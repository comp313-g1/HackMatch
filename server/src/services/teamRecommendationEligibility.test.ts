import { describe, it, expect } from 'vitest';
import {
  buildReverseMatchInputs,
  evaluateTeamVacancyEligibility,
  normalizeSkillTags,
  partitionTeamVacancies,
  skillKey,
  NO_TEAM_RECOMMENDATIONS_HINT,
  type ReverseMatchSource,
  type TeamVacancyCandidate,
} from './teamRecommendationEligibility.js';
import type { Participant } from '../db/types.js';

const ME = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const TEAM = '44444444-4444-4444-8444-444444444444';
const TEAM_2 = '55555555-5555-4555-8555-555555555555';
const VACANCY = '66666666-6666-4666-8666-666666666666';

function participant(over: Partial<Participant> = {}): Participant {
  return {
    id: ME,
    firebase_uid: 'fb-me',
    email: 'me@example.test',
    full_name: 'Me',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    is_deactivated: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function source(over: Partial<ReverseMatchSource> = {}): ReverseMatchSource {
  return {
    participant: participant(),
    profile: { primary_role: 'Backend', moderation_status: 'None' },
    skills: ['Node.js', 'PostgreSQL'],
    availability: { isLooking: true, desiredRole: 'Backend', commitmentHours: 12, goal: 'Learning' },
    ...over,
  };
}

function candidate(over: {
  team?: Partial<TeamVacancyCandidate['team']>;
  vacancy?: Partial<TeamVacancyCandidate['vacancy']>;
  members?: string[];
} = {}): TeamVacancyCandidate {
  return {
    team: {
      id: TEAM,
      owner_participant_id: OWNER,
      recruitment_status: 'Open',
      locked_at: null,
      disbanded_at: null,
      moderation_hidden_at: null,
      moderation_status: 'None',
      ...over.team,
    },
    vacancy: { id: VACANCY, team_id: TEAM, status: 'Open', removed_at: null, ...over.vacancy },
    confirmedMemberIds: new Set(over.members ?? [OWNER]),
  };
}

const noPending = { pendingRequestTeamIds: new Set<string>() };
const me = { participantId: ME };

describe('skill tags (US-016 / #153)', () => {
  it('compares skills by trimmed, single-spaced, lower-case form', () => {
    expect(skillKey('  Node.JS ')).toBe('node.js');
    expect(skillKey('Data   Visualization')).toBe('data visualization');
  });

  it('drops blanks and non-text values, trims, and removes case-insensitive duplicates keeping the first spelling', () => {
    expect(normalizeSkillTags(['React', ' react ', 'REACT', '', '   ', 'Node.js', null, 42, undefined, 'Data  Visualization', 'data visualization'] as unknown[])).toEqual([
      'React',
      'Node.js',
      'Data Visualization',
    ]);
  });

  it('handles a missing list', () => {
    expect(normalizeSkillTags(null)).toEqual([]);
    expect(normalizeSkillTags(undefined)).toEqual([]);
  });
});

describe('reverse matching inputs (US-016 / #153)', () => {
  it('builds the inputs for an active, verified, looking participant with skills', () => {
    const result = buildReverseMatchInputs(source());
    expect(result).toEqual({
      ok: true,
      inputs: {
        participantId: ME,
        primaryRole: 'Backend',
        desiredRole: 'Backend',
        goal: 'Learning',
        commitmentHours: 12,
        skills: ['Node.js', 'PostgreSQL'],
        skillKeys: ['node.js', 'postgresql'],
      },
    });
  });

  it('normalizes the id and the skills, and keeps unstated preferences as null', () => {
    const result = buildReverseMatchInputs(
      source({
        participant: participant({ id: ME.toUpperCase() }),
        profile: { primary_role: null, moderation_status: 'None' },
        skills: [' React ', 'react', 'Python'],
        availability: { isLooking: true, desiredRole: null, commitmentHours: null, goal: null },
      })
    );
    expect(result).toMatchObject({
      ok: true,
      inputs: { participantId: ME, primaryRole: null, desiredRole: null, goal: null, commitmentHours: null, skills: ['React', 'Python'] },
    });
  });

  it('works without a profile row when the participant otherwise qualifies', () => {
    expect(buildReverseMatchInputs(source({ profile: null }))).toMatchObject({ ok: true, inputs: { primaryRole: null } });
  });

  it.each([
    ['missing account', { participant: null }, 'participant_missing'],
    ['an ADMIN', { participant: participant({ role: 'ADMIN' }) }, 'participant_not_part'],
    ['unverified', { participant: participant({ is_verified: false }) }, 'participant_unverified'],
    ['suspended', { participant: participant({ is_suspended: true }) }, 'participant_suspended'],
    ['deactivated', { participant: participant({ is_deactivated: true, is_suspended: true }) }, 'participant_deactivated'],
    ['a profile hidden by moderation', { profile: { primary_role: 'Backend', moderation_status: 'Hidden' } }, 'participant_profile_hidden'],
    ['no availability record', { availability: null }, 'participant_not_looking'],
    ['not looking for a team', { availability: { isLooking: false, desiredRole: 'Backend', commitmentHours: 5, goal: 'Learning' } }, 'participant_not_looking'],
    ['no skills', { skills: [] }, 'participant_no_skills'],
    ['only blank skills', { skills: ['', '  '] }, 'participant_no_skills'],
    ['no skill list', { skills: null }, 'participant_no_skills'],
  ] as const)('refuses %s with %s', (_label, over, reason) => {
    expect(buildReverseMatchInputs(source(over as Partial<ReverseMatchSource>))).toEqual({ ok: false, reason });
  });

  it('reports the first failing rule in a fixed order', () => {
    const everythingWrong = source({
      participant: participant({ is_verified: false, is_suspended: true }),
      profile: { primary_role: null, moderation_status: 'Hidden' },
      skills: [],
      availability: null,
    });
    expect(buildReverseMatchInputs(everythingWrong)).toEqual({ ok: false, reason: 'participant_unverified' });
    expect(buildReverseMatchInputs({ ...everythingWrong, participant: participant() })).toEqual({ ok: false, reason: 'participant_profile_hidden' });
    expect(buildReverseMatchInputs({ ...everythingWrong, participant: participant(), profile: null })).toEqual({ ok: false, reason: 'participant_not_looking' });
  });

  it.each([-1, 169, Number.NaN, Number.POSITIVE_INFINITY])('ignores an invalid commitment of %s hours', (hours) => {
    const result = buildReverseMatchInputs(
      source({ availability: { isLooking: true, desiredRole: 'Backend', commitmentHours: hours, goal: 'Learning' } })
    );
    expect(result).toMatchObject({ ok: true, inputs: { commitmentHours: null } });
  });

  it.each([0, 168])('accepts the boundary commitment of %s hours', (hours) => {
    const result = buildReverseMatchInputs(
      source({ availability: { isLooking: true, desiredRole: 'Backend', commitmentHours: hours, goal: 'Learning' } })
    );
    expect(result).toMatchObject({ ok: true, inputs: { commitmentHours: hours } });
  });

  it('does not change the data it was given', () => {
    const skills = [' React ', 'react'];
    const original = source({ skills });
    buildReverseMatchInputs(original);
    expect(skills).toEqual([' React ', 'react']);
  });
});

describe('team and vacancy eligibility (US-016 / #153)', () => {
  it('accepts an open vacancy on an open, visible team the participant is not part of', () => {
    expect(evaluateTeamVacancyEligibility(candidate(), me, noPending)).toEqual({ eligible: true, reason: null });
  });

  it('excludes the owner and confirmed members, comparing ids case-insensitively', () => {
    expect(evaluateTeamVacancyEligibility(candidate({ team: { owner_participant_id: ME } }), me, noPending).reason).toBe('already_team_member');
    expect(evaluateTeamVacancyEligibility(candidate({ members: [OWNER, ME] }), me, noPending).reason).toBe('already_team_member');
    expect(evaluateTeamVacancyEligibility(candidate({ members: [OWNER, ME.toUpperCase()] }), me, noPending).reason).toBe('already_team_member');
    expect(evaluateTeamVacancyEligibility(candidate({ team: { owner_participant_id: ME.toUpperCase() } }), me, noPending).reason).toBe('already_team_member');
  });

  it('allows a participant who is a member of a different team', () => {
    expect(evaluateTeamVacancyEligibility(candidate({ members: [OWNER, OTHER] }), me, noPending).eligible).toBe(true);
  });

  it.each([
    ['hidden by a timestamp', { moderation_hidden_at: '2026-11-01T00:00:00.000Z' }],
    ['hidden by status', { moderation_status: 'Hidden' as const }],
  ])('excludes a team that is %s', (_label, team) => {
    expect(evaluateTeamVacancyEligibility(candidate({ team }), me, noPending).reason).toBe('team_hidden');
  });

  it('keeps a team that has only been warned', () => {
    expect(evaluateTeamVacancyEligibility(candidate({ team: { moderation_status: 'Warned' } }), me, noPending).eligible).toBe(true);
  });

  it.each([
    ['Locked', { recruitment_status: 'Locked' as const }],
    ['Disbanded', { recruitment_status: 'Disbanded' as const }],
    ['stamped as locked', { locked_at: '2026-11-01T00:00:00.000Z' }],
    ['stamped as disbanded', { disbanded_at: '2026-11-01T00:00:00.000Z' }],
  ])('excludes a team that is %s', (_label, team) => {
    expect(evaluateTeamVacancyEligibility(candidate({ team }), me, noPending).reason).toBe('team_not_recruiting');
  });

  it.each([
    ['Filled', { status: 'Filled' as const }],
    ['Removed', { status: 'Removed' as const }],
    ['stamped as removed', { removed_at: '2026-11-01T00:00:00.000Z' }],
  ])('excludes a vacancy that is %s', (_label, vacancy) => {
    expect(evaluateTeamVacancyEligibility(candidate({ vacancy }), me, noPending).reason).toBe('vacancy_not_open');
  });

  it('excludes a vacancy that belongs to a different team', () => {
    expect(evaluateTeamVacancyEligibility(candidate({ vacancy: { team_id: TEAM_2 } }), me, noPending).reason).toBe('vacancy_team_mismatch');
  });

  it('excludes a team where a request is already pending, comparing ids case-insensitively', () => {
    expect(evaluateTeamVacancyEligibility(candidate(), me, { pendingRequestTeamIds: new Set([TEAM]) }).reason).toBe('pending_request_exists');
    expect(evaluateTeamVacancyEligibility(candidate(), me, { pendingRequestTeamIds: new Set([TEAM.toUpperCase()]) }).reason).toBe('pending_request_exists');
    expect(evaluateTeamVacancyEligibility(candidate(), me, { pendingRequestTeamIds: new Set([TEAM_2]) }).eligible).toBe(true);
  });

  it('reports the first failing rule in a fixed order: member, hidden, not recruiting, vacancy, pending', () => {
    const allWrong = candidate({
      team: { owner_participant_id: ME, moderation_status: 'Hidden', recruitment_status: 'Locked' },
      vacancy: { status: 'Filled' },
    });
    const pending = { pendingRequestTeamIds: new Set([TEAM]) };
    expect(evaluateTeamVacancyEligibility(allWrong, me, pending).reason).toBe('already_team_member');
    expect(evaluateTeamVacancyEligibility({ ...allWrong, team: { ...allWrong.team, owner_participant_id: OWNER } }, me, pending).reason).toBe('team_hidden');
    expect(evaluateTeamVacancyEligibility({ ...allWrong, team: { ...allWrong.team, owner_participant_id: OWNER, moderation_status: 'None' } }, me, pending).reason).toBe('team_not_recruiting');
    expect(evaluateTeamVacancyEligibility({ ...allWrong, team: { ...allWrong.team, owner_participant_id: OWNER, moderation_status: 'None', recruitment_status: 'Open' } }, me, pending).reason).toBe('vacancy_not_open');
    expect(evaluateTeamVacancyEligibility(candidate(), me, pending).reason).toBe('pending_request_exists');
  });

  it('does not depend on role or goal differences, which only affect ranking', () => {
    const decision = evaluateTeamVacancyEligibility(candidate(), { participantId: ME }, noPending);
    expect(decision.eligible).toBe(true);
  });
});

describe('partitioning a pool of open slots (US-016 / #153)', () => {
  const mk = (n: number, over: Parameters<typeof candidate>[0] = {}) =>
    candidate({ ...over, team: { id: `0000000${n}-0000-4000-8000-000000000000`, ...over.team }, vacancy: { id: `1000000${n}-0000-4000-8000-000000000000`, team_id: `0000000${n}-0000-4000-8000-000000000000`, ...over.vacancy } });

  it('separates eligible slots from excluded ones and counts each reason', () => {
    const pool = [
      mk(1),
      mk(2, { team: { owner_participant_id: ME } }),
      mk(3, { team: { moderation_status: 'Hidden' } }),
      mk(4, { team: { recruitment_status: 'Locked' } }),
      mk(5, { vacancy: { status: 'Filled' } }),
      mk(6),
      mk(7),
    ];
    const pending = { pendingRequestTeamIds: new Set([pool[5]!.team.id]) };
    const result = partitionTeamVacancies(pool, me, pending);

    expect(result.eligible.map((c) => c.team.id)).toEqual([pool[0]!.team.id, pool[6]!.team.id]);
    expect(result.excluded.map((e) => e.reason)).toEqual([
      'already_team_member',
      'team_hidden',
      'team_not_recruiting',
      'vacancy_not_open',
      'pending_request_exists',
    ]);
    expect(result.summary).toEqual({
      considered: 7,
      eligible: 2,
      alreadyMember: 1,
      hidden: 1,
      notRecruiting: 1,
      vacancyUnavailable: 1,
      pendingRequest: 1,
      totalExcluded: 5,
    });
  });

  it('returns nothing for an empty pool and never invents teams', () => {
    const result = partitionTeamVacancies([], me, noPending);
    expect(result.eligible).toEqual([]);
    expect(result.excluded).toEqual([]);
    expect(result.summary.considered).toBe(0);
    expect(result.summary.totalExcluded).toBe(0);
  });

  it('can give several slots from the same team when each is open', () => {
    const a = candidate();
    const b = candidate({ vacancy: { id: '77777777-7777-4777-8777-777777777777' } });
    expect(partitionTeamVacancies([a, b], me, noPending).eligible).toHaveLength(2);
  });

  it('counts a vacancy that belongs to another team under vacancy problems', () => {
    const result = partitionTeamVacancies([candidate({ vacancy: { team_id: TEAM_2 } })], me, noPending);
    expect(result.summary.vacancyUnavailable).toBe(1);
  });

  it('explains what is left out in the empty-state hint', () => {
    expect(NO_TEAM_RECOMMENDATIONS_HINT).toMatch(/already belong to/);
    expect(NO_TEAM_RECOMMENDATIONS_HINT).toMatch(/full, locked, hidden or closed/);
    expect(NO_TEAM_RECOMMENDATIONS_HINT).toMatch(/applied to or were invited/);
  });
});

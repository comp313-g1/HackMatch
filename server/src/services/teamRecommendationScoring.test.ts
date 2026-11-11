import { describe, it, expect } from 'vitest';
import {
  rankTeamVacancies,
  scoreTeamVacancy,
  type ScorableTeamVacancy,
} from './teamRecommendationScoring.js';
import { computeCompatibilityScore } from './compatibilityScoring.js';
import type { ReverseMatchInputs } from './teamRecommendationEligibility.js';

const ME = '11111111-1111-4111-8111-111111111111';

function inputs(over: Partial<ReverseMatchInputs> = {}): ReverseMatchInputs {
  const skills = over.skills ?? ['Node.js', 'PostgreSQL'];
  return {
    participantId: ME,
    primaryRole: 'Backend',
    desiredRole: 'Backend',
    goal: 'Learning',
    commitmentHours: 12,
    skills,
    skillKeys: skills.map((s) => s.toLowerCase()),
    ...over,
  };
}

function slot(over: {
  team?: Partial<ScorableTeamVacancy['team']>;
  vacancy?: Partial<ScorableTeamVacancy['vacancy']>;
} = {}): ScorableTeamVacancy {
  return {
    team: { id: 'team-1', name: 'Civic Signal', goal: 'Learning', commitment_hours: 12, ...over.team },
    vacancy: { id: 'vac-1', role: 'Backend', skills: ['Node.js', 'PostgreSQL'], ...over.vacancy },
  };
}

describe('match percentage (US-016 / #155)', () => {
  it('gives 100% for a full match: all skills, same role, same goal, enough hours', () => {
    const score = scoreTeamVacancy(inputs(), slot());
    expect(score.matchPercent).toBe(100);
    expect(score.score).toBe(100);
    expect(score.displayScore).toBe('100.0');
    expect(score.matchedSkills).toEqual(['Node.js', 'PostgreSQL']);
    expect(score.missingSkills).toEqual([]);
    expect(score.roleMatched).toBe(true);
    expect(score.hadMissingInput).toBe(false);
  });

  it('works out a partial match from the shared formula (1 of 2 skills with the role bonus, adjacent goal, half the hours)', () => {
    const score = scoreTeamVacancy(
      inputs({ skills: ['Node.js'], goal: 'Learning', commitmentHours: 8 }),
      slot({ team: { goal: 'Project Completion', commitment_hours: 16 } })
    );
    // S = 0.5 x 1.2 = 0.6, G = 0.5, H = 0.5 -> 100 x 1.6 / 3
    expect(score.components).toEqual({ skill: 0.6, goal: 0.5, hours: 0.5 });
    expect(score.score).toBeCloseTo(53.3333, 3);
    expect(score.matchPercent).toBe(53);
    expect(score.displayScore).toBe('53.3');
    expect(score.matchedSkills).toEqual(['Node.js']);
    expect(score.missingSkills).toEqual(['PostgreSQL']);
  });

  it('gives no role bonus when the roles differ', () => {
    const score = scoreTeamVacancy(
      inputs({ skills: ['Node.js'], desiredRole: 'UI/UX', primaryRole: 'UI/UX', goal: 'Learning', commitmentHours: 20 }),
      slot({ team: { goal: 'Competitive', commitment_hours: 10 } })
    );
    // S = 0.5, G = 0 (Learning and Competitive are not neighbours), H = 1
    expect(score.components).toEqual({ skill: 0.5, goal: 0, hours: 1 });
    expect(score.matchPercent).toBe(50);
    expect(score.roleMatched).toBe(false);
  });

  it('uses the primary role for the role bonus when no desired role is set, and prefers the desired role when there is one', () => {
    const asPrimary = scoreTeamVacancy(inputs({ desiredRole: null, primaryRole: 'Backend' }), slot());
    expect(asPrimary.roleMatched).toBe(true);
    const desiredWins = scoreTeamVacancy(inputs({ desiredRole: 'Frontend', primaryRole: 'Backend' }), slot());
    expect(desiredWins.roleMatched).toBe(false);
    const neither = scoreTeamVacancy(inputs({ desiredRole: null, primaryRole: null }), slot());
    expect(neither.roleMatched).toBe(false);
  });

  it('rounds to the nearest whole percent, not down', () => {
    // S = 1, G = 1, H = 5/12 -> 80.5556
    const up = scoreTeamVacancy(inputs({ commitmentHours: 5 }), slot());
    expect(up.score).toBeCloseTo(80.5556, 3);
    expect(up.matchPercent).toBe(81);
    // H = 0.4 -> exactly 80.0
    const exact = scoreTeamVacancy(inputs({ commitmentHours: 4.8 }), slot());
    expect(exact.matchPercent).toBe(80);
  });

  it('never invents missing data: unstated goal and hours score 0 and are flagged', () => {
    const score = scoreTeamVacancy(inputs({ goal: null, commitmentHours: null }), slot());
    expect(score.components.goal).toBe(0);
    expect(score.components.hours).toBe(0);
    expect(score.hadMissingInput).toBe(true);
    expect(score.matchPercent).toBe(33);
  });

  it('scores a vacancy with no required skills as full skill coverage', () => {
    const score = scoreTeamVacancy(inputs({ skills: ['Anything'], desiredRole: 'UI/UX', primaryRole: 'UI/UX' }), slot({ vacancy: { skills: [] } }));
    expect(score.components.skill).toBe(1);
    expect(score.matchedSkills).toEqual([]);
    expect(score.missingSkills).toEqual([]);
    expect(score.requiredSkillCount).toBe(0);
  });

  it('gives 0 skill coverage when the participant shares none of the required skills', () => {
    const score = scoreTeamVacancy(inputs({ skills: ['Figma'] }), slot());
    expect(score.components.skill).toBe(0);
    expect(score.matchedSkills).toEqual([]);
    expect(score.missingSkills).toEqual(['Node.js', 'PostgreSQL']);
  });

  it('stays between 0 and 100 for any combination of inputs', () => {
    const roles = ['Frontend', 'Backend', 'Mobile', 'AI/ML', 'UI/UX', 'Pitch'] as const;
    const goals = ['Learning', 'Project Completion', 'Competitive', null] as const;
    const hours = [null, 0, 1, 12, 168] as const;
    for (const role of roles) {
      for (const goal of goals) {
        for (const h of hours) {
          for (const skills of [[], ['Node.js'], ['Node.js', 'PostgreSQL', 'Extra']]) {
            const score = scoreTeamVacancy(
              inputs({ desiredRole: role, goal, commitmentHours: h, skills }),
              slot({ team: { commitment_hours: h ?? 10 } })
            );
            expect(score.matchPercent).toBeGreaterThanOrEqual(0);
            expect(score.matchPercent).toBeLessThanOrEqual(100);
            expect(Number.isInteger(score.matchPercent)).toBe(true);
            expect(score.score).toBeGreaterThanOrEqual(0);
            expect(score.score).toBeLessThanOrEqual(100);
          }
        }
      }
    }
  });

  it('gives the same score as the candidate-side formula for the same pair', () => {
    const forward = computeCompatibilityScore(
      { role: 'Backend', requiredSkills: ['Node.js', 'PostgreSQL'], requestedHours: 12, goal: 'Learning' },
      { primaryRole: 'Backend', skills: ['Node.js', 'PostgreSQL'], commitmentHours: 12, goal: 'Learning' }
    );
    expect(scoreTeamVacancy(inputs(), slot()).score).toBe(forward.score);
  });
});

describe('matched skill tags (US-016 / #155)', () => {
  it('matches ignoring case and extra spaces, and reports the vacancy spelling', () => {
    const score = scoreTeamVacancy(
      inputs({ skills: ['node.JS', 'data  visualization'] }),
      slot({ vacancy: { skills: ['Node.js', 'Data Visualization', 'PostgreSQL'] } })
    );
    expect(score.matchedSkills).toEqual(['Node.js', 'Data Visualization']);
    expect(score.missingSkills).toEqual(['PostgreSQL']);
    expect(score.requiredSkillCount).toBe(3);
  });

  it('lists each required skill once, even when the vacancy repeats it, and keeps the vacancy order', () => {
    const score = scoreTeamVacancy(
      inputs({ skills: ['B', 'A'] }),
      slot({ vacancy: { skills: ['B', ' b ', 'A', 'C', 'c'] } })
    );
    expect(score.matchedSkills).toEqual(['B', 'A']);
    expect(score.missingSkills).toEqual(['C']);
    expect(score.requiredSkillCount).toBe(3);
  });

  it('ignores blank required skills', () => {
    const score = scoreTeamVacancy(inputs({ skills: ['A'] }), slot({ vacancy: { skills: ['A', '', '   '] } }));
    expect(score.requiredSkillCount).toBe(1);
    expect(score.matchedSkills).toEqual(['A']);
  });

  it('does not report skills the vacancy does not require', () => {
    const score = scoreTeamVacancy(inputs({ skills: ['Node.js', 'Rust', 'Go'] }), slot({ vacancy: { skills: ['Node.js'] } }));
    expect(score.matchedSkills).toEqual(['Node.js']);
  });
});

describe('result privacy and purity (US-016 / #155)', () => {
  it('returns only team and vacancy ids and score data, never account fields', () => {
    const score = scoreTeamVacancy(inputs(), slot());
    expect(Object.keys(score).sort()).toEqual(
      [
        'components', 'contributions', 'displayScore', 'hadMissingInput', 'matchPercent', 'matchedSkills',
        'missingSkills', 'requiredSkillCount', 'roleMatched', 'score', 'teamId', 'vacancyId',
      ].sort()
    );
    expect(JSON.stringify(score)).not.toContain(ME);
    expect(JSON.stringify(score)).not.toMatch(/@|email/i);
  });

  it('does not change what it was given and gives the same answer every time', () => {
    const i = inputs();
    const s = slot({ vacancy: { skills: ['Node.js', 'node.js', 'Go'] } });
    const before = JSON.stringify([i, s]);
    const a = scoreTeamVacancy(i, s);
    const b = scoreTeamVacancy(i, s);
    expect(JSON.stringify([i, s])).toBe(before);
    expect(a).toEqual(b);
  });
});

describe('ranking suggestions (US-016 / #155)', () => {
  const pool = (): ScorableTeamVacancy[] => [
    slot({ team: { id: 't-low', name: 'Low', goal: 'Competitive', commitment_hours: 40 }, vacancy: { id: 'v-low', skills: ['Figma'] } }),
    slot({ team: { id: 't-best', name: 'Best' }, vacancy: { id: 'v-best' } }),
    slot({ team: { id: 't-mid', name: 'Mid', goal: 'Project Completion' }, vacancy: { id: 'v-mid' } }),
  ];

  it('puts the best match first and numbers the suggestions from 1', () => {
    const ranked = rankTeamVacancies(inputs(), pool());
    expect(ranked.map((r) => r.teamId)).toEqual(['t-best', 't-mid', 't-low']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(ranked[0]!.teamName).toBe('Best');
    expect(ranked[0]!.matchPercent).toBeGreaterThan(ranked[1]!.matchPercent);
  });

  it('breaks ties by more matched skills, then team name, then vacancy id', () => {
    // Same score for all four: no required skills listed, same goal and hours.
    const base = { vacancy: { skills: [] as string[] } };
    const tied = [
      slot({ team: { id: 'b', name: 'beta' }, vacancy: { id: 'v2', ...base.vacancy } }),
      slot({ team: { id: 'a', name: 'Alpha' }, vacancy: { id: 'v9', ...base.vacancy } }),
      slot({ team: { id: 'a2', name: 'Alpha' }, vacancy: { id: 'v1', ...base.vacancy } }),
    ];
    const byName = rankTeamVacancies(inputs(), tied);
    expect(byName.map((r) => r.vacancyId)).toEqual(['v1', 'v9', 'v2']);

    const equalScore = rankTeamVacancies(
      inputs({ desiredRole: 'UI/UX', primaryRole: 'UI/UX', skills: ['A'] }),
      [
        slot({ team: { id: 'x', name: 'Zed' }, vacancy: { id: 'vx', role: 'Backend', skills: [] } }),
        slot({ team: { id: 'y', name: 'Yak' }, vacancy: { id: 'vy', role: 'Backend', skills: [] } }),
      ]
    );
    expect(equalScore.map((r) => r.teamName)).toEqual(['Yak', 'Zed']);
  });

  it('puts the slot with more matched skills first when the scores are exactly equal', () => {
    // Both need half of their skills covered (S = 0.5), with no role bonus, same goal and hours,
    // so the scores are equal; the second one matches two skills instead of one.
    const me = inputs({ desiredRole: 'UI/UX', primaryRole: 'UI/UX', skills: ['A', 'B'] });
    const fewer = slot({ team: { id: 'few', name: 'Aardvark' }, vacancy: { id: 'v-few', skills: ['A', 'X'] } });
    const more = slot({ team: { id: 'more', name: 'Zebra' }, vacancy: { id: 'v-more', skills: ['A', 'B', 'X', 'Y'] } });

    const ranked = rankTeamVacancies(me, [fewer, more]);
    expect(ranked[0]!.score).toBe(ranked[1]!.score);
    expect(ranked.map((r) => r.teamId)).toEqual(['more', 'few']);
    expect(ranked.map((r) => r.matchedSkills.length)).toEqual([2, 1]);
  });

  it('gives the same order whatever order the pool arrives in', () => {
    const forward = rankTeamVacancies(inputs(), pool()).map((r) => r.vacancyId);
    const backward = rankTeamVacancies(inputs(), [...pool()].reverse()).map((r) => r.vacancyId);
    expect(backward).toEqual(forward);
  });

  it('keeps only the top suggestions when a limit is given, and ignores an invalid limit', () => {
    expect(rankTeamVacancies(inputs(), pool(), 2).map((r) => r.teamId)).toEqual(['t-best', 't-mid']);
    expect(rankTeamVacancies(inputs(), pool(), 0)).toEqual([]);
    expect(rankTeamVacancies(inputs(), pool(), -1)).toHaveLength(3);
    expect(rankTeamVacancies(inputs(), pool(), 1.5)).toHaveLength(3);
    expect(rankTeamVacancies(inputs(), pool(), Number.NaN)).toHaveLength(3);
  });

  it('returns an empty list for an empty pool', () => {
    expect(rankTeamVacancies(inputs(), [])).toEqual([]);
  });
});

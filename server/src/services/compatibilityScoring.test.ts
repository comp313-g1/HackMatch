import { describe, it, expect } from 'vitest';
import {
  computeCompatibilityScore,
  computeGoalAlignment,
  computeHoursAlignment,
  computeSkillCoverage,
  compareCompatibilityResults,
  formatCompatibilityDisplayScore,
  rankCandidatesByCompatibility,
  validateCompatibilityScoreInputs,
  type CandidateScoringInput,
  type SlotScoringInput,
} from './compatibilityScoring.js';

const baseSlot: SlotScoringInput = {
  role: 'Frontend',
  requiredSkills: ['React', 'TypeScript', 'CSS', 'Testing'],
  requestedHours: 20,
  goal: 'Project Completion',
};

const baseCandidate: CandidateScoringInput = {
  primaryRole: 'Frontend',
  skills: ['React', 'TypeScript'],
  commitmentHours: 10,
  goal: 'Project Completion',
  displayHandle: 'alice',
  internalId: 'id-alice',
};

describe('FR-044 skill coverage', () => {
  it('gives S=0.6 for 2 of 4 required tags with role match (×1.2, capped at 1)', () => {
    const { s, matchedSkills, roleMatched } = computeSkillCoverage(
      ['React', 'TypeScript', 'CSS', 'Testing'],
      ['React', 'TypeScript'],
      'Frontend',
      'Frontend'
    );
    expect(matchedSkills).toHaveLength(2);
    expect(roleMatched).toBe(true);
    expect(s).toBeCloseTo(0.6, 10);
  });

  it('gives S=0.5 for 2 of 4 tags without role match', () => {
    const { s, roleMatched } = computeSkillCoverage(
      ['React', 'TypeScript', 'CSS', 'Testing'],
      ['React', 'TypeScript'],
      'Frontend',
      'Backend'
    );
    expect(roleMatched).toBe(false);
    expect(s).toBeCloseTo(0.5, 10);
  });

  it('gives S=1 before cap when required tags are empty', () => {
    const { s } = computeSkillCoverage([], ['Anything'], 'Frontend', 'Backend');
    expect(s).toBe(1);
  });

  it('still caps at 1 when empty required tags combine with role match', () => {
    const { s, roleMatched } = computeSkillCoverage([], [], 'Frontend', 'Frontend');
    expect(roleMatched).toBe(true);
    expect(s).toBe(1);
  });

  it('matches skill tags case-insensitively and ignores duplicates in required list', () => {
    const { s, matchedSkills } = computeSkillCoverage(
      ['React', 'react', 'REACT'],
      ['REACT'],
      null,
      null
    );
    expect(matchedSkills).toEqual(['react']);
    expect(s).toBeCloseTo(1, 10);
  });

  it('scores S=0 when required tags exist but candidate skills are missing (not invented)', () => {
    const { s, missingSkillsInput } = computeSkillCoverage(
      ['React'],
      null,
      'Frontend',
      'Frontend'
    );
    expect(missingSkillsInput).toBe(true);
    // Role multiplier still applies to coverage 0 → 0.
    expect(s).toBe(0);
  });
});

describe('FR-045 goal alignment', () => {
  it('returns G=1 for identical goals', () => {
    expect(computeGoalAlignment('Learning', 'Learning').g).toBe(1);
  });

  it('returns G=0.5 for Learning ↔ Project Completion', () => {
    expect(computeGoalAlignment('Learning', 'Project Completion').g).toBe(0.5);
    expect(computeGoalAlignment('Project Completion', 'Learning').g).toBe(0.5);
  });

  it('returns G=0.5 for Project Completion ↔ Competitive', () => {
    expect(computeGoalAlignment('Project Completion', 'Competitive').g).toBe(0.5);
    expect(computeGoalAlignment('Competitive', 'Project Completion').g).toBe(0.5);
  });

  it('returns G=0 for Learning ↔ Competitive', () => {
    expect(computeGoalAlignment('Learning', 'Competitive').g).toBe(0);
    expect(computeGoalAlignment('Competitive', 'Learning').g).toBe(0);
  });

  it('returns G=0 with missing flag when either goal is absent', () => {
    expect(computeGoalAlignment(null, 'Learning')).toEqual({ g: 0, missing: true });
    expect(computeGoalAlignment('Learning', undefined)).toEqual({ g: 0, missing: true });
    expect(computeGoalAlignment('', '')).toEqual({ g: 0, missing: true });
  });

  it('normalizes goal casing and whitespace', () => {
    expect(computeGoalAlignment('  project   completion ', 'PROJECT COMPLETION').g).toBe(1);
  });
});

describe('FR-045 hours alignment', () => {
  it('returns H=min(cand/req, 1)', () => {
    expect(computeHoursAlignment(20, 10).h).toBeCloseTo(0.5, 10);
    expect(computeHoursAlignment(20, 40).h).toBe(1);
  });

  it('returns H=1 when requested hours are 0', () => {
    expect(computeHoursAlignment(0, null)).toEqual({ h: 1, missing: false });
  });

  it('returns H=0 when requested hours are missing', () => {
    expect(computeHoursAlignment(null, 10)).toEqual({ h: 0, missing: true });
  });

  it('returns H=0 when candidate hours are missing and request > 0', () => {
    expect(computeHoursAlignment(10, null)).toEqual({ h: 0, missing: true });
  });
});

describe('FR-043 composite score', () => {
  it('yields display 70.0 for S=0.6, G=1, H=0.5 (FR-045 example)', () => {
    const result = computeCompatibilityScore(baseSlot, baseCandidate);
    expect(result.components.skill).toBeCloseTo(0.6, 10);
    expect(result.components.goal).toBe(1);
    expect(result.components.hours).toBeCloseTo(0.5, 10);
    expect(result.score).toBeCloseTo(70, 10);
    expect(result.displayScore).toBe('70.0');
    expect(result.roleMatched).toBe(true);
    expect(result.hadMissingInput).toBe(false);
    expect(result.contributions.skill).toMatch(/Matched 2 of 4/);
    expect(result.contributions.goal).toMatch(/Identical/);
    expect(result.contributions.hours).toMatch(/10h vs requested 20h/);
  });

  it('formats display to one decimal without changing ranking value', () => {
    expect(formatCompatibilityDisplayScore(70)).toBe('70.0');
    expect(formatCompatibilityDisplayScore(66.666)).toBe('66.7');
    expect(formatCompatibilityDisplayScore(0)).toBe('0.0');
    expect(formatCompatibilityDisplayScore(100)).toBe('100.0');
  });

  it('scores missing component inputs as 0 and flags hadMissingInput', () => {
    const result = computeCompatibilityScore(
      { role: 'Backend', requiredSkills: ['Go'], requestedHours: 15, goal: 'Competitive' },
      {
        primaryRole: 'Backend',
        skills: ['Go'],
        commitmentHours: null,
        goal: null,
      }
    );
    expect(result.components.goal).toBe(0);
    expect(result.components.hours).toBe(0);
    expect(result.hadMissingInput).toBe(true);
    expect(result.contributions.goal).toMatch(/scored 0/);
    expect(result.contributions.hours).toMatch(/scored 0/);
    // S = 1 (full tag match) with role → min(1.2, 1) = 1 → score = 100/3 ≈ 33.3
    expect(result.components.skill).toBe(1);
    expect(result.displayScore).toBe('33.3');
  });

  it('does not invent skills when candidate skills array is omitted', () => {
    const result = computeCompatibilityScore(baseSlot, {
      ...baseCandidate,
      skills: null,
    });
    expect(result.components.skill).toBe(0);
    expect(result.hadMissingInput).toBe(true);
  });
});

describe('validateCompatibilityScoreInputs (preserve caller data via field errors)', () => {
  it('accepts valid slot and candidate inputs', () => {
    expect(validateCompatibilityScoreInputs(baseSlot, baseCandidate)).toEqual({ ok: true });
  });

  it('returns field errors for invalid role, goal, and hours without inventing values', () => {
    const result = validateCompatibilityScoreInputs(
      {
        role: 'Wizard',
        requiredSkills: ['React'],
        requestedHours: 999,
        goal: 'World Domination',
      },
      {
        primaryRole: 'Necromancer',
        skills: ['React'],
        commitmentHours: -1,
        goal: 'Chaos',
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.role).toMatch(/Frontend/);
    expect(result.errors.goal).toMatch(/Learning/);
    expect(result.errors.requestedHours).toMatch(/168/);
    expect(result.errors.primaryRole).toMatch(/Backend/);
    expect(result.errors.candidateGoal).toMatch(/Competitive/);
    expect(result.errors.commitmentHours).toMatch(/168/);
  });

  it('allows omitted optionals (scored as 0 later) without validation failure', () => {
    const result = validateCompatibilityScoreInputs(
      { role: null, requiredSkills: null, requestedHours: null, goal: null },
      { primaryRole: null, skills: null, commitmentHours: null, goal: null }
    );
    expect(result).toEqual({ ok: true });
  });
});

describe('FR-043 ranking and tie-break', () => {
  it('ranks by unrounded score, then display handle, then internal id', () => {
    const slot: SlotScoringInput = {
      role: 'Backend',
      requiredSkills: [],
      requestedHours: 0,
      goal: 'Learning',
    };
    // Empty skills + requested 0 → S=1, H=1; goal match → G=1 → all score 100 when goals match.
    const ranked = rankCandidatesByCompatibility(slot, [
      {
        primaryRole: 'Backend',
        skills: [],
        commitmentHours: 0,
        goal: 'Learning',
        displayHandle: 'zoe',
        internalId: 'id-2',
      },
      {
        primaryRole: 'Backend',
        skills: [],
        commitmentHours: 0,
        goal: 'Learning',
        displayHandle: 'amy',
        internalId: 'id-1',
      },
      {
        primaryRole: 'Backend',
        skills: [],
        commitmentHours: 0,
        goal: 'Competitive', // G=0 → lower score
        displayHandle: 'aaa',
        internalId: 'id-0',
      },
    ]);

    expect(ranked.map((r) => r.displayHandle)).toEqual(['amy', 'zoe', 'aaa']);
    expect(ranked[0].score).toBeGreaterThan(ranked[2].score);
    expect(ranked.every((r) => !('password' in r))).toBe(true);
  });

  it('breaks equal scores by handle then internal id', () => {
    const a = {
      score: 50,
      displayScore: '50.0',
      components: { skill: 0.5, goal: 0.5, hours: 0.5 },
      matchedSkills: [],
      roleMatched: false,
      hadMissingInput: false,
      contributions: { skill: '', goal: '', hours: '' },
      displayHandle: 'bob',
      internalId: 'b',
    };
    const b = { ...a, displayHandle: 'bob', internalId: 'a' };
    const c = { ...a, displayHandle: 'Ann', internalId: 'z' };
    const sorted = [a, b, c].sort(compareCompatibilityResults);
    expect(sorted.map((r) => `${r.displayHandle}:${r.internalId}`)).toEqual([
      'Ann:z',
      'bob:a',
      'bob:b',
    ]);
  });

  it('throws field errors on invalid candidate input so callers can preserve form state', () => {
    expect(() =>
      rankCandidatesByCompatibility(baseSlot, [
        {
          ...baseCandidate,
          primaryRole: 'NotARole',
          internalId: 'x',
        },
      ])
    ).toThrow(/Validation failed/);

    try {
      rankCandidatesByCompatibility(baseSlot, [
        { ...baseCandidate, primaryRole: 'NotARole', internalId: 'x' },
      ]);
    } catch (e) {
      const err = e as { status: number; errors: { primaryRole?: string } };
      expect(err.status).toBe(400);
      expect(err.errors.primaryRole).toBeTruthy();
    }
  });
});

import { describe, it, expect } from 'vitest';
import {
  COMPATIBILITY_SCORE_MAX,
  COMPATIBILITY_SCORE_MIN,
  boundCompatibilityScore,
  compareCompatibilityResults,
  computeCompatibilityScore,
  formatCompatibilityDisplayScore,
  isCompatibilityScoreInBounds,
  rankCandidatesByCompatibility,
  sortWithCompatibilityRanks,
} from './compatibilityScoring.js';

describe('boundCompatibilityScore / display (FR-043 0–100)', () => {
  it('clamps below 0 and above 100', () => {
    expect(boundCompatibilityScore(-5)).toBe(COMPATIBILITY_SCORE_MIN);
    expect(boundCompatibilityScore(105)).toBe(COMPATIBILITY_SCORE_MAX);
    expect(boundCompatibilityScore(70)).toBe(70);
  });

  it('maps non-finite values to 0', () => {
    expect(boundCompatibilityScore(Number.NaN)).toBe(0);
    expect(boundCompatibilityScore(Number.POSITIVE_INFINITY)).toBe(0);
    expect(boundCompatibilityScore(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('formats display to one decimal within 0.0–100.0', () => {
    expect(formatCompatibilityDisplayScore(-1)).toBe('0.0');
    expect(formatCompatibilityDisplayScore(100.9)).toBe('100.0');
    expect(formatCompatibilityDisplayScore(66.666)).toBe('66.7');
    expect(formatCompatibilityDisplayScore(Number.NaN)).toBe('0.0');
  });

  it('reports in-bounds correctly', () => {
    expect(isCompatibilityScoreInBounds(0)).toBe(true);
    expect(isCompatibilityScoreInBounds(100)).toBe(true);
    expect(isCompatibilityScoreInBounds(70.5)).toBe(true);
    expect(isCompatibilityScoreInBounds(-0.01)).toBe(false);
    expect(isCompatibilityScoreInBounds(100.01)).toBe(false);
    expect(isCompatibilityScoreInBounds(Number.NaN)).toBe(false);
  });

  it('computeCompatibilityScore always returns a bounded score', () => {
    const perfect = computeCompatibilityScore(
      { role: 'Frontend', requiredSkills: [], requestedHours: 0, goal: 'Learning' },
      {
        primaryRole: 'Frontend',
        skills: [],
        commitmentHours: 0,
        goal: 'Learning',
      }
    );
    expect(perfect.score).toBe(100);
    expect(perfect.displayScore).toBe('100.0');
    expect(isCompatibilityScoreInBounds(perfect.score)).toBe(true);

    const zeroish = computeCompatibilityScore(
      { role: 'Backend', requiredSkills: ['Go'], requestedHours: 20, goal: 'Competitive' },
      {
        primaryRole: null,
        skills: null,
        commitmentHours: null,
        goal: null,
      }
    );
    expect(zeroish.score).toBe(0);
    expect(zeroish.displayScore).toBe('0.0');
  });
});

describe('FR-043 tie-breaking', () => {
  const base = {
    displayScore: '50.0',
    components: { skill: 0.5, goal: 0.5, hours: 0.5 },
    matchedSkills: [] as string[],
    roleMatched: false,
    hadMissingInput: false,
    contributions: { skill: '', goal: '', hours: '' },
  };

  it('orders equal scores by display handle then internal id', () => {
    const rows = sortWithCompatibilityRanks([
      { ...base, score: 50, displayHandle: 'bob', internalId: 'b' },
      { ...base, score: 50, displayHandle: 'bob', internalId: 'a' },
      { ...base, score: 50, displayHandle: 'Ann', internalId: 'z' },
      { ...base, score: 80, displayHandle: 'zzz', internalId: 'z' },
    ]);

    expect(rows.map((r) => `${r.rank}:${r.displayHandle}:${r.internalId}`)).toEqual([
      '1:zzz:z',
      '2:Ann:z',
      '3:bob:a',
      '4:bob:b',
    ]);
  });

  it('compareCompatibilityResults bounds scores before comparing', () => {
    const high = { ...base, score: 150, displayHandle: 'a', internalId: '1' };
    const mid = { ...base, score: 50, displayHandle: 'a', internalId: '2' };
    expect(compareCompatibilityResults(high, mid)).toBeLessThan(0);
  });

  it('rankCandidatesByCompatibility assigns 1-based ranks and keeps scores in bounds', () => {
    const ranked = rankCandidatesByCompatibility(
      { role: 'Backend', requiredSkills: [], requestedHours: 0, goal: 'Learning' },
      [
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
      ]
    );

    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
    expect(ranked.map((r) => r.displayHandle)).toEqual(['amy', 'zoe']);
    expect(ranked.every((r) => isCompatibilityScoreInBounds(r.score))).toBe(true);
    expect(ranked.every((r) => r.score === 100)).toBe(true);
  });
});

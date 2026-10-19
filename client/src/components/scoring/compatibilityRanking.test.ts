import { describe, it, expect } from 'vitest';
import {
  TIE_BREAK_NOTICE,
  boundCompatibilityScore,
  formatCompatibilityDisplayScore,
  formatRankedCandidateLine,
  isCompatibilityScoreInBounds,
} from './compatibilityRanking';

describe('compatibilityRanking (FR-043 bounds + display)', () => {
  it('bounds and formats scores to 0.0–100.0', () => {
    expect(boundCompatibilityScore(-3)).toBe(0);
    expect(boundCompatibilityScore(110)).toBe(100);
    expect(formatCompatibilityDisplayScore(70)).toBe('70.0');
    expect(isCompatibilityScoreInBounds(100)).toBe(true);
    expect(isCompatibilityScoreInBounds(101)).toBe(false);
  });

  it('formats ranked lines without internal identifiers', () => {
    expect(
      formatRankedCandidateLine({
        rank: 1,
        displayScore: '83.3',
        handle: 'amy',
        displayName: 'Amy',
      })
    ).toBe('#1 amy — 83.3');
    expect(TIE_BREAK_NOTICE).toMatch(/display handle/);
    expect(TIE_BREAK_NOTICE.toLowerCase()).not.toMatch(/uuid/);
  });
});

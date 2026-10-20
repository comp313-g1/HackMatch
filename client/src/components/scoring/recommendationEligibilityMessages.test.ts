import { describe, it, expect } from 'vitest';
import {
  EMPTY_RECOMMENDATIONS_MESSAGE,
  EXCLUSION_EMPTY_HINT,
  formatExclusionSummary,
} from './recommendationEligibilityMessages';

describe('recommendationEligibilityMessages', () => {
  it('exposes empty-state copy that names FR-046 exclusions', () => {
    expect(EMPTY_RECOMMENDATIONS_MESSAGE).toContain('No eligible candidates');
    expect(EMPTY_RECOMMENDATIONS_MESSAGE).toContain(EXCLUSION_EMPTY_HINT);
  });

  it('returns null when nothing was excluded', () => {
    expect(
      formatExclusionSummary({
        inactive: 0,
        unavailable: 0,
        confirmed: 0,
        owner: 0,
        totalExcluded: 0,
      })
    ).toBeNull();
  });

  it('formats exclusion tallies for owner-visible outcomes', () => {
    expect(
      formatExclusionSummary({
        inactive: 1,
        unavailable: 2,
        confirmed: 3,
        owner: 0,
        totalExcluded: 6,
      })
    ).toBe(
      'Excluded from recommendations: 1 inactive, 2 not Looking for Team, 3 already confirmed on this team.'
    );
  });
});

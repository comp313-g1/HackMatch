/**
 * User-visible copy for US-015 / FR-046 recommendation eligibility outcomes.
 * Mirrors server exclusion summary — does not invent candidate rows.
 */

export interface RecommendationExclusionSummary {
  inactive: number;
  unavailable: number;
  confirmed: number;
  owner: number;
  totalExcluded: number;
}

export const EXCLUSION_EMPTY_HINT =
  'Inactive accounts, participants not Looking for Team, and anyone already confirmed for this event are excluded.';

export const EMPTY_RECOMMENDATIONS_MESSAGE = `No eligible candidates found for this open slot. ${EXCLUSION_EMPTY_HINT}`;

/** Formats exclusion tallies for an owner-facing empty or footer notice. */
export function formatExclusionSummary(
  exclusions: RecommendationExclusionSummary | null | undefined
): string | null {
  if (!exclusions || exclusions.totalExcluded <= 0) return null;
  const parts: string[] = [];
  if (exclusions.inactive > 0) {
    parts.push(`${exclusions.inactive} inactive`);
  }
  if (exclusions.unavailable > 0) {
    parts.push(`${exclusions.unavailable} not Looking for Team`);
  }
  if (exclusions.confirmed > 0) {
    parts.push(`${exclusions.confirmed} already confirmed for this event`);
  }
  if (parts.length === 0) return EXCLUSION_EMPTY_HINT;
  return `Excluded from recommendations: ${parts.join(', ')}.`;
}

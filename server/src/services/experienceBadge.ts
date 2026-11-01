import type { ExperienceBadge, ParticipantHackathonHistory } from '../db/types.js';

export const SELF_REPORTED_HISTORY_NOTICE =
  'Self-reported experience badge and hackathon history — not independently verified.';

export interface ExperienceBadgeSummary {
  hackathonCount: number;
  experienceBadge: ExperienceBadge;
  experienceBadgeSelfReported: true;
  selfReportedNotice: string;
}

/**
 * Computes self-reported experience badge tier based on hackathon record count:
 * - 0 records: Beginner
 * - 1 to 3 records: Competitor
 * - 4 or more records: Veteran
 */
export function computeExperienceBadge(recordCount: number): ExperienceBadge {
  const normalizedCount = Number.isFinite(recordCount) ? Math.max(0, Math.floor(recordCount)) : 0;
  if (normalizedCount === 0) {
    return 'Beginner';
  }
  if (normalizedCount <= 3) {
    return 'Competitor';
  }
  return 'Veteran';
}

/**
 * Derives the complete experience summary with badge tier, count, and disclaimer.
 */
export function buildExperienceSummary(
  records: Pick<ParticipantHackathonHistory, 'id'>[] | number
): ExperienceBadgeSummary {
  const count = typeof records === 'number' ? Math.max(0, Math.floor(records)) : records.length;
  return {
    hackathonCount: count,
    experienceBadge: computeExperienceBadge(count),
    experienceBadgeSelfReported: true,
    selfReportedNotice: SELF_REPORTED_HISTORY_NOTICE,
  };
}

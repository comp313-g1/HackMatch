/**
 * Client helpers for US-015 FR-043 bounded scores and tie-break display.
 * Server remains authoritative for ranking; these mirror display contracts.
 */

export const COMPATIBILITY_SCORE_MIN = 0;
export const COMPATIBILITY_SCORE_MAX = 100;

export const TIE_BREAK_NOTICE =
  'When scores match, candidates are ordered by display handle, then a private identifier (not shown).';

export function boundCompatibilityScore(score: number): number {
  if (!Number.isFinite(score)) return COMPATIBILITY_SCORE_MIN;
  return Math.min(COMPATIBILITY_SCORE_MAX, Math.max(COMPATIBILITY_SCORE_MIN, score));
}

export function isCompatibilityScoreInBounds(score: number): boolean {
  return (
    Number.isFinite(score) &&
    score >= COMPATIBILITY_SCORE_MIN &&
    score <= COMPATIBILITY_SCORE_MAX
  );
}

export function formatCompatibilityDisplayScore(score: number): string {
  return boundCompatibilityScore(score).toFixed(1);
}

export interface RankedCandidateDisplay {
  rank?: number;
  displayScore?: string;
  score?: number;
  handle: string | null;
  displayName: string;
}

/** Builds a short owner-visible line for one ranked row (no internal ids). */
export function formatRankedCandidateLine(candidate: RankedCandidateDisplay): string {
  const name = candidate.handle?.trim() || candidate.displayName;
  const scoreLabel =
    candidate.displayScore ??
    (candidate.score !== undefined ? formatCompatibilityDisplayScore(candidate.score) : null);

  if (candidate.rank != null && scoreLabel != null) {
    return `#${candidate.rank} ${name} — ${scoreLabel}`;
  }
  if (scoreLabel != null) {
    return `${name} — ${scoreLabel}`;
  }
  return name;
}

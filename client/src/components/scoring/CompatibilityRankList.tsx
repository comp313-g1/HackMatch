import { TIE_BREAK_NOTICE, formatRankedCandidateLine } from './compatibilityRanking';

export interface CompatibilityRankListItem {
  rank?: number;
  displayScore?: string;
  score?: number;
  handle: string | null;
  displayName: string;
  participantId: string;
}

interface CompatibilityRankListProps {
  candidates: CompatibilityRankListItem[];
  emptyMessage?: string;
  /** When true, scores were not applied (NR-016 degraded). */
  unranked?: boolean;
}

/**
 * Owner-visible ranked recommendation rows (FR-043 bounds + tie order).
 * Does not render internal ids; parents keep form/list state on errors.
 */
export function CompatibilityRankList({
  candidates,
  emptyMessage = 'No eligible candidates to rank.',
  unranked = false,
}: CompatibilityRankListProps) {
  if (candidates.length === 0) {
    return (
      <div role="status" data-testid="compatibility-rank-empty">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div data-testid="compatibility-rank-list">
      {!unranked ? <p data-testid="tie-break-notice">{TIE_BREAK_NOTICE}</p> : null}
      {unranked ? (
        <p role="status">Scores unavailable — showing eligible candidates without ranking.</p>
      ) : null}
      <ol start={1}>
        {candidates.map((c) => (
          <li key={c.participantId}>
            {unranked
              ? c.handle?.trim() || c.displayName
              : formatRankedCandidateLine(c)}
          </li>
        ))}
      </ol>
    </div>
  );
}

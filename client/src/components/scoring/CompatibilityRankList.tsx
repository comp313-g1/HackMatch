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
  /** Set false when a parent already shows the degraded notice. */
  showUnrankedBanner?: boolean;
}

/**
 * Owner-visible ranked recommendation rows (FR-043 bounds + tie order).
 * Does not render internal ids; parents keep form/list state on errors.
 */
export function CompatibilityRankList({
  candidates,
  emptyMessage = 'No eligible candidates to rank.',
  unranked = false,
  showUnrankedBanner = true,
}: CompatibilityRankListProps) {
  if (candidates.length === 0) {
    return (
      <div role="status" data-testid="compatibility-rank-empty" className="text-xs text-ink-muted">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div data-testid="compatibility-rank-list" className="space-y-2 text-xs text-ink">
      {!unranked ? (
        <p data-testid="tie-break-notice" className="text-ink-muted">
          {TIE_BREAK_NOTICE}
        </p>
      ) : null}
      {unranked && showUnrankedBanner ? (
        <p role="status" className="text-amber-900">
          Scores unavailable — showing eligible candidates without ranking.
        </p>
      ) : null}
      <ol start={1} className="list-decimal list-inside space-y-1.5 font-medium text-forest-900">
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

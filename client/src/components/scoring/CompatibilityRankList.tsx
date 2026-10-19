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
  /** FR-048: open US-017 invite draft for an eligible candidate. */
  onInvite?: (candidate: CompatibilityRankListItem) => void;
  /** Participant ids that already have a pending invite from this session. */
  invitedParticipantIds?: ReadonlySet<string>;
  /** Participant id whose invite draft is open. */
  invitingParticipantId?: string | null;
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
  onInvite,
  invitedParticipantIds,
  invitingParticipantId = null,
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
      <ol start={1} className="list-none space-y-2 font-medium text-forest-900">
        {candidates.map((c) => {
          const alreadyInvited = invitedParticipantIds?.has(c.participantId) ?? false;
          const isDrafting = invitingParticipantId === c.participantId;
          const line = unranked
            ? c.handle?.trim() || c.displayName
            : formatRankedCandidateLine(c);

          return (
            <li
              key={c.participantId}
              className="flex flex-wrap items-center justify-between gap-2"
              data-testid={`rank-row-${c.participantId}`}
            >
              <span>{line}</span>
              {onInvite ? (
                <button
                  type="button"
                  onClick={() => onInvite(c)}
                  disabled={alreadyInvited || isDrafting}
                  className="px-2.5 py-1 text-xs font-semibold text-forest-900 border border-forest-300 rounded bg-white hover:bg-forest-50 disabled:opacity-50"
                  data-testid={`invite-candidate-${c.participantId}`}
                >
                  {alreadyInvited ? 'Invited' : isDrafting ? 'Inviting…' : 'Invite'}
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

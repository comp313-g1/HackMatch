import React from 'react';
import type { ModerationCaseView, ModerationListState } from './moderationTypes';

export interface ModerationQueueViewProps {
  cases: ModerationCaseView[];
  listState: ModerationListState;
  listError: string | null;
  selectedCaseId: string | null;
  onSelect: (caseId: string) => void;
  onRetry: () => void;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function targetLabel(c: ModerationCaseView): string {
  const kind = c.targetType === 'url' ? 'URL' : c.targetType === 'team' ? 'Team' : 'Profile';
  return `${kind} · ${c.targetId.slice(0, 8)}…`;
}

/**
 * Newest-first safety queue rows (US-026 / #241 / FR-075).
 * Loading, empty, error, and success states; selection opens case view.
 */
export function ModerationQueueView({
  cases,
  listState,
  listError,
  selectedCaseId,
  onSelect,
  onRetry,
}: ModerationQueueViewProps): React.JSX.Element {
  return (
    <div className="space-y-3" data-testid="moderation-queue-view" aria-label="Moderation safety queue">
      {listState === 'loading' && cases.length === 0 ? (
        <p role="status" className="text-sm text-forest-800" data-testid="moderation-queue-loading">
          Loading moderation queue…
        </p>
      ) : null}

      {listState === 'loading' && cases.length > 0 ? (
        <p role="status" className="text-xs text-ink-muted" data-testid="moderation-queue-refreshing">
          Refreshing queue…
        </p>
      ) : null}

      {listState === 'error' ? (
        <div
          role="alert"
          className="text-sm text-red-800 space-y-2 p-3 bg-red-50 border border-red-200 rounded-md"
          data-testid="moderation-queue-error"
        >
          <p>{listError || 'Could not load the moderation queue.'}</p>
          <p className="text-xs">Your previous queue results were kept when available.</p>
          <button
            type="button"
            onClick={onRetry}
            className="px-3 py-1.5 text-xs font-medium border border-red-200 rounded bg-white hover:bg-red-50"
          >
            Retry
          </button>
        </div>
      ) : null}

      {listState === 'success' && cases.length === 0 ? (
        <div
          role="status"
          className="p-6 text-center text-sm text-ink-muted border border-dashed border-cream-300 rounded-md"
          data-testid="moderation-queue-empty"
        >
          No moderation cases yet. Open a case below to start the safety queue.
        </div>
      ) : null}

      {cases.length > 0 ? (
        <ul className="space-y-2" data-testid="moderation-queue-list">
          {cases.map((c) => {
            const selected = c.id === selectedCaseId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  aria-pressed={selected}
                  data-testid={`moderation-case-row-${c.id}`}
                  className={`w-full text-left rounded-md border px-3 py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-1 ${
                    selected
                      ? 'border-forest-400 bg-forest-50'
                      : 'border-cream-200 bg-white hover:bg-cream-50'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-0.5 min-w-0">
                      <p className="font-medium text-forest-900 truncate">{targetLabel(c)}</p>
                      <p className="text-xs text-ink line-clamp-2">{c.reason}</p>
                      <p className="text-xs text-ink-muted" data-testid={`moderation-case-time-${c.id}`}>
                        {formatWhen(c.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border border-cream-300 text-ink">
                        {c.status}
                      </span>
                      {c.reportCount > 0 ? (
                        <span
                          className="text-[10px] text-ink-muted"
                          data-testid={`moderation-report-count-${c.id}`}
                        >
                          {c.reportCount} report{c.reportCount === 1 ? '' : 's'}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

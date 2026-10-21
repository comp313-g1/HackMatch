import React from 'react';
import type { ModerationActionRecordView, ModerationRecordsState } from './moderationTypes';

export interface ModerationActionRecordPanelProps {
  records: ModerationActionRecordView[];
  recordsState: ModerationRecordsState;
  recordsError: string | null;
  onRetry: () => void;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function actionLabel(actionType: string): string {
  return actionType.replace(/^moderation_/, '').replace(/_/g, ' ');
}

/**
 * Displays safe FR-079 action records for a moderation case (#243 / US-026 AC 2 & 4).
 * Loading / empty / success / error states; never shows credentials or private contacts.
 */
export function ModerationActionRecordPanel({
  records,
  recordsState,
  recordsError,
  onRetry,
}: ModerationActionRecordPanelProps): React.JSX.Element {
  if (recordsState === 'idle') {
    return (
      <div
        role="status"
        className="p-4 text-sm text-ink-muted border border-dashed border-cream-300 rounded-md"
        data-testid="moderation-records-idle"
      >
        Select a case to view its safe action records.
      </div>
    );
  }

  return (
    <section
      className="space-y-3 rounded-md border border-cream-200 bg-white p-4"
      data-testid="moderation-action-records"
      aria-labelledby="moderation-records-heading"
    >
      <div>
        <h3
          id="moderation-records-heading"
          className="font-display text-base font-semibold text-forest-900"
        >
          Safe action records
        </h3>
        <p className="text-xs text-ink-muted mt-0.5">
          Each decision stores actor outcome, reason, and a safe state summary — without credentials
          or private contacts.
        </p>
      </div>

      {recordsState === 'loading' && records.length === 0 ? (
        <p role="status" className="text-sm text-forest-800" data-testid="moderation-records-loading">
          Loading action records…
        </p>
      ) : null}

      {recordsState === 'loading' && records.length > 0 ? (
        <p role="status" className="text-xs text-ink-muted" data-testid="moderation-records-refreshing">
          Refreshing action records…
        </p>
      ) : null}

      {recordsState === 'error' ? (
        <div
          role="alert"
          className="text-sm text-red-800 space-y-2 p-3 bg-red-50 border border-red-200 rounded-md"
          data-testid="moderation-records-error"
        >
          <p>{recordsError || 'Could not load action records.'}</p>
          <button
            type="button"
            onClick={onRetry}
            className="px-3 py-1.5 text-xs font-medium border border-red-200 rounded bg-white hover:bg-red-50"
          >
            Retry
          </button>
        </div>
      ) : null}

      {recordsState === 'success' && records.length === 0 ? (
        <div
          role="status"
          className="p-4 text-center text-sm text-ink-muted border border-dashed border-cream-300 rounded-md"
          data-testid="moderation-records-empty"
        >
          No action records yet. Apply a decision with a reason to create one.
        </div>
      ) : null}

      {records.length > 0 ? (
        <ul className="space-y-2" data-testid="moderation-records-list">
          {records.map((record) => (
            <li
              key={record.id}
              className="rounded-md border border-cream-200 px-3 py-2 text-xs space-y-1"
              data-testid={`moderation-record-${record.id}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-forest-900 uppercase tracking-wide">
                  {actionLabel(record.actionType)}
                </span>
                <time className="text-ink-muted" dateTime={record.createdAt}>
                  {formatWhen(record.createdAt)}
                </time>
              </div>
              <p data-testid={`moderation-record-reason-${record.id}`}>
                <span className="text-ink-muted">Reason: </span>
                {record.reason}
              </p>
              <p data-testid={`moderation-record-outcome-${record.id}`}>
                <span className="text-ink-muted">Outcome: </span>
                {record.outcome}
              </p>
              <p className="text-ink-muted" data-testid={`moderation-record-safe-${record.id}`}>
                Safe summary: credentials excluded · private contacts excluded
                {record.safeStateSummary.credentialsIncluded === true ||
                record.safeStateSummary.privateContactsIncluded === true
                  ? ' (warning: unexpected flags)'
                  : ''}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

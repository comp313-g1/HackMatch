import React from 'react';
import type { MyApplicationListItem } from './applicationsApi';
import { cancelReasonLabel } from './requestCancelReason';

export type ApplicationListState = 'loading' | 'success' | 'error';

export interface MyApplicationsViewProps {
  applications: MyApplicationListItem[];
  listState: ApplicationListState;
  emptyMessage: string | null;
  listError: string | null;
  disabled?: boolean;
  withdrawingId: string | null;
  onRetry: () => void;
  onWithdraw: (applicationId: string) => void;
}

/**
 * Applicant My Applications list (US-018 / #175) — status inspect + withdraw.
 */
export function MyApplicationsView({
  applications,
  listState,
  emptyMessage,
  listError,
  disabled = false,
  withdrawingId,
  onRetry,
  onWithdraw,
}: MyApplicationsViewProps): React.JSX.Element {
  return (
    <div className="space-y-2" data-testid="my-applications-view" aria-label="My applications">
      {listState === 'loading' && applications.length === 0 ? (
        <p role="status" className="text-xs text-forest-800" data-testid="applications-loading">
          Loading applications…
        </p>
      ) : null}

      {listState === 'loading' && applications.length > 0 ? (
        <p role="status" className="text-xs text-ink-muted" data-testid="applications-refreshing">
          Refreshing applications…
        </p>
      ) : null}

      {listState === 'error' ? (
        <div
          role="alert"
          className="text-xs text-red-800 space-y-2"
          data-testid="applications-list-error"
        >
          <p>{listError}</p>
          <p>Your application list was kept.</p>
          <button
            type="button"
            onClick={onRetry}
            className="px-3 py-1 text-xs font-medium border border-red-200 rounded bg-white hover:bg-red-50"
          >
            Retry
          </button>
        </div>
      ) : null}

      {listState === 'success' && applications.length === 0 ? (
        <div
          role="status"
          className="p-4 text-center text-xs text-ink-muted border border-dashed border-cream-300 rounded-md"
          data-testid="applications-empty"
        >
          {emptyMessage || 'No applications yet.'}
        </div>
      ) : null}

      {applications.length > 0 ? (
        <ul className="space-y-2" data-testid="applications-list">
          {applications.map((app) => (
            <li
              key={app.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-cream-200 px-3 py-2 text-xs"
              data-testid={`application-row-${app.id}`}
            >
              <div className="space-y-0.5">
                <p className="font-medium text-forest-900">
                  {app.teamName}
                  {app.vacancyRole ? (
                    <span className="font-normal text-ink-muted"> · {app.vacancyRole}</span>
                  ) : null}
                </p>
                <p className="text-ink-muted">
                  Status:{' '}
                  <span data-testid={`application-status-${app.id}`}>
                    {app.statusLabel || app.status}
                  </span>
                  {' · '}
                  Submitted {new Date(app.createdAt).toLocaleString()}
                </p>
                {cancelReasonLabel(app.cancelReason) ? (
                  <p
                    className="text-amber-900/90"
                    data-testid={`application-cancel-reason-${app.id}`}
                  >
                    {cancelReasonLabel(app.cancelReason)}
                  </p>
                ) : null}
                {app.message ? (
                  <p className="text-ink" data-testid={`application-message-${app.id}`}>
                    Message: {app.message}
                  </p>
                ) : null}
              </div>
              {app.withdrawable ? (
                <button
                  type="button"
                  onClick={() => onWithdraw(app.id)}
                  disabled={disabled || withdrawingId === app.id}
                  className="px-2 py-1 text-xs font-medium border border-cream-300 rounded bg-white hover:bg-cream-50 disabled:opacity-50"
                  data-testid={`withdraw-application-${app.id}`}
                >
                  {withdrawingId === app.id ? 'Withdrawing…' : 'Withdraw'}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

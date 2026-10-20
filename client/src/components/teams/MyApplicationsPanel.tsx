import React, { useCallback, useEffect, useState } from 'react';
import { MyApplicationsView, type ApplicationListState } from './MyApplicationsView';
import {
  ApplicationsApiError,
  AuthRequiredError,
  fetchMyApplications,
  withdrawTeamApplication,
  type MyApplicationListItem,
} from './applicationsApi';

export interface MyApplicationsPanelProps {
  disabled?: boolean;
  /** Bump to force a refetch (e.g. after a successful apply elsewhere). */
  refreshKey?: number;
  onStatusNotice?: (notice: string) => void;
}

/**
 * Stateful US-018 / #175 My Applications panel: status list, withdraw, owner/applicant alerts.
 * List content is preserved on withdraw failures (NR-017).
 */
export function MyApplicationsPanel({
  disabled = false,
  refreshKey = 0,
  onStatusNotice,
}: MyApplicationsPanelProps): React.JSX.Element {
  const [applications, setApplications] = useState<MyApplicationListItem[]>([]);
  const [listState, setListState] = useState<ApplicationListState>('loading');
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [statusAlert, setStatusAlert] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setListState('loading');
    setListError(null);
    try {
      const result = await fetchMyApplications();
      setApplications(result.applications);
      setEmptyMessage(result.message);
      setListState('success');
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setListError('You need to sign in to view your applications.');
      } else if (err instanceof ApplicationsApiError) {
        setListError(err.message || 'Could not load applications.');
      } else {
        setListError('Could not load applications.');
      }
      setListState('error');
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList, refreshKey]);

  const handleWithdraw = async (applicationId: string) => {
    if (disabled || withdrawingId) return;
    setWithdrawError(null);
    setSuccessNotice(null);
    setStatusAlert(null);
    setWithdrawingId(applicationId);
    try {
      const result = await withdrawTeamApplication(applicationId);
      const applicantAlert = result.alerts.find((a) => a.audience === 'applicant');
      const ownerAlert = result.alerts.find((a) => a.audience === 'owner');
      setSuccessNotice(result.notice);
      setStatusAlert(
        applicantAlert?.message ??
          ownerAlert?.message ??
          'Application status updated to Withdrawn. The team owner has been notified.'
      );
      onStatusNotice?.(result.notice);
      await loadList();
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setWithdrawError('You need to sign in to withdraw an application.');
      } else if (err instanceof ApplicationsApiError) {
        setWithdrawError(
          err.message ||
            'Could not withdraw application. If this persists, apply migration 0024 and restart the API.'
        );
      } else {
        setWithdrawError('Could not withdraw application.');
      }
    } finally {
      setWithdrawingId(null);
    }
  };

  return (
    <section
      className="rounded-lg border border-cream-200 bg-white p-4 space-y-4 max-w-2xl mx-auto"
      data-testid="my-applications-panel"
      aria-label="My applications"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-forest-900 uppercase tracking-wide">
            My Applications
          </h3>
          <p className="text-xs text-ink-muted mt-1">
            Inspect Pending Review status and withdraw before a decision. Withdrawal notifies the
            team owner and frees one pending slot for that event.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadList()}
          disabled={listState === 'loading'}
          className="px-3 py-1 text-xs font-medium border border-cream-300 rounded bg-cream-50 hover:bg-cream-100 disabled:opacity-50"
          data-testid="refresh-applications"
        >
          {listState === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {successNotice ? (
        <div
          role="status"
          className="text-xs text-forest-900 bg-forest-50 border border-forest-100 rounded p-2"
          data-testid="application-withdraw-success"
        >
          {successNotice}
        </div>
      ) : null}

      {statusAlert ? (
        <div
          role="status"
          className="text-xs text-ink bg-cream-50 border border-cream-200 rounded p-2"
          data-testid="application-status-alert"
        >
          {statusAlert}
        </div>
      ) : null}

      {withdrawError ? (
        <div
          role="alert"
          className="text-xs text-red-800 space-y-1"
          data-testid="application-withdraw-error"
        >
          <p>{withdrawError}</p>
          <p>Your application list was kept.</p>
        </div>
      ) : null}

      <MyApplicationsView
        applications={applications}
        listState={listState}
        emptyMessage={emptyMessage}
        listError={listError}
        disabled={disabled}
        withdrawingId={withdrawingId}
        onRetry={() => void loadList()}
        onWithdraw={(id) => void handleWithdraw(id)}
      />
    </section>
  );
}

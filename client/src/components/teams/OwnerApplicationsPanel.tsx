import React, { useCallback, useEffect, useState } from 'react';
import {
  ApplicationsApiError,
  AuthRequiredError,
  approveTeamApplication,
  fetchTeamApplications,
  type ApplicationApprovalResult,
  type OwnerApplicationReviewItem,
} from './applicationsApi';
import { ApplicationReviewCard } from './ApplicationReviewCard';

export interface OwnerApplicationsPanelProps {
  teamId: string;
  refreshKey?: number;
  disabled?: boolean;
  onApproved?: (
    result: ApplicationApprovalResult,
    application: OwnerApplicationReviewItem
  ) => void;
}

/** US-020 / #188 / FR-060 — owner-only incoming application review queue. */
export function OwnerApplicationsPanel({
  teamId,
  refreshKey = 0,
  disabled = false,
  onApproved,
}: OwnerApplicationsPanelProps): React.JSX.Element {
  const [applications, setApplications] = useState<OwnerApplicationReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvalNotice, setApprovalNotice] = useState<string | null>(null);

  const loadApplications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTeamApplications(teamId);
      setApplications(result.applications);
      setEmptyMessage(result.message);
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError || (err instanceof ApplicationsApiError && err.status === 401)) {
        setError('You need to sign in to review applications.');
      } else if (err instanceof ApplicationsApiError && err.status === 403) {
        setError('Only the team owner can review incoming applications.');
      } else if (err instanceof ApplicationsApiError && err.status === 400) {
        setError(err.message || 'The application review request was invalid.');
      } else if (err instanceof ApplicationsApiError && err.code === 'NETWORK') {
        setError('Network error. Could not refresh incoming applications.');
      } else if (err instanceof ApplicationsApiError) {
        setError(err.message || 'Could not load incoming applications.');
      } else {
        setError('Could not load incoming applications.');
      }
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  const handleApprove = async (applicationId: string) => {
    if (disabled || approvingId) return;
    const application = applications.find((item) => item.id === applicationId);
    if (!application) return;

    setApprovingId(applicationId);
    setApprovalError(null);
    setApprovalNotice(null);
    try {
      const result = await approveTeamApplication(applicationId);
      setApplications((current) => {
        const remaining = result.cascade.teamNowFull
          ? []
          : current.filter(
              (item) =>
                item.id !== applicationId && item.vacancyId !== result.vacancy.id
            );
        if (remaining.length === 0) setEmptyMessage('No pending applications to review.');
        return remaining;
      });
      const cascade = result.cascade;
      const clearedCount =
        cascade.eventInvitationsCanceled +
        cascade.eventApplicationsWithdrawn +
        cascade.slotRequestsCanceled +
        cascade.teamRequestsCanceled;
      setApprovalNotice(
        clearedCount > 0
          ? `${result.notice} Cleared ${clearedCount} competing request${clearedCount === 1 ? '' : 's'}.`
          : result.notice
      );
      onApproved?.(result, application);
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError || (err instanceof ApplicationsApiError && err.status === 401)) {
        setApprovalError('You need to sign in before approving an application.');
      } else if (err instanceof ApplicationsApiError && err.status === 403) {
        setApprovalError('Only the team owner can approve this application.');
      } else if (err instanceof ApplicationsApiError) {
        setApprovalError(err.errors?._form || err.message || 'Could not approve this application.');
      } else {
        setApprovalError('Could not approve this application.');
      }
    } finally {
      setApprovingId(null);
    }
  };

  useEffect(() => {
    void loadApplications();
  }, [loadApplications, refreshKey]);

  const hasApplications = applications.length > 0;

  return (
    <section
      className="rounded-lg border border-cream-200 bg-white p-4 space-y-4"
      aria-label="Incoming applications"
      data-testid="owner-applications-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-forest-900 uppercase tracking-wide">
            Incoming Applications
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            Pending Review applications are shown newest first.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadApplications()}
          disabled={loading}
          className="px-3 py-1 text-xs font-medium border border-cream-300 rounded bg-cream-50 hover:bg-cream-100 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {loading && !hasApplications && (
        <div role="status" aria-live="polite" aria-busy="true" className="text-sm text-ink-muted">
          Loading pending applications…
        </div>
      )}

      {loading && hasApplications && (
        <p role="status" aria-live="polite" data-testid="applications-refreshing" className="text-xs text-ink-muted">
          Refreshing applications… Existing applications remain visible.
        </p>
      )}

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <p>{error}</p>
          {hasApplications && <p className="mt-1 text-xs">Previously loaded applications are still shown.</p>}
          <button
            type="button"
            onClick={() => void loadApplications()}
            className="mt-2 rounded border border-red-300 bg-white px-3 py-1 text-xs font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {approvalNotice ? (
        <div role="status" data-testid="application-approval-success" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {approvalNotice}
        </div>
      ) : null}

      {approvalError ? (
        <div role="alert" data-testid="application-approval-error" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <p>{approvalError}</p>
          <p className="mt-1 text-xs">The application and all review details were kept.</p>
        </div>
      ) : null}

      {!loading && !error && !hasApplications && (
        <div role="status" data-testid="applications-empty" className="rounded-md bg-cream-50 p-4 text-sm text-ink-muted">
          {emptyMessage || 'No pending applications to review.'}
        </div>
      )}

      {hasApplications && (
        <ul className="space-y-3" data-testid="applications-review-list">
          {applications.map((application) => (
            <ApplicationReviewCard
              key={application.id}
              application={application}
              approving={approvingId === application.id}
              disabled={disabled}
              onApprove={(id) => void handleApprove(id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

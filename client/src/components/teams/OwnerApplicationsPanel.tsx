import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApplicationsApiError,
  AuthRequiredError,
  approveTeamApplication,
  declineTeamApplication,
  fetchTeamApplications,
  type ApplicationDeclineResult,
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
  onDeclined?: (
    result: ApplicationDeclineResult,
    application: OwnerApplicationReviewItem
  ) => void;
}

function decisionFailureMessage(
  err: ApplicationsApiError,
  requestedDecision: 'approve' | 'decline'
): string {
  if (err.code === 'APPLICATION_DECISION_CONFLICT') {
    const outcome = err.details?.existingOutcome;
    const outcomeLabel =
      typeof outcome === 'string' ? `the ${outcome} outcome` : 'a final outcome';
    return `This application already has ${outcomeLabel} and cannot be ${
      requestedDecision === 'approve' ? 'approved' : 'declined'
    }. Refresh the review queue to see the latest state.`;
  }
  if (err.code === 'NETWORK') {
    return 'Network error. The decision was not confirmed; refresh the review queue before retrying.';
  }
  return (
    err.errors?._form ||
    err.message ||
    `Could not ${requestedDecision} this application.`
  );
}

function newestFirst(
  applications: OwnerApplicationReviewItem[]
): OwnerApplicationReviewItem[] {
  return [...applications].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return 0;
    return rightTime - leftTime;
  });
}

/** US-020 / #188 / #194 / FR-060 — owner-only application review and decisions. */
export function OwnerApplicationsPanel({
  teamId,
  refreshKey = 0,
  disabled = false,
  onApproved,
  onDeclined,
}: OwnerApplicationsPanelProps): React.JSX.Element {
  const [applications, setApplications] = useState<OwnerApplicationReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvalNotice, setApprovalNotice] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const decisionSequence = useRef(0);
  const visibleTeamId = useRef(teamId);

  const loadApplications = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTeamApplications(teamId);
      if (requestId !== requestSequence.current) return;
      if (result.teamId !== teamId) {
        setError('Could not verify the application review response for this team.');
        return;
      }
      setApplications(newestFirst(result.applications));
      setEmptyMessage(result.message);
    } catch (err: unknown) {
      if (requestId !== requestSequence.current) return;
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
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [teamId]);

  const handleApprove = async (applicationId: string) => {
    if (disabled || loading || approvingId || decliningId) return;
    const application = applications.find((item) => item.id === applicationId);
    if (!application) return;
    const decisionId = ++decisionSequence.current;
    const decisionTeamId = teamId;

    setApprovingId(applicationId);
    setApprovalError(null);
    setApprovalNotice(null);
    try {
      const result = await approveTeamApplication(applicationId);
      if (
        decisionId !== decisionSequence.current ||
        visibleTeamId.current !== decisionTeamId
      ) return;
      setApplications((current) => {
        const decidedVacancyId = result.vacancy?.id ?? application.vacancyId;
        const remaining = result.cascade.teamNowFull
          ? []
          : current.filter(
              (item) =>
                item.id !== applicationId &&
                (decidedVacancyId === null || item.vacancyId !== decidedVacancyId)
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
      if (
        decisionId !== decisionSequence.current ||
        visibleTeamId.current !== decisionTeamId
      ) return;
      if (err instanceof AuthRequiredError || (err instanceof ApplicationsApiError && err.status === 401)) {
        setApprovalError('You need to sign in before approving an application.');
      } else if (err instanceof ApplicationsApiError && err.status === 403) {
        setApprovalError('Only the team owner can approve this application.');
      } else if (err instanceof ApplicationsApiError) {
        setApprovalError(decisionFailureMessage(err, 'approve'));
      } else {
        setApprovalError('Could not approve this application.');
      }
    } finally {
      if (decisionId === decisionSequence.current) setApprovingId(null);
    }
  };

  const handleDecline = async (applicationId: string) => {
    if (disabled || loading || approvingId || decliningId) return;
    const application = applications.find((item) => item.id === applicationId);
    if (!application) return;
    const decisionId = ++decisionSequence.current;
    const decisionTeamId = teamId;

    setDecliningId(applicationId);
    setApprovalError(null);
    setApprovalNotice(null);
    try {
      const result = await declineTeamApplication(applicationId);
      if (
        decisionId !== decisionSequence.current ||
        visibleTeamId.current !== decisionTeamId
      ) return;
      setApplications((current) => {
        const remaining = current.filter((item) => item.id !== applicationId);
        if (remaining.length === 0) setEmptyMessage('No pending applications to review.');
        return remaining;
      });
      setApprovalNotice(result.notice);
      onDeclined?.(result, application);
    } catch (err: unknown) {
      if (
        decisionId !== decisionSequence.current ||
        visibleTeamId.current !== decisionTeamId
      ) return;
      if (err instanceof AuthRequiredError || (err instanceof ApplicationsApiError && err.status === 401)) {
        setApprovalError('You need to sign in before declining an application.');
      } else if (err instanceof ApplicationsApiError && err.status === 403) {
        setApprovalError('Only the team owner can decline this application.');
      } else if (err instanceof ApplicationsApiError) {
        setApprovalError(decisionFailureMessage(err, 'decline'));
      } else {
        setApprovalError('Could not decline this application.');
      }
    } finally {
      if (decisionId === decisionSequence.current) setDecliningId(null);
    }
  };

  useEffect(() => {
    if (visibleTeamId.current !== teamId) {
      decisionSequence.current += 1;
      visibleTeamId.current = teamId;
      setApplications([]);
      setEmptyMessage(null);
      setError(null);
      setApprovalError(null);
      setApprovalNotice(null);
      setApprovingId(null);
      setDecliningId(null);
    }
    void loadApplications();
    return () => {
      requestSequence.current += 1;
    };
  }, [loadApplications, refreshKey, teamId]);

  useEffect(
    () => () => {
      decisionSequence.current += 1;
    },
    []
  );

  const currentApplications =
    visibleTeamId.current === teamId ? applications : [];
  const hasApplications = currentApplications.length > 0;
  const decisionInProgress = Boolean(approvingId || decliningId);

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
        <div className="flex items-center gap-2">
          {!loading || hasApplications ? (
            <span
              className="rounded-full bg-cream-100 px-2 py-1 text-xs font-semibold text-forest-900"
              aria-label={`${currentApplications.length} pending ${currentApplications.length === 1 ? 'application' : 'applications'}`}
              data-testid="applications-pending-count"
            >
              {currentApplications.length} pending
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void loadApplications()}
            disabled={loading || decisionInProgress}
            className="px-3 py-1 text-xs font-medium border border-cream-300 rounded bg-cream-50 hover:bg-cream-100 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
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

      {decisionInProgress ? (
        <p
          role="status"
          aria-live="polite"
          data-testid="application-decision-progress"
          className="text-xs text-ink-muted"
        >
          Saving the decision… Other review controls are temporarily disabled.
        </p>
      ) : null}

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
        <div role="status" data-testid="application-decision-success" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {approvalNotice}
        </div>
      ) : null}

      {approvalError ? (
        <div role="alert" data-testid="application-decision-error" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
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
          {currentApplications.map((application) => (
            <ApplicationReviewCard
              key={application.id}
              application={application}
              approving={approvingId === application.id}
              declining={decliningId === application.id}
              disabled={disabled || loading || decisionInProgress}
              onApprove={(id) => void handleApprove(id)}
              onDecline={(id) => void handleDecline(id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

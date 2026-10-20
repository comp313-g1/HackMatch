import React, { useCallback, useEffect, useState } from 'react';
import {
  ApplicationsApiError,
  AuthRequiredError,
  fetchTeamApplications,
  type OwnerApplicationReviewItem,
} from './applicationsApi';

export interface OwnerApplicationsPanelProps {
  teamId: string;
  refreshKey?: number;
}

/** US-020 / #188 / FR-060 — owner-only incoming application review queue. */
export function OwnerApplicationsPanel({
  teamId,
  refreshKey = 0,
}: OwnerApplicationsPanelProps): React.JSX.Element {
  const [applications, setApplications] = useState<OwnerApplicationReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);

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

      {!loading && !error && !hasApplications && (
        <div role="status" data-testid="applications-empty" className="rounded-md bg-cream-50 p-4 text-sm text-ink-muted">
          {emptyMessage || 'No pending applications to review.'}
        </div>
      )}

      {hasApplications && (
        <ul className="space-y-3" data-testid="applications-review-list">
          {applications.map((application) => (
            <li key={application.id} className="rounded-md border border-cream-200 p-3" data-testid={`application-review-${application.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-forest-900">
                    {application.applicantDisplayName}
                    {application.applicantHandle ? ` (@${application.applicantHandle})` : ''}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {application.vacancyRole || 'Unspecified role'} · {application.statusLabel}
                  </p>
                </div>
                <time className="text-xs text-ink-muted" dateTime={application.createdAt}>
                  {new Date(application.createdAt).toLocaleString()}
                </time>
              </div>

              {(application.primaryRole || application.institution) && (
                <p className="mt-2 text-sm text-ink">
                  {[application.primaryRole, application.institution].filter(Boolean).join(' · ')}
                </p>
              )}
              {application.skills.length > 0 && (
                <p className="mt-2 text-xs text-ink-muted">Skills: {application.skills.join(', ')}</p>
              )}
              <p className="mt-2 text-sm text-ink">
                {application.message || 'No application note provided.'}
              </p>
              {application.portfolios.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2" aria-label="Self-declared portfolio links">
                  {application.portfolios.map((portfolio) => (
                    <li key={portfolio.url}>
                      <a className="text-xs font-medium text-forest underline" href={portfolio.url} target="_blank" rel="noreferrer">
                        {portfolio.label || 'Portfolio'} (self-declared)
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

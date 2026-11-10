import React, { useCallback, useEffect, useState } from 'react';
import {
  AuthRequiredError,
  RecommendedTeamsApiError,
  fetchRecommendedTeams,
  type RecommendedTeam,
  type RecommendedTeamsResponse,
} from './recommendedTeamsApi';

export interface RecommendedTeamsPageProps {
  /** Where to send a signed-out visitor. */
  onNavigateToSignIn?: () => void;
}

type LoadState = 'loading' | 'success' | 'error';

function ScoreBadge({ team }: { team: RecommendedTeam }): React.JSX.Element | null {
  if (!team.displayScore) return null;
  return (
    <span
      className="inline-flex items-baseline gap-1 rounded-full bg-forest-50 px-2.5 py-1 text-xs font-semibold text-forest-900 border border-forest-200"
      data-testid="recommended-team-score"
    >
      {team.displayScore}
      <span className="font-normal text-forest-800">match</span>
    </span>
  );
}

function TeamCard({ team }: { team: RecommendedTeam }): React.JSX.Element {
  const matchedSkills = team.matchedSkills ?? [];

  return (
    <li
      className="rounded-lg border border-cream-200 bg-white p-4 space-y-3"
      data-testid="recommended-team-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold text-forest-900">
            {team.rank ? (
              <span className="mr-2 text-xs font-medium text-ink-muted">#{team.rank}</span>
            ) : null}
            {team.teamName}
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            {team.role} · {team.teamGoal} · {team.commitmentHours}h per week
          </p>
        </div>
        <ScoreBadge team={team} />
      </div>

      {matchedSkills.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="recommended-team-skills">
          <span className="text-xs text-ink-muted">Matched skills:</span>
          {matchedSkills.map((skill) => (
            <span
              key={skill}
              className="rounded-full bg-cream-100 px-2 py-0.5 text-xs font-medium text-ink"
            >
              {skill}
            </span>
          ))}
        </div>
      ) : null}

      {team.roleMatched ? (
        <p className="text-xs text-forest-800" data-testid="recommended-team-role-match">
          Your primary role matches this slot.
        </p>
      ) : null}
    </li>
  );
}

/**
 * Participant-facing US-016 page: teams ranked against the signed-in profile.
 *
 * Five states — loading, success, empty, error, degraded. The error state keeps whatever
 * was already loaded (NR-017) instead of blanking the list on a retryable failure.
 */
export function RecommendedTeamsPage({
  onNavigateToSignIn,
}: RecommendedTeamsPageProps): React.JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [result, setResult] = useState<RecommendedTeamsResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  const load = useCallback(async () => {
    setLoadState('loading');
    setErrorMessage(null);
    setNeedsSignIn(false);
    try {
      const data = await fetchRecommendedTeams();
      setResult(data);
      setLoadState('success');
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setNeedsSignIn(true);
        setErrorMessage('You need to sign in to see recommendations.');
      } else if (err instanceof RecommendedTeamsApiError) {
        setErrorMessage(err.message || 'Could not load recommended teams.');
      } else {
        setErrorMessage('Could not load recommended teams.');
      }
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isDegraded = result?.status === 'degraded';
  const showList = Boolean(result && !result.empty);

  return (
    <section aria-labelledby="recommended-teams-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2
            id="recommended-teams-heading"
            className="font-display text-xl font-semibold text-forest-900"
          >
            Recommended for you
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Open teams ranked by your declared role, skills, goal and weekly hours.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loadState === 'loading'}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-forest rounded hover:bg-forest-800 disabled:opacity-50"
          data-testid="recommended-teams-refresh"
        >
          {loadState === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {loadState === 'loading' && !result ? (
        <p role="status" aria-live="polite" className="text-sm text-forest-800" data-testid="recommended-teams-loading">
          Loading recommendations…
        </p>
      ) : null}

      {loadState === 'error' ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 space-y-2"
          data-testid="recommended-teams-error"
        >
          <p>{errorMessage}</p>
          {result ? <p>Your previously loaded teams are still shown below.</p> : null}
          {needsSignIn && onNavigateToSignIn ? (
            <button
              type="button"
              onClick={onNavigateToSignIn}
              className="px-3 py-1 text-xs font-semibold text-white bg-forest rounded hover:bg-forest-800"
            >
              Sign in
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void load()}
              className="px-3 py-1 text-xs font-medium border border-red-200 rounded bg-white hover:bg-red-50"
              data-testid="recommended-teams-retry"
            >
              Retry
            </button>
          )}
        </div>
      ) : null}

      {result && result.empty ? (
        <div
          role="status"
          className="rounded-md border border-dashed border-cream-300 bg-white p-6 text-center space-y-2"
          data-testid="recommended-teams-empty"
        >
          <p className="text-sm font-medium text-ink">{result.message}</p>
          <p className="text-xs text-ink-muted">{result.notice}</p>
        </div>
      ) : null}

      {showList ? (
        <div className="space-y-3" data-testid="recommended-teams-results">
          {isDegraded && result?.degradedNotice ? (
            <div
              role="status"
              className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
              data-testid="recommended-teams-degraded"
            >
              {result.degradedNotice}
            </div>
          ) : null}

          <ul className="space-y-3" data-testid="recommended-teams-list">
            {result!.teams.map((team) => (
              <TeamCard key={`${team.teamId}:${team.vacancyId}`} team={team} />
            ))}
          </ul>

          <p className="text-xs text-ink-muted">{result!.notice}</p>
        </div>
      ) : null}
    </section>
  );
}

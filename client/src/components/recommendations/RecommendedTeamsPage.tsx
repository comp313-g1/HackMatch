import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RecommendedTeamCard } from './RecommendedTeamCard';
import {
  AuthRequiredError,
  RecommendedTeamsApiError,
  fetchRecommendedTeams,
  type RecommendedTeam,
  type RecommendedTeamsIneligibleReason,
  type RecommendedTeamsResponse,
} from './recommendedTeamsApi';

export interface RecommendedTeamsPageProps {
  onNavigateToSignIn: () => void;
  /** Takes the participant to Looking for Team (to turn it on). */
  onGoToLookingForTeam: () => void;
  /** Takes the participant to their profile (to add skills). */
  onGoToProfile?: () => void;
  /** Takes the participant to the full list of open teams. */
  onBrowseOpenTeams: () => void;
  /** When given, each suggestion shows an Apply button (the US-018 hook-up). */
  onApply?: (team: RecommendedTeam) => void;
  /** Reload after an application changes recommendation eligibility. */
  refreshToken?: number;
}

type Phase = 'loading' | 'loaded' | 'error' | 'signed-out';

/** Why nothing is shown when the pool, not the person, is the reason. */
export const NO_MATCHING_TEAMS_HINT =
  'Teams you already belong to, teams that are full, locked or closed, and teams you already applied to or were invited by are not suggested.';

const SCORE_NOTICE_FALLBACK =
  'Match percentages compare the skills, goal and hours you and each team have declared. They are suggestions, not predictions.';

interface EmptyCopy {
  title: string;
  body: string;
}

function emptyCopy(reason: RecommendedTeamsIneligibleReason | null, serverMessage: string | null): EmptyCopy {
  switch (reason) {
    case 'participant_not_looking':
      return {
        title: 'Turn on Looking for Team to see suggestions',
        body: 'We only suggest teams to people who say they are looking for one.',
      };
    case 'participant_no_skills':
      return {
        title: 'Add your skills to see suggestions',
        body: 'We compare the skills on your profile with what each open role asks for.',
      };
    case 'participant_profile_hidden':
    case 'participant_unavailable':
      return {
        title: 'Suggestions are not available for your account right now',
        body: 'You can still browse every open team yourself.',
      };
    default:
      return {
        title: 'No open teams match you right now',
        body: serverMessage || NO_MATCHING_TEAMS_HINT,
      };
  }
}

function errorText(error: unknown): string {
  if (error instanceof RecommendedTeamsApiError) {
    if (error.status === 403) return 'You do not have access to recommended teams. Check that your account is verified.';
    if (error.code === 'NETWORK' || error.code === 'INVALID_RESPONSE') return error.message;
    return error.message || 'Could not load your recommended teams.';
  }
  return 'Could not load your recommended teams.';
}

/**
 * US-016 / #156 — the participant's own list of recommended open teams, best match first, with
 * loading, empty (person or pool), error and signed-out states. Nothing here changes data, so
 * every failure is safe to retry.
 */
export function RecommendedTeamsPage({
  onNavigateToSignIn,
  onGoToLookingForTeam,
  onGoToProfile,
  onBrowseOpenTeams,
  onApply,
  refreshToken = 0,
}: RecommendedTeamsPageProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading');
  const [result, setResult] = useState<RecommendedTeamsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latestRequest = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const requestId = ++latestRequest.current;
    setError(null);
    setRefreshing(true);
    try {
      const data = await fetchRecommendedTeams();
      if (requestId !== latestRequest.current) return;
      setResult(data);
      setPhase('loaded');
    } catch (err: unknown) {
      if (requestId !== latestRequest.current) return;
      if (err instanceof AuthRequiredError || (err instanceof RecommendedTeamsApiError && err.status === 401)) {
        setResult(null);
        setPhase('signed-out');
      } else {
        setError(errorText(err));
        // Keep the last good list on a failed refresh; with nothing to show, fall to the error state.
        setPhase((current) => (current === 'loaded' ? 'loaded' : 'error'));
      }
    } finally {
      if (requestId === latestRequest.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      // Ignore any answer that arrives after the page is gone or a newer request has started.
      latestRequest.current += 1;
    };
  }, [load, refreshToken]);

  const button =
    'rounded-md px-4 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2';
  const primary = `${button} bg-forest text-white shadow-sm hover:bg-forest-800`;
  const secondary = `${button} border border-cream-300 bg-white text-ink hover:bg-cream-100`;

  return (
    <section aria-labelledby="recommended-teams-heading" className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="recommended-teams-heading" className="text-2xl font-bold text-ink">
            Recommended teams
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Open roles that fit your skills, goal and hours, best match first.
          </p>
        </div>
        {phase === 'loaded' ? (
          <button
            type="button"
            onClick={() => void load()}
            disabled={refreshing}
            className={`${secondary} disabled:opacity-50`}
            data-testid="refresh-recommended-teams"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        ) : null}
      </div>

      {phase === 'loading' ? (
        <p role="status" aria-live="polite" className="text-sm text-forest-800" data-testid="recommended-teams-loading">
          Finding teams for you…
        </p>
      ) : null}

      {phase === 'signed-out' ? (
        <div role="alert" className="space-y-3 rounded-xl border border-cream-300 bg-white p-5" data-testid="recommended-teams-signed-out">
          <p className="font-medium text-ink">Please sign in again to see your recommended teams.</p>
          <button type="button" onClick={onNavigateToSignIn} className={primary}>
            Sign in
          </button>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" data-testid="recommended-teams-error">
          <p>{error}</p>
          {phase === 'loaded' ? <p>Showing your last results.</p> : null}
          <button type="button" onClick={() => void load()} disabled={refreshing} className={`${secondary} disabled:opacity-50`}>
            Try again
          </button>
        </div>
      ) : null}

      {phase === 'loaded' && result && result.empty ? (
        <EmptyState
          result={result}
          primaryClass={primary}
          secondaryClass={secondary}
          onGoToLookingForTeam={onGoToLookingForTeam}
          onGoToProfile={onGoToProfile}
          onBrowseOpenTeams={onBrowseOpenTeams}
          onCheckAgain={() => void load()}
          checking={refreshing}
        />
      ) : null}

      {phase === 'loaded' && result && !result.empty ? (
        <div className="space-y-4" data-testid="recommended-teams-results">
          <p className="text-sm text-ink-muted" data-testid="recommended-teams-count">
            {result.recommendations.length} suggested {result.recommendations.length === 1 ? 'team' : 'teams'}
          </p>
          <ol className="space-y-4" aria-label="Recommended teams">
            {result.recommendations.map((team) => (
              <RecommendedTeamCard key={`${team.teamId}:${team.vacancyId}`} team={team} onApply={onApply} />
            ))}
          </ol>
          <p className="text-xs text-ink-muted" data-testid="recommended-teams-notice">
            {result.notice || SCORE_NOTICE_FALLBACK}
          </p>
        </div>
      ) : null}
    </section>
  );
}

interface EmptyStateProps {
  result: RecommendedTeamsResponse;
  primaryClass: string;
  secondaryClass: string;
  onGoToLookingForTeam: () => void;
  onGoToProfile?: () => void;
  onBrowseOpenTeams: () => void;
  onCheckAgain: () => void;
  checking: boolean;
}

function EmptyState({
  result,
  primaryClass,
  secondaryClass,
  onGoToLookingForTeam,
  onGoToProfile,
  onBrowseOpenTeams,
  onCheckAgain,
  checking,
}: EmptyStateProps): React.JSX.Element {
  const copy = emptyCopy(result.ineligibleReason, result.message);
  const reason = result.ineligibleReason;
  return (
    <div
      role="status"
      className="space-y-3 rounded-xl border border-dashed border-cream-300 bg-white p-6 text-center"
      data-testid="recommended-teams-empty"
      data-reason={reason ?? 'no-matches'}
    >
      <p className="text-base font-semibold text-ink">{copy.title}</p>
      <p className="text-sm text-ink-muted">{copy.body}</p>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
        {reason === 'participant_not_looking' ? (
          <button type="button" onClick={onGoToLookingForTeam} className={primaryClass} data-testid="go-to-looking">
            Set up Looking for Team
          </button>
        ) : null}
        {reason === 'participant_no_skills' && onGoToProfile ? (
          <button type="button" onClick={onGoToProfile} className={primaryClass} data-testid="go-to-profile">
            Update my profile
          </button>
        ) : null}
        <button type="button" onClick={onBrowseOpenTeams} className={reason === null ? primaryClass : secondaryClass} data-testid="browse-open-teams">
          Browse open teams
        </button>
        {reason === null ? (
          <button type="button" onClick={onCheckAgain} disabled={checking} className={`${secondaryClass} disabled:opacity-50`}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

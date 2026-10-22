import React, { useState, useEffect, useRef } from 'react';
import type { User } from 'firebase/auth';
import {
  EMPTY_FILTERS,
  validateFilterDraft,
  fetchOpenTeams,
  OpenTeamsApiError,
  type OpenTeamsFilterDraft,
  type OpenTeamsFilterErrors,
  type OpenTeamsResult,
  type OpenTeamApplyTarget,
} from './openTeamsApi';
import { OpenTeamsFilterBar } from './OpenTeamsFilterBar';
import { OpenTeamCard } from './OpenTeamCard';

export interface OpenTeamsBoardProps {
  currentUser: User | null;
  onNavigateToSignIn: () => void;
  /** When MFA is still required, send the user to the OTP gate instead of visitor Apply CTAs (#357). */
  onNavigateToMfa?: () => void;
  onApply: (target: OpenTeamApplyTarget) => void;
}

export function OpenTeamsBoard({
  currentUser,
  onNavigateToSignIn,
  onNavigateToMfa,
  onApply,
}: OpenTeamsBoardProps): React.JSX.Element {
  const [draft, setDraft] = useState<OpenTeamsFilterDraft>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<OpenTeamsFilterDraft>(EMPTY_FILTERS);
  const [errors, setErrors] = useState<OpenTeamsFilterErrors>({});
  const [phase, setPhase] = useState<'loading' | 'loaded' | 'error' | 'mfa-required'>('loading');
  const [result, setResult] = useState<OpenTeamsResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestIdRef = useRef<number>(0);

  // Fetch open teams whenever applied filters or currentUser change
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();

    setPhase('loading');
    setErrorMessage(null);

    fetchOpenTeams(applied, currentUser, controller.signal)
      .then((data) => {
        if (requestId === requestIdRef.current) {
          setResult(data);
          setPhase('loaded');
        }
      })
      .catch((err: unknown) => {
        if (requestId === requestIdRef.current && !controller.signal.aborted) {
          if (err instanceof OpenTeamsApiError && err.code === 'MFA_REQUIRED') {
            setErrorMessage(err.message);
            setPhase('mfa-required');
            return;
          }
          const msg = err instanceof Error ? err.message : 'Failed to load open teams.';
          setErrorMessage(msg);
          setPhase('error');
        }
      });

    return () => {
      controller.abort();
    };
  }, [applied, currentUser]);

  const handleSubmit = () => {
    const validationErrors = validateFilterDraft(draft);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setApplied(draft);
  };

  const handleReset = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setErrors({});
  };

  const hasAnyFilterActive = (filters: OpenTeamsFilterDraft): boolean => {
    return Boolean(
      (filters.skills && filters.skills.trim() !== '') ||
      (filters.role && filters.role.trim() !== '') ||
      (filters.goal && filters.goal.trim() !== '') ||
      (filters.minSlots && filters.minSlots.trim() !== '')
    );
  };

  const canReset = hasAnyFilterActive(draft) || hasAnyFilterActive(applied);

  return (
    <section aria-labelledby="open-teams-heading" className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 id="open-teams-heading" className="text-2xl font-bold text-ink">
          Browse Open Teams
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Explore active teams with open vacancies across the platform. Filter by technical stack, role, team goal, or minimum slots.
        </p>
      </div>

      {/* Multi-Filter Bar */}
      <OpenTeamsFilterBar
        values={draft}
        errors={errors}
        onChange={setDraft}
        onSubmit={handleSubmit}
        onReset={handleReset}
        isLoading={phase === 'loading'}
        canReset={canReset}
      />

      {/* Visitor Prompt Notice */}
      {phase === 'loaded' && result?.viewer === 'VISITOR' && (
        <div
          role="status"
          className="p-4 bg-cream-100 border border-cream-300 rounded-xl text-ink text-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm"
        >
          <div>
            <p className="font-medium text-forest-900">Viewing anonymized team previews.</p>
            <p className="text-xs text-ink-muted mt-0.5">
              Sign in as a verified participant to see team pitches, members, and apply.
            </p>
          </div>
          <button
            type="button"
            onClick={onNavigateToSignIn}
            className="shrink-0 px-4 py-1.5 font-semibold text-white bg-forest hover:bg-forest-800 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-forest"
          >
            Sign in
          </button>
        </div>
      )}

      {/* Loading State */}
      {phase === 'loading' && (
        <div
          role="status"
          aria-busy="true"
          className="text-center py-16 bg-white rounded-xl border border-cream-200 p-8 space-y-3"
        >
          <div
            className="mx-auto h-8 w-8 rounded-full border-4 border-forest-100 border-t-forest animate-spin"
            aria-hidden="true"
          />
          <p className="text-sm text-ink-muted">Loading open teams...</p>
        </div>
      )}

      {/* MFA required — signed in but OTP not done; do not show visitor "Sign in to apply" (#357) */}
      {phase === 'mfa-required' && (
        <div
          role="status"
          className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-950 text-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm"
        >
          <div>
            <p className="font-medium">Verification required to apply</p>
            <p className="text-xs text-amber-900/80 mt-0.5">
              {errorMessage ||
                'Enter the email verification code to see team details and apply to vacancies.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateToMfa?.() ?? onNavigateToSignIn()}
            className="shrink-0 px-4 py-1.5 font-semibold text-white bg-forest hover:bg-forest-800 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-forest"
          >
            Enter code
          </button>
        </div>
      )}

      {/* Error State */}
      {phase === 'error' && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
        >
          <p className="font-medium">{errorMessage || 'An error occurred while loading open teams.'}</p>
          <button
            type="button"
            onClick={() => setApplied({ ...applied })}
            className="shrink-0 px-3 py-1.5 bg-red-600 text-white rounded font-medium text-xs hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            Try again
          </button>
        </div>
      )}

      {/* Loaded Content */}
      {phase === 'loaded' && result && (
        <>
          {result.teams.length === 0 ? (
            /* Empty State */
            hasAnyFilterActive(applied) ? (
              <div className="text-center py-16 bg-white rounded-xl border border-cream-200 p-8 space-y-4 shadow-sm">
                <div className="mx-auto w-12 h-12 rounded-full bg-cream-100 flex items-center justify-center text-ink-muted">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-base font-semibold text-ink">No teams match your filters.</p>
                  <p className="text-sm text-ink-muted mt-1">Try relaxing or clearing your filters to see more open teams.</p>
                </div>
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-4 py-2 font-semibold text-white bg-forest hover:bg-forest-800 rounded-md text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-forest"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              <div className="text-center py-16 bg-white rounded-xl border border-cream-200 p-8 space-y-2 shadow-sm">
                <p className="text-base font-semibold text-ink">No teams are recruiting right now.</p>
                <p className="text-sm text-ink-muted">Check back later or create your own team.</p>
              </div>
            )
          ) : (
            /* Results Grid */
            <div className="space-y-4">
              <div role="status" aria-live="polite" className="text-xs font-medium text-ink-muted">
                Showing {result.teams.length} of {result.total} team(s)
                {result.total > result.teams.length && ' (Refine filters to see more)'}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {result.teams.map((t, idx) => (
                  <OpenTeamCard
                    key={'id' in t ? t.id : idx}
                    team={t}
                    viewer={result.viewer}
                    onApply={onApply}
                    onSignIn={onNavigateToSignIn}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

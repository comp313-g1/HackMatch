import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  fetchOpenTeams,
  EMPTY_FILTERS,
  type OpenTeamPartCard,
  type OpenTeamVisitorPreview,
  type OpenTeamsResult,
} from '../teams/openTeamsApi';
import { fetchAvailableCandidates } from '../../services/availabilityApi';
import {
  LANDING_GOALS,
  LANDING_ROLES,
  type LandingGoalFilter,
  type LandingRoleFilter,
} from './landingData';

export interface LandingPageProps {
  onNavigateToRegister: () => void;
  onNavigateToLogin: () => void;
  onNavigateToTeams?: () => void;
  onNavigateToProfile?: () => void;
  onNavigateToOpenTeams?: () => void;
  onNavigateToLooking?: () => void;
  currentUser?: User | null;
}

type DirectoryTeam =
  | { kind: 'part'; team: OpenTeamPartCard }
  | { kind: 'visitor'; team: OpenTeamVisitorPreview; index: number };

function teamMatchesQuery(entry: DirectoryTeam, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();

  if (entry.kind === 'part') {
    const t = entry.team;
    if (t.name.toLowerCase().includes(q)) return true;
    if (t.pitch.toLowerCase().includes(q)) return true;
    if (t.members.some((m) => m.displayName.toLowerCase().includes(q))) return true;
    if (
      t.vacancies.some(
        (v) =>
          v.role.toLowerCase().includes(q) ||
          v.skills.some((s) => s.toLowerCase().includes(q))
      )
    ) {
      return true;
    }
    return false;
  }

  const t = entry.team;
  if (t.goal.toLowerCase().includes(q)) return true;
  return t.vacancies.some(
    (v) =>
      v.role.toLowerCase().includes(q) ||
      v.skills.some((s) => s.toLowerCase().includes(q))
  );
}

/**
 * Event-free landing (#361): discover open teams / people — no hackathon directory.
 */
export function LandingPage({
  onNavigateToRegister,
  onNavigateToLogin,
  onNavigateToTeams,
  onNavigateToProfile,
  onNavigateToOpenTeams,
  onNavigateToLooking,
  currentUser = null,
}: LandingPageProps): React.JSX.Element {
  const searchInputId = useId();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState<LandingRoleFilter>('all');
  const [selectedGoal, setSelectedGoal] = useState<LandingGoalFilter>('all');
  const [teamsResult, setTeamsResult] = useState<OpenTeamsResult | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [lookingCount, setLookingCount] = useState<number | null>(null);

  const loadDirectory = useCallback(async () => {
    setTeamsLoading(true);
    setTeamsError(null);
    try {
      const draft = {
        ...EMPTY_FILTERS,
        role: selectedRole === 'all' ? '' : selectedRole,
        goal: selectedGoal === 'all' ? '' : selectedGoal,
      };
      const result = await fetchOpenTeams(draft, currentUser);
      setTeamsResult(result);
    } catch (err) {
      setTeamsResult(null);
      setTeamsError(err instanceof Error ? err.message : 'Could not load open teams.');
    } finally {
      setTeamsLoading(false);
    }
  }, [currentUser, selectedRole, selectedGoal]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  useEffect(() => {
    if (!currentUser) {
      setLookingCount(null);
      return;
    }
    let cancelled = false;
    void fetchAvailableCandidates()
      .then((candidates) => {
        if (!cancelled) setLookingCount(candidates.length);
      })
      .catch(() => {
        if (!cancelled) setLookingCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const directory = useMemo((): DirectoryTeam[] => {
    if (!teamsResult) return [];
    if (teamsResult.viewer === 'PART') {
      return teamsResult.teams.map((team) => ({ kind: 'part' as const, team }));
    }
    return teamsResult.teams.map((team, index) => ({
      kind: 'visitor' as const,
      team,
      index,
    }));
  }, [teamsResult]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return directory.filter((entry) => teamMatchesQuery(entry, q));
  }, [directory, searchQuery]);

  const openTeamsCount = teamsResult?.total ?? null;
  const openSlotsCount = useMemo(() => {
    if (!teamsResult) return null;
    return teamsResult.teams.reduce((sum, t) => sum + t.openSlots, 0);
  }, [teamsResult]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedRole('all');
    setSelectedGoal('all');
  };

  const scrollToDirectory = () => {
    document.getElementById('discover-section')?.scrollIntoView({ behavior: 'smooth' });
    document.getElementById(searchInputId)?.focus();
  };

  const goOpenTeams = () => {
    if (onNavigateToOpenTeams) onNavigateToOpenTeams();
    else scrollToDirectory();
  };

  return (
    <div className="space-y-16 sm:space-y-20 pb-16">
      <section
        aria-label="HackMatch hero"
        className="relative -mx-4 sm:-mx-6 lg:-mx-8 -mt-10 md:-mt-14 px-4 sm:px-6 lg:px-8 py-16 sm:py-24 bg-gradient-to-b from-cream-100 via-cream-50 to-cream border-b border-cream-200 overflow-hidden"
      >
        <div className="max-w-6xl mx-auto flex flex-col justify-center">
          <p className="font-sans text-xs sm:text-sm font-semibold uppercase tracking-[0.18em] text-forest-700">
            Platform-wide team formation
          </p>
          <h1 className="mt-3 font-display font-semibold uppercase leading-[1.04] text-balance text-forest-900 text-3xl sm:text-5xl lg:text-6xl tracking-tight">
            Find your team
          </h1>
          <p className="mt-4 max-w-2xl font-sans text-base sm:text-lg text-ink-muted leading-relaxed">
            Browse open teams, find teammates who are looking to join, or build your own roster —
            no hackathon listing required.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <button
              type="button"
              onClick={goOpenTeams}
              className="inline-flex items-center justify-center rounded-md bg-forest px-6 py-3 font-sans text-sm font-semibold text-white shadow-sm hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream transition"
            >
              Open teams
            </button>
            {currentUser ? (
              <>
                <button
                  type="button"
                  onClick={onNavigateToTeams}
                  className="inline-flex items-center justify-center rounded-md border border-forest px-6 py-3 font-sans text-sm font-semibold text-forest bg-transparent hover:bg-forest-50 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream transition"
                >
                  My teams
                </button>
                <button
                  type="button"
                  onClick={onNavigateToLooking}
                  className="inline-flex items-center justify-center rounded-md border border-cream-300 px-6 py-3 font-sans text-sm font-medium text-ink bg-white hover:bg-cream-100 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream transition"
                >
                  Find teammates
                </button>
                <button
                  type="button"
                  onClick={onNavigateToProfile}
                  className="inline-flex items-center justify-center rounded-md border border-cream-300 px-6 py-3 font-sans text-sm font-medium text-ink bg-white hover:bg-cream-100 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream transition"
                >
                  Profile
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onNavigateToRegister}
                className="inline-flex items-center justify-center rounded-md border border-forest px-6 py-3 font-sans text-sm font-semibold text-forest bg-transparent hover:bg-forest-50 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream transition"
              >
                Create account
              </button>
            )}
          </div>
        </div>
      </section>

      <section
        id="discover-section"
        aria-labelledby="discover-heading"
        className="max-w-6xl mx-auto px-4 sm:px-6 -mt-12 sm:-mt-16 relative z-10"
      >
        <h2 id="discover-heading" className="sr-only">
          Search open teams and people
        </h2>

        <div className="rounded-xl border border-cream-200 bg-white p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <label htmlFor={searchInputId} className="sr-only">
              Search teams or people
            </label>
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </span>
              <input
                id={searchInputId}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by team name, person, role, or skill"
                className="w-full rounded-md border border-cream-200 bg-cream-50 py-2.5 pl-10 pr-3 font-sans text-sm text-ink placeholder:text-ink-muted focus:bg-white focus:outline-none focus:ring-2 focus:ring-forest"
              />
            </div>
            <button
              type="button"
              onClick={() => document.getElementById(searchInputId)?.focus()}
              className="rounded-md bg-forest px-5 py-2.5 font-sans text-sm font-semibold text-white hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest transition"
            >
              Search
            </button>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-start gap-4 pt-2 border-t border-cream-100">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-sans text-xs uppercase tracking-[0.1em] text-ink-muted font-semibold mr-1">
                Role
              </span>
              {LANDING_ROLES.map((role) => {
                const isActive = selectedRole === role;
                return (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setSelectedRole((prev) => (prev === role ? 'all' : role))}
                    className={`shrink-0 rounded-full border px-3.5 py-1.5 font-sans text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-forest ${
                      isActive
                        ? 'border-forest bg-forest text-white'
                        : 'border-cream-200 bg-cream-50 text-ink hover:border-forest/50'
                    }`}
                  >
                    {role}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="font-sans text-xs uppercase tracking-[0.1em] text-ink-muted font-semibold mr-1">
                Goal
              </span>
              {LANDING_GOALS.map((goal) => {
                const isActive = selectedGoal === goal;
                return (
                  <button
                    key={goal}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setSelectedGoal((prev) => (prev === goal ? 'all' : goal))}
                    className={`shrink-0 rounded-full border px-3.5 py-1.5 font-sans text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-forest ${
                      isActive
                        ? 'border-forest bg-forest text-white'
                        : 'border-cream-200 bg-cream-50 text-ink hover:border-forest/50'
                    }`}
                  >
                    {goal}
                  </button>
                );
              })}
            </div>

            {(searchQuery || selectedRole !== 'all' || selectedGoal !== 'all') && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-xs text-forest-700 underline hover:text-forest-900 lg:ml-auto self-start lg:self-center"
              >
                Reset filters
              </button>
            )}
          </div>
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          Showing {filtered.length} teams
        </div>

        <div className="mt-6">
          {teamsLoading ? (
            <div role="status" className="rounded-lg border border-cream-200 bg-white p-8 text-center text-ink-muted">
              Loading open teams…
            </div>
          ) : teamsError ? (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-8 text-center text-red-800 space-y-3">
              <p className="font-medium">{teamsError}</p>
              <button
                type="button"
                onClick={() => void loadDirectory()}
                className="px-4 py-2 bg-white border border-red-200 rounded-md text-sm font-semibold"
              >
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div
              role="status"
              className="rounded-lg border border-cream-200 bg-white p-8 text-center text-ink-muted"
            >
              <p className="font-medium text-ink">No teams match your search</p>
              <p className="mt-1 text-sm">
                Try another team or person name, or clear role/goal filters.
              </p>
              <button
                type="button"
                onClick={handleResetFilters}
                className="mt-4 px-4 py-2 bg-cream-100 hover:bg-cream-200 text-forest-900 text-xs font-semibold rounded-md transition"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((entry) => {
                if (entry.kind === 'part') {
                  const team = entry.team;
                  return (
                    <article
                      key={team.id}
                      className="rounded-lg border border-cream-200 bg-white p-5 flex flex-col justify-between shadow-sm hover:border-forest-200 transition"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-forest-50 text-forest-800 border border-forest-100">
                            {team.goal}
                          </span>
                          <span className="text-[11px] font-medium text-ink-muted">
                            {team.openSlots} open slot{team.openSlots === 1 ? '' : 's'}
                          </span>
                        </div>
                        <h3 className="font-display font-semibold text-lg text-forest-900">
                          {team.name}
                        </h3>
                        <p className="text-xs text-ink-muted line-clamp-2">{team.pitch}</p>
                        <p className="text-xs text-ink-muted">
                          Members:{' '}
                          {team.members.map((m) => m.displayName).join(', ') || 'Forming'}
                        </p>
                        <div className="flex flex-wrap gap-1 pt-1">
                          {team.vacancies.flatMap((v) =>
                            v.skills.slice(0, 3).map((skill) => (
                              <span
                                key={`${v.id}-${skill}`}
                                className="px-2 py-0.5 rounded bg-cream-100 text-ink text-[10px] font-medium"
                              >
                                {skill}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                      <div className="mt-4 pt-3 border-t border-cream-100">
                        <button
                          type="button"
                          onClick={goOpenTeams}
                          className="w-full px-3 py-1.5 bg-forest text-white text-xs font-semibold rounded hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest transition"
                        >
                          View open team
                        </button>
                      </div>
                    </article>
                  );
                }

                const team = entry.team;
                return (
                  <article
                    key={`visitor-${entry.index}`}
                    className="rounded-lg border border-cream-200 bg-white p-5 flex flex-col justify-between shadow-sm"
                  >
                    <div className="space-y-2">
                      <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-forest-50 text-forest-800 border border-forest-100">
                        {team.goal}
                      </span>
                      <h3 className="font-display font-semibold text-lg text-forest-900">
                        {team.displayLabel}
                      </h3>
                      <p className="text-xs text-ink-muted">
                        {team.openSlots} open slot{team.openSlots === 1 ? '' : 's'} ·{' '}
                        {team.commitmentHours} hrs/wk
                      </p>
                      <div className="flex flex-wrap gap-1 pt-1">
                        {team.vacancies.flatMap((v, vi) =>
                          v.skills.slice(0, 3).map((skill) => (
                            <span
                              key={`${vi}-${skill}`}
                              className="px-2 py-0.5 rounded bg-cream-100 text-ink text-[10px] font-medium"
                            >
                              {skill}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="mt-4 pt-3 border-t border-cream-100">
                      <button
                        type="button"
                        onClick={onNavigateToLogin}
                        className="w-full px-3 py-1.5 bg-forest text-white text-xs font-semibold rounded hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest transition"
                      >
                        Sign in to view team
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="metrics-heading" className="max-w-6xl mx-auto px-4 sm:px-6">
        <h2 id="metrics-heading" className="sr-only">
          Platform statistics
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-cream-200 bg-white p-6 text-center shadow-sm">
            <p className="font-display text-4xl text-forest font-bold" aria-live="polite">
              {teamsLoading || openTeamsCount == null ? '—' : openTeamsCount}
            </p>
            <p className="mt-2 font-sans text-xs uppercase tracking-[0.08em] text-ink-muted font-semibold">
              Open teams
            </p>
          </div>
          <div className="rounded-lg border border-cream-200 bg-white p-6 text-center shadow-sm">
            <p className="font-display text-4xl text-forest font-bold" aria-live="polite">
              {teamsLoading || openSlotsCount == null ? '—' : openSlotsCount}
            </p>
            <p className="mt-2 font-sans text-xs uppercase tracking-[0.08em] text-ink-muted font-semibold">
              Open slots
            </p>
          </div>
          <div className="rounded-lg border border-cream-200 bg-white p-6 text-center shadow-sm">
            <p className="font-display text-4xl text-forest font-bold" aria-live="polite">
              {lookingCount == null ? '—' : lookingCount}
            </p>
            <p className="mt-2 font-sans text-xs uppercase tracking-[0.08em] text-ink-muted font-semibold">
              Looking for teammates
            </p>
            {!currentUser && (
              <p className="mt-1 text-[11px] text-ink-muted">Sign in to see live count</p>
            )}
          </div>
        </div>
      </section>

      <section
        aria-labelledby="how-it-works-heading"
        className="max-w-6xl mx-auto px-4 sm:px-6"
      >
        <h2
          id="how-it-works-heading"
          className="font-display text-2xl sm:text-3xl font-semibold text-forest-900 tracking-tight"
        >
          How it works
        </h2>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-cream-200 bg-white p-6 shadow-sm">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-forest-600 bg-forest-50 font-display text-base font-semibold text-forest-800">
              1
            </span>
            <h3 className="mt-4 font-display text-lg font-semibold text-forest-900">
              Find open teams
            </h3>
            <p className="mt-2 font-sans text-sm text-ink-muted leading-relaxed">
              Browse recruiting teams by role, goal, and skills — across the whole platform.
            </p>
          </div>

          <div className="rounded-lg border border-cream-200 bg-white p-6 shadow-sm">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-forest-600 bg-forest-50 font-display text-base font-semibold text-forest-800">
              2
            </span>
            <h3 className="mt-4 font-display text-lg font-semibold text-forest-900">
              Join or build a team
            </h3>
            <p className="mt-2 font-sans text-sm text-ink-muted leading-relaxed">
              Apply to open slots, accept invitations, or create your own team with vacancies.
            </p>
          </div>

          <div className="rounded-lg border border-cream-200 bg-white p-6 shadow-sm">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-forest-600 bg-forest-50 font-display text-base font-semibold text-forest-800">
              3
            </span>
            <h3 className="mt-4 font-display text-lg font-semibold text-forest-900">
              Find teammates & lock
            </h3>
            <p className="mt-2 font-sans text-sm text-ink-muted leading-relaxed">
              Turn on Looking for Team to get discovered, then lock your roster when you are ready.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="cta-heading" className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="rounded-2xl bg-forest-900 text-white p-8 sm:p-12 shadow-sm text-center space-y-6">
          <div className="max-w-2xl mx-auto space-y-3">
            <h2
              id="cta-heading"
              className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-cream-50"
            >
              {currentUser
                ? 'Ready to grow your roster?'
                : 'Ready to find your teammates?'}
            </h2>
            <p className="text-sm sm:text-base text-cream-200 leading-relaxed">
              {currentUser
                ? 'Open teams, find teammates who are looking to join, and manage requests in one place.'
                : 'Create a profile with skills and portfolios, then join open teams or declare you are looking for a team.'}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {currentUser ? (
              <>
                <button
                  type="button"
                  onClick={goOpenTeams}
                  className="w-full sm:w-auto px-6 py-3 bg-cream text-forest-900 text-sm font-semibold rounded-md shadow hover:bg-cream-100 focus:outline-none focus:ring-2 focus:ring-cream focus:ring-offset-2 focus:ring-offset-forest-900 transition"
                >
                  Browse open teams
                </button>
                <button
                  type="button"
                  onClick={onNavigateToLooking}
                  className="w-full sm:w-auto px-6 py-3 border border-cream-200 text-cream text-sm font-semibold rounded-md hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-cream focus:ring-offset-2 focus:ring-offset-forest-900 transition"
                >
                  Find teammates
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onNavigateToRegister}
                  className="w-full sm:w-auto px-6 py-3 bg-cream text-forest-900 text-sm font-semibold rounded-md shadow hover:bg-cream-100 focus:outline-none focus:ring-2 focus:ring-cream focus:ring-offset-2 focus:ring-offset-forest-900 transition"
                >
                  Create free account
                </button>
                <button
                  type="button"
                  onClick={onNavigateToLogin}
                  className="w-full sm:w-auto px-6 py-3 border border-cream-200 text-cream text-sm font-semibold rounded-md hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-cream focus:ring-offset-2 focus:ring-offset-forest-900 transition"
                >
                  Sign in to your account
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

import React, { useEffect, useState, useCallback } from 'react';
import { fetchMyTeams, AuthRequiredError, TeamApiError } from './teamApi';
import type { TeamView } from './teamTypes';
import { VERIFIED_EVENTS } from '../landing/landingData';

export interface MyTeamsPageProps {
  onCreateTeam: () => void;
  onSelectTeam: (eventId: string, teamId: string) => void;
}

export function MyTeamsPage({
  onCreateTeam,
  onSelectTeam,
}: MyTeamsPageProps): React.JSX.Element {
  const [teams, setTeams] = useState<Array<{ team: TeamView; eventName: string }>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadTeams = useCallback(async () => {
    setLoading(true);
    setAuthError(null);
    setErrorMessage(null);

    try {
      // Fetch all confirmed teams for the participant directly
      const fetchedTeams = await fetchMyTeams();
      const discoveredTeams: Array<{ team: TeamView; eventName: string }> = fetchedTeams.map((team) => {
        const ev = VERIFIED_EVENTS.find((e) => e.id === team.eventId);
        return {
          team,
          eventName: ev ? ev.name : 'HackMatch',
        };
      });

      setTeams(discoveredTeams);
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setAuthError('You need to sign in to view your teams.');
      } else if (err instanceof TeamApiError && err.status === 401) {
        setAuthError('You need to sign in to view your teams.');
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load teams.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="max-w-4xl mx-auto p-12 text-center text-sm font-medium text-forest-800 bg-white border border-cream-200 rounded-lg shadow-sm"
      >
        Loading your teams…
      </div>
    );
  }

  if (authError) {
    return (
      <div
        role="alert"
        className="max-w-lg mx-auto p-6 bg-red-50 border border-red-200 rounded-lg text-red-900 space-y-3"
      >
        <h2 className="text-sm font-semibold">Sign in Required</h2>
        <p className="text-xs">{authError}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-[1.75rem] font-semibold text-ink">My teams</h1>
        <button
          type="button"
          onClick={onCreateTeam}
          className="rounded-md bg-forest px-4 py-2 font-sans text-sm font-semibold text-white hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream transition"
        >
          Create a team
        </button>
      </header>

      {errorMessage && (
        <div
          role="alert"
          className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md text-red-800 text-sm"
        >
          {errorMessage}
        </div>
      )}

      {teams.length === 0 ? (
        <div className="rounded-lg border border-cream-200 bg-white p-10 text-center shadow-sm space-y-4">
          <p className="font-sans text-base text-ink-muted">
            You haven’t joined or created any teams yet.
          </p>
          <div>
            <button
              type="button"
              onClick={onCreateTeam}
              className="inline-flex items-center justify-center rounded-md bg-forest px-4 py-2 font-sans text-sm font-semibold text-white hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream transition"
            >
              Create a Team
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {teams.map(({ team, eventName }) => {
            const memberCount = team.members.length;
            const subtitle = `${eventName} · ${team.recruitmentStatus}`;

            return (
              <div
                key={team.id}
                className="rounded-lg border border-cream-200 bg-white p-5 shadow-sm hover:border-forest-300 transition"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-display text-[1.25rem] font-semibold text-ink">
                      <button
                        type="button"
                        onClick={() => onSelectTeam(team.eventId, team.id)}
                        className="text-left hover:text-forest-800 hover:underline focus:outline-none focus:ring-2 focus:ring-forest rounded"
                      >
                        {team.name}
                      </button>
                    </h2>
                    <p className="mt-1 font-sans text-sm text-ink-muted">{subtitle}</p>
                  </div>
                  <span className="font-sans text-sm text-ink-muted">
                    {memberCount} {memberCount === 1 ? 'member' : 'members'}
                  </span>
                </div>

                {team.pitch && (
                  <p className="mt-3 font-sans text-sm text-ink/80 leading-relaxed">
                    {team.pitch}
                  </p>
                )}

                {team.members.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {team.members.map((member) => {
                      const initial = (member.displayName || 'P').charAt(0).toUpperCase();
                      return (
                        <div
                          key={member.participantId}
                          className="flex items-center gap-2 rounded-full border border-cream-200 bg-cream-50 px-2.5 py-1"
                        >
                          <span
                            aria-hidden="true"
                            className="inline-flex items-center justify-center rounded-full border border-cream-300 bg-cream-200 font-sans font-semibold text-ink text-[10px] w-[26px] h-[26px]"
                          >
                            {initial}
                          </span>
                          <span className="font-sans text-sm text-ink">
                            {member.displayName} · {member.role}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import React from 'react';
import type { PublicEvent } from './eventTypes.js';

export interface EventTeamBoardSectionProps {
  timeState: PublicEvent['time_state'];
  isSignedIn: boolean;
  onSignIn?: () => void;
}

/**
 * Renders the team vacancy board shell for an event (US-008 Task 6 / Issue #77).
 * - Always renders the empty state notice: "No open teams available for this event yet."
 * - When timeState is 'concluded', displays role="note" read-only notice and NO action buttons.
 * - When not concluded and visitor (!isSignedIn), displays sign-in guidance and a button navigating via ?view=login.
 * - When signed in (PART), displays notice that team details will appear once listed.
 */
export function EventTeamBoardSection({
  timeState,
  isSignedIn,
  onSignIn,
}: EventTeamBoardSectionProps): React.JSX.Element {
  const isConcluded = timeState === 'concluded';

  const handleSignIn = () => {
    if (onSignIn) {
      onSignIn();
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.href = '?view=login';
    }
  };

  return (
    <section
      aria-labelledby="team-board-heading"
      className="border-t border-cream-200 pt-6 mt-6 space-y-4"
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 id="team-board-heading" className="text-base font-bold text-ink">
          Team Vacancy Board
        </h3>
      </div>

      {isConcluded && (
        <div
          role="note"
          className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 rounded font-medium"
        >
          This event has concluded. The team board is read-only.
        </div>
      )}

      {/* Always present empty state per specification */}
      <div className="bg-cream-50 border border-cream-200 rounded-lg p-5 text-center space-y-3">
        <p className="text-sm text-ink-muted">
          No open teams available for this event yet.
        </p>

        {!isConcluded && !isSignedIn && (
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
            <span className="text-xs text-ink">
              Sign in to view team details and apply
            </span>
            <button
              type="button"
              onClick={handleSignIn}
              className="text-xs font-semibold px-4 py-2 bg-forest text-white rounded hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 transition"
            >
              Sign In
            </button>
          </div>
        )}

        {!isConcluded && isSignedIn && (
          <p className="text-xs text-ink-muted italic">
            Team details will appear here once teams are listed.
          </p>
        )}

        {isConcluded && isSignedIn && (
          <p className="text-xs text-ink-muted italic">
            Team details will appear here once teams are listed.
          </p>
        )}
      </div>
    </section>
  );
}

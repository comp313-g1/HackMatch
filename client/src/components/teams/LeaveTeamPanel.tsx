import React, { useEffect, useRef, useState } from 'react';
import { leaveTeam, TeamApiError, AuthRequiredError } from './teamApi';

export interface LeaveTeamPanelProps {
  teamId: string;
  teamName: string;
  disabled: boolean;
  onLeft: (notice: string) => void;
}

/**
 * US-019 / #183 — confirmed non-owner Leave Team control (FR-059).
 */
export function LeaveTeamPanel({
  teamId,
  teamName,
  disabled,
  onLeft,
}: LeaveTeamPanelProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
    }
  }, [confirming]);

  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setConfirming(false);
        setError(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming]);

  const handleLeave = async () => {
    if (disabled || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await leaveTeam(teamId);
      setConfirming(false);
      onLeft(result.message);
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setError('You need to sign in to leave a team.');
      } else if (err instanceof TeamApiError) {
        setError(err.message || 'Could not leave the team.');
      } else {
        setError('Could not leave the team.');
      }
    } finally {
      setBusy(false);
    }
  };

  const isDisabled = disabled || busy;

  return (
    <section
      aria-labelledby="leave-team-heading"
      className="p-4 bg-white border border-cream-200 rounded-lg shadow-sm space-y-3"
    >
      <h3 id="leave-team-heading" className="text-sm font-semibold text-forest-900">
        Your membership
      </h3>
      <p className="text-xs text-ink-muted">
        You are a confirmed member of <span className="font-medium text-ink">{teamName}</span>.
        Before roster lock you may leave; the Team Lead is notified and your Looking-for-Team
        availability may be restored.
      </p>

      {error && (
        <p role="alert" className="text-xs text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {!confirming ? (
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className="px-4 py-2 text-xs font-semibold rounded-md border border-red-300 text-red-800 bg-red-50 hover:bg-red-100 disabled:opacity-50"
        >
          Leave team
        </button>
      ) : (
        <div
          role="dialog"
          aria-labelledby="leave-confirm-title"
          aria-describedby="leave-confirm-desc"
          className="p-3 border border-red-200 bg-red-50 rounded-md space-y-3"
        >
          <h4 id="leave-confirm-title" className="text-sm font-semibold text-red-900">
            Leave this team?
          </h4>
          <p id="leave-confirm-desc" className="text-xs text-red-800">
            You will leave &quot;{teamName}&quot;. Previously canceled invitations or applications
            for this team stay canceled.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              ref={cancelRef}
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-md border border-cream-300 bg-white text-ink hover:bg-cream-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isDisabled}
              onClick={handleLeave}
              className="px-3 py-1.5 text-xs font-semibold rounded-md bg-red-700 text-white hover:bg-red-800 disabled:opacity-50"
            >
              {busy ? 'Leaving…' : 'Yes, leave team'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

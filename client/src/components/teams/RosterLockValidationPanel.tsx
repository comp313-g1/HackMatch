import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { RosterLockValidationResult, TeamMemberView } from './teamTypes';
import { validateTeamLock, TeamApiError, AuthRequiredError } from './teamApi';

export type RosterLockValidationViewState =
  | 'loading'
  | 'success'
  | 'validation'
  | 'empty'
  | 'error';

export interface RosterLockValidationPanelProps {
  teamId: string;
  /** Confirmed members from the parent workspace — preserved across validation errors. */
  members: TeamMemberView[];
  disabled?: boolean;
  refreshKey?: number;
  onValidationChange?: (result: RosterLockValidationResult | null) => void;
}

function resolveViewState(
  loading: boolean,
  error: string | null,
  result: RosterLockValidationResult | null
): RosterLockValidationViewState {
  if (loading && !result) return 'loading';
  if (error && !result) return 'error';
  if (!result) return 'loading';
  if (result.memberCount === 0) return 'empty';
  if (result.canLock) return 'success';
  return 'validation';
}

/**
 * US-022 / #207 / FR-066 — owner-only roster lock validation panel.
 * Loading / success / validation / empty / error. Soft validation failures keep
 * the prior roster snapshot and the last known validation payload.
 */
export function RosterLockValidationPanel({
  teamId,
  members,
  disabled = false,
  refreshKey = 0,
  onValidationChange,
}: RosterLockValidationPanelProps): React.JSX.Element {
  const [result, setResult] = useState<RosterLockValidationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const runValidation = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const next = await validateTeamLock(teamId);
      if (requestId !== requestSequence.current) return;
      setResult(next);
      onValidationChange?.(next);
    } catch (err: unknown) {
      if (requestId !== requestSequence.current) return;
      // Preserve prior validation + parent members on failure (task requirement).
      if (err instanceof AuthRequiredError || (err instanceof TeamApiError && err.status === 401)) {
        setError('You need to sign in to validate roster lock eligibility.');
      } else if (err instanceof TeamApiError && err.status === 403) {
        setError('Only the team owner can validate roster lock eligibility.');
      } else if (err instanceof TeamApiError && err.status === 404) {
        setError('Team not found.');
      } else if (err instanceof TeamApiError && err.code === 'NETWORK') {
        setError('Network error. Previous roster details were kept.');
      } else if (err instanceof TeamApiError) {
        setError(err.message || 'Could not validate roster lock eligibility.');
      } else {
        setError('Could not validate roster lock eligibility.');
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [teamId, onValidationChange]);

  useEffect(() => {
    void runValidation();
  }, [runValidation, refreshKey]);

  const viewState = resolveViewState(loading, error, result);
  const displayedMembers =
    result?.members?.length
      ? result.members
      : members.map((m) => ({
          participantId: m.participantId,
          displayName: m.displayName,
          role: m.role,
        }));

  return (
    <section
      className="rounded-lg border border-cream-200 bg-white p-4 space-y-3 shadow-sm"
      data-testid="roster-lock-validation-panel"
      aria-labelledby="roster-lock-validation-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <h3
            id="roster-lock-validation-heading"
            className="text-sm font-semibold text-forest-900 uppercase tracking-wide"
          >
            Confirm &amp; lock eligibility
          </h3>
          <p className="text-xs text-ink-muted">
            Checks confirmed members against the event minimum and maximum before locking.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runValidation()}
          disabled={disabled || loading}
          className="px-3 py-1.5 text-xs font-semibold border border-cream-300 rounded bg-cream-50 hover:bg-cream-100 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="roster-lock-validate-retry"
        >
          {loading ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      {loading && !result ? (
        <div
          role="status"
          aria-busy="true"
          className="text-xs text-forest-800"
          data-testid="roster-lock-validation-loading"
        >
          Checking lock eligibility…
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2 space-y-1"
          data-testid="roster-lock-validation-error"
        >
          <p>{error}</p>
          {result ? (
            <p className="text-red-700/90">Previous validation result was kept.</p>
          ) : (
            <p className="text-red-700/90">Previous roster details were kept.</p>
          )}
        </div>
      ) : null}

      {viewState === 'empty' && result ? (
        <div
          role="status"
          className="text-xs text-ink-muted border border-dashed border-cream-300 rounded-md px-3 py-3 text-center"
          data-testid="roster-lock-validation-empty"
        >
          No confirmed members on this roster yet. Invite or approve members before locking.
        </div>
      ) : null}

      {result && viewState === 'success' ? (
        <div
          role="status"
          className="text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 space-y-1"
          data-testid="roster-lock-validation-success"
        >
          <p className="font-semibold">Roster is eligible to lock.</p>
          <p>
            {result.memberCount} confirmed member
            {result.memberCount === 1 ? '' : 's'} (requires {result.minRequired}–
            {result.maxAllowed}).
          </p>
        </div>
      ) : null}

      {result && viewState === 'validation' ? (
        <div
          role="status"
          className="text-xs text-amber-950 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 space-y-2"
          data-testid="roster-lock-validation-blocked"
        >
          <p className="font-semibold">Roster is not ready to lock.</p>
          <ul className="list-disc pl-4 space-y-1" data-testid="roster-lock-validation-reasons">
            {result.reasons.map((reason) => (
              <li key={reason.code} data-testid={`roster-lock-reason-${reason.code}`}>
                {reason.message}
              </li>
            ))}
          </ul>
          <p className="text-amber-900/80">
            Confirmed: {result.memberCount} · Required: {result.minRequired}–
            {result.maxAllowed}
            {result.openSlots > 0 ? ` · Open slots: ${result.openSlots}` : ''}
          </p>
        </div>
      ) : null}

      {displayedMembers.length > 0 ? (
        <div className="space-y-1" data-testid="roster-lock-validation-members">
          <h4 className="text-xs font-semibold text-forest-900 uppercase tracking-wide">
            Confirmed members
          </h4>
          <ul className="divide-y divide-cream-100 text-xs">
            {displayedMembers.map((member) => (
              <li
                key={member.participantId}
                className="flex items-center justify-between gap-2 py-1.5"
              >
                <span className="font-medium text-ink truncate">{member.displayName}</span>
                <span className="text-[10px] uppercase tracking-wide text-ink-muted">
                  {member.role}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {disabled ? (
        <p className="text-[11px] text-ink-muted" data-testid="roster-lock-validation-disabled">
          Lock validation is unavailable while the team is read-only.
        </p>
      ) : null}
    </section>
  );
}

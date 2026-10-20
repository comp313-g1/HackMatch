import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { RosterLockValidationResult, TeamMemberView, TeamView } from './teamTypes';
import { validateTeamLock, lockTeam, TeamApiError, AuthRequiredError } from './teamApi';
import { canceledRequestsOnLockNotice } from './requestCancelReason';
import { LockedRosterBadge } from './LockedRosterBadge';

export type ConfirmLockViewState =
  | 'loading'
  | 'success'
  | 'validation'
  | 'empty'
  | 'error'
  | 'locked';

export interface ConfirmLockRosterPanelProps {
  teamId: string;
  /** Confirmed members from the parent workspace — preserved across validation errors. */
  members: TeamMemberView[];
  /** When true, team is already locked (or otherwise read-only). */
  disabled?: boolean;
  /** Server lock timestamp when recruitmentStatus is Locked. */
  lockedAt?: string | null;
  refreshKey?: number;
  onValidationChange?: (result: RosterLockValidationResult | null) => void;
  /** Called after a successful atomic lock; parent should adopt the returned team. */
  onLocked?: (result: {
    team: TeamView;
    lockedAt: string;
    canceledRequests: number;
    message: string;
  }) => void;
}

function resolveViewState(
  locked: boolean,
  loading: boolean,
  error: string | null,
  result: RosterLockValidationResult | null
): ConfirmLockViewState {
  if (locked) return 'locked';
  if (loading && !result) return 'loading';
  if (error && !result) return 'error';
  if (!result) return 'loading';
  if (result.memberCount === 0) return 'empty';
  if (result.canLock) return 'success';
  return 'validation';
}

/**
 * US-022 / #211 / FR-066 / FR-067 — owner roster review, Confirm & Lock modal, and locked status.
 * Composes validation (#207) with the atomic lock POST (#208) and post-lock freeze UX.
 */
export function ConfirmLockRosterPanel({
  teamId,
  members,
  disabled = false,
  lockedAt = null,
  refreshKey = 0,
  onValidationChange,
  onLocked,
}: ConfirmLockRosterPanelProps): React.JSX.Element {
  const [result, setResult] = useState<RosterLockValidationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const cancelConfirmRef = useRef<HTMLButtonElement | null>(null);

  const isLocked =
    disabled ||
    result?.recruitmentStatus === 'Locked' ||
    Boolean(lockedAt);

  const runValidation = useCallback(async () => {
    if (disabled && lockedAt) {
      setLoading(false);
      return;
    }
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
      if (err instanceof AuthRequiredError || (err instanceof TeamApiError && err.status === 401)) {
        setError('You need to sign in to confirm and lock the roster.');
      } else if (err instanceof TeamApiError && err.status === 403) {
        setError('Only the team owner can confirm and lock the roster.');
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
  }, [teamId, onValidationChange, disabled, lockedAt]);

  useEffect(() => {
    void runValidation();
  }, [runValidation, refreshKey]);

  useEffect(() => {
    if (confirming) {
      cancelConfirmRef.current?.focus();
    }
  }, [confirming]);

  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        setConfirming(false);
        setLockError(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming, busy]);

  const viewState = resolveViewState(isLocked, loading, error, result);
  const canOfferLock = viewState === 'success' && Boolean(result?.canLock) && !busy;
  const displayedMembers =
    result?.members?.length
      ? result.members
      : members.map((m) => ({
          participantId: m.participantId,
          displayName: m.displayName,
          role: m.role,
        }));

  const handleConfirmLock = async () => {
    if (!canOfferLock || busy) return;
    setBusy(true);
    setLockError(null);
    try {
      const locked = await lockTeam(teamId);
      setConfirming(false);
      setResult((prev) =>
        prev
          ? {
              ...prev,
              canLock: false,
              recruitmentStatus: 'Locked',
              lockedAt: locked.lockedAt,
              reasons: [
                {
                  code: 'ALREADY_LOCKED',
                  message: 'This roster is already locked.',
                },
              ],
            }
          : prev
      );
      const cancelNotice = canceledRequestsOnLockNotice(locked.canceledRequests);
      onLocked?.({
        team: locked.team,
        lockedAt: locked.lockedAt,
        canceledRequests: locked.canceledRequests,
        message: locked.message || `Roster locked. ${cancelNotice}`,
      });
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError || (err instanceof TeamApiError && err.status === 401)) {
        setLockError('You need to sign in to lock the roster.');
      } else if (err instanceof TeamApiError && err.status === 403) {
        setLockError('Only the team owner can lock the roster.');
      } else if (err instanceof TeamApiError && err.code === 'BELOW_MIN_MEMBERS') {
        setLockError(err.message || 'Not enough confirmed members to lock this roster.');
        setConfirming(false);
        void runValidation();
      } else if (err instanceof TeamApiError && err.code === 'ALREADY_LOCKED') {
        setLockError(err.message || 'This roster is already locked.');
        setConfirming(false);
        void runValidation();
      } else if (err instanceof TeamApiError && err.code === 'NETWORK') {
        setLockError('Network error. The roster was not locked. Try again.');
      } else if (err instanceof TeamApiError) {
        setLockError(err.message || 'Could not lock the roster.');
      } else {
        setLockError('Could not lock the roster.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="rounded-lg border border-cream-200 bg-white p-4 space-y-3 shadow-sm"
      data-testid="confirm-lock-roster-panel"
      aria-labelledby="confirm-lock-roster-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <h3
            id="confirm-lock-roster-heading"
            className="text-sm font-semibold text-forest-900 uppercase tracking-wide"
          >
            Confirm &amp; lock roster
          </h3>
          <p className="text-xs text-ink-muted">
            Review confirmed members, then lock when the roster meets the event minimum and
            maximum. Locking is permanent.
          </p>
        </div>
        {!isLocked ? (
          <button
            type="button"
            onClick={() => void runValidation()}
            disabled={loading || busy}
            className="px-3 py-1.5 text-xs font-semibold border border-cream-300 rounded bg-cream-50 hover:bg-cream-100 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="confirm-lock-recheck"
          >
            {loading ? 'Checking…' : 'Re-check'}
          </button>
        ) : null}
      </div>

      {viewState === 'locked' ? (
        <LockedRosterBadge lockedAt={lockedAt ?? result?.lockedAt ?? null} variant="note" />
      ) : null}

      {viewState === 'loading' ? (
        <div
          role="status"
          aria-busy="true"
          className="text-xs text-forest-800"
          data-testid="confirm-lock-loading"
        >
          Checking lock eligibility…
        </div>
      ) : null}

      {error && viewState !== 'locked' ? (
        <div
          role="alert"
          className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2 space-y-1"
          data-testid="confirm-lock-error"
        >
          <p>{error}</p>
          {result ? (
            <p className="text-red-700/90">Previous validation result was kept.</p>
          ) : (
            <p className="text-red-700/90">Previous roster details were kept.</p>
          )}
        </div>
      ) : null}

      {lockError ? (
        <div
          role="alert"
          className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2"
          data-testid="confirm-lock-action-error"
        >
          {lockError}
        </div>
      ) : null}

      {viewState === 'empty' && result ? (
        <div
          role="status"
          className="text-xs text-ink-muted border border-dashed border-cream-300 rounded-md px-3 py-3 text-center"
          data-testid="confirm-lock-empty"
        >
          No confirmed members on this roster yet. Invite or approve members before locking.
        </div>
      ) : null}

      {viewState === 'success' && result ? (
        <div
          role="status"
          className="text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 space-y-1"
          data-testid="confirm-lock-eligible"
        >
          <p className="font-semibold">Roster is eligible to lock.</p>
          <p>
            {result.memberCount} confirmed member
            {result.memberCount === 1 ? '' : 's'} (requires {result.minRequired}–
            {result.maxAllowed}).
          </p>
        </div>
      ) : null}

      {viewState === 'validation' && result ? (
        <div
          role="status"
          className="text-xs text-amber-950 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 space-y-2"
          data-testid="confirm-lock-blocked"
        >
          <p className="font-semibold">Roster is not ready to lock.</p>
          <ul className="list-disc pl-4 space-y-1" data-testid="confirm-lock-reasons">
            {result.reasons.map((reason) => (
              <li key={reason.code} data-testid={`confirm-lock-reason-${reason.code}`}>
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

      {displayedMembers.length > 0 && viewState !== 'locked' ? (
        <div className="space-y-1" data-testid="confirm-lock-roster-review">
          <h4 className="text-xs font-semibold text-forest-900 uppercase tracking-wide">
            Roster review
          </h4>
          <ul className="divide-y divide-cream-100 text-xs">
            {displayedMembers.map((member) => (
              <li
                key={member.participantId}
                className="flex items-center justify-between gap-2 py-1.5"
                data-testid={`confirm-lock-member-${member.participantId}`}
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

      {viewState !== 'locked' && !confirming ? (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1 border-t border-cream-100">
          <p className="text-xs text-ink-muted">
            Locking cancels remaining pending invitations and applications and freezes the roster.
          </p>
          <button
            type="button"
            disabled={!canOfferLock}
            onClick={() => {
              setLockError(null);
              setConfirming(true);
            }}
            className="px-4 py-2 text-xs font-semibold rounded-md text-white bg-forest hover:bg-forest-800 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="confirm-lock-open"
          >
            Confirm &amp; Lock Roster
          </button>
        </div>
      ) : null}

      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="confirm-lock-dialog-title"
          aria-describedby="confirm-lock-dialog-desc"
          className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3"
          data-testid="confirm-lock-dialog"
        >
          <h4 id="confirm-lock-dialog-title" className="text-sm font-semibold text-amber-950">
            Lock this roster permanently?
          </h4>
          <p id="confirm-lock-dialog-desc" className="text-xs text-amber-900">
            Confirmed members will be finalized. Remaining pending invitations and applications
            will be canceled. Leaving, removals, slot edits, and disbanding will no longer be
            allowed. This cannot be undone.
          </p>
          {result ? (
            <p className="text-xs text-amber-900/90" data-testid="confirm-lock-dialog-summary">
              {result.memberCount} confirmed member
              {result.memberCount === 1 ? '' : 's'} will be locked
              {result.openSlots > 0
                ? `; ${result.openSlots} open slot${result.openSlots === 1 ? '' : 's'} will stay unfilled.`
                : '.'}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => void handleConfirmLock()}
              disabled={busy}
              className="px-4 py-2 bg-forest text-white text-xs font-semibold rounded-md hover:bg-forest-800 disabled:opacity-50"
              data-testid="confirm-lock-submit"
            >
              {busy ? 'Locking…' : 'Yes, Lock Roster'}
            </button>
            <button
              ref={cancelConfirmRef}
              type="button"
              onClick={() => {
                setConfirming(false);
                setLockError(null);
              }}
              disabled={busy}
              className="px-4 py-2 bg-white border border-cream-300 text-ink text-xs font-medium rounded-md hover:bg-cream-100 disabled:opacity-50"
              data-testid="confirm-lock-cancel"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

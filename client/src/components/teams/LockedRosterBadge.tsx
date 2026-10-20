import React from 'react';

export interface LockedRosterBadgeProps {
  /** Server lock timestamp (ISO) when known. */
  lockedAt?: string | null;
  /** Compact chip for headers vs expanded note for status panels. */
  variant?: 'badge' | 'note';
  className?: string;
}

/**
 * US-022 / #211 / FR-067 — locked roster badge and status confirmation for members/owners.
 */
export function LockedRosterBadge({
  lockedAt = null,
  variant = 'badge',
  className = '',
}: LockedRosterBadgeProps): React.JSX.Element {
  if (variant === 'note') {
    return (
      <div
        role="status"
        className={`text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 ${className}`}
        data-testid="locked-roster-status-note"
      >
        <p className="font-semibold" data-testid="locked-roster-status-label">
          Roster locked
        </p>
        <p className="mt-0.5">
          Membership is finalized. Leaving, removals, slot edits, and disbanding are closed.
        </p>
        {lockedAt ? (
          <p className="mt-1 text-amber-800/90" data-testid="locked-roster-locked-at">
            Locked at {new Date(lockedAt).toLocaleString()}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold border bg-amber-50 text-amber-900 border-amber-200 ${className}`}
      data-testid="locked-roster-badge"
      title={lockedAt ? `Locked at ${new Date(lockedAt).toLocaleString()}` : 'Roster locked'}
    >
      Locked
      {lockedAt ? (
        <span className="font-normal text-amber-800/90" data-testid="locked-roster-badge-time">
          · {new Date(lockedAt).toLocaleString()}
        </span>
      ) : null}
    </span>
  );
}

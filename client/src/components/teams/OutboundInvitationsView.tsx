import React from 'react';
import type { OwnerInvitationListItem } from './invitationsApi';
import { cancelReasonLabel } from './requestCancelReason';

export type InvitationListState = 'loading' | 'success' | 'error';

export interface OutboundInvitationsViewProps {
  invitations: OwnerInvitationListItem[];
  listState: InvitationListState;
  emptyMessage: string | null;
  listError: string | null;
  disabled?: boolean;
  cancelingId: string | null;
  onRetry: () => void;
  onCancel: (invitationId: string) => void;
}

function displayStatus(inv: OwnerInvitationListItem): string {
  if (inv.status === 'Expired' || (inv.expiredByClock && inv.status === 'Pending')) {
    return 'Expired';
  }
  return inv.status;
}

function expiryLabel(inv: OwnerInvitationListItem): string {
  if (!inv.expiresAt) return 'No expiry on record';
  if (inv.status === 'Expired' || inv.expiredByClock) {
    return 'Expired after 48 hours — acceptance is rejected';
  }
  return `Expires ${new Date(inv.expiresAt).toLocaleString()} (48h window)`;
}

/**
 * Owner outbound invitation list (US-017 / #167) — loading, empty, error, and success rows.
 */
export function OutboundInvitationsView({
  invitations,
  listState,
  emptyMessage,
  listError,
  disabled = false,
  cancelingId,
  onRetry,
  onCancel,
}: OutboundInvitationsViewProps): React.JSX.Element {
  return (
    <div className="space-y-2" data-testid="outbound-invitations-view" aria-label="Outbound invitations">
      {listState === 'loading' && invitations.length === 0 ? (
        <p role="status" className="text-xs text-forest-800" data-testid="invitations-loading">
          Loading invitations…
        </p>
      ) : null}

      {listState === 'loading' && invitations.length > 0 ? (
        <p role="status" className="text-xs text-ink-muted" data-testid="invitations-refreshing">
          Refreshing invitations…
        </p>
      ) : null}

      {listState === 'error' ? (
        <div
          role="alert"
          className="text-xs text-red-800 space-y-2"
          data-testid="invitations-list-error"
        >
          <p>{listError}</p>
          <p>Your team details were kept.</p>
          <button
            type="button"
            onClick={onRetry}
            className="px-3 py-1 text-xs font-medium border border-red-200 rounded bg-white hover:bg-red-50"
          >
            Retry
          </button>
        </div>
      ) : null}

      {listState === 'success' && invitations.length === 0 ? (
        <div
          role="status"
          className="p-4 text-center text-xs text-ink-muted border border-dashed border-cream-300 rounded-md"
          data-testid="invitations-empty"
        >
          {emptyMessage || 'No invitations yet.'}
        </div>
      ) : null}

      {invitations.length > 0 ? (
        <ul className="space-y-2" data-testid="invitations-list">
          {invitations.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-cream-200 px-3 py-2 text-xs"
              data-testid={`invitation-row-${inv.id}`}
            >
              <div className="space-y-0.5">
                <p className="font-medium text-forest-900">
                  {inv.inviteeHandle?.trim() || inv.inviteeDisplayName}
                  {inv.vacancyRole ? (
                    <span className="font-normal text-ink-muted"> · {inv.vacancyRole}</span>
                  ) : null}
                </p>
                <p className="text-ink-muted">
                  Status:{' '}
                  <span data-testid={`invitation-status-${inv.id}`}>{displayStatus(inv)}</span>
                  {' · '}
                  <span data-testid={`invitation-expiry-${inv.id}`}>{expiryLabel(inv)}</span>
                </p>
                {cancelReasonLabel(inv.cancelReason) ? (
                  <p
                    className="text-amber-900/90"
                    data-testid={`invitation-cancel-reason-${inv.id}`}
                  >
                    {cancelReasonLabel(inv.cancelReason)}
                  </p>
                ) : null}
              </div>
              {inv.status === 'Pending' && !inv.expiredByClock ? (
                <button
                  type="button"
                  onClick={() => onCancel(inv.id)}
                  disabled={disabled || cancelingId === inv.id}
                  className="px-2 py-1 text-xs font-medium border border-cream-300 rounded bg-white hover:bg-cream-50 disabled:opacity-50"
                  data-testid={`cancel-invitation-${inv.id}`}
                >
                  {cancelingId === inv.id ? 'Canceling…' : 'Cancel invite'}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

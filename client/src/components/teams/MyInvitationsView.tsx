import React from 'react';
import type { InviteeInvitationListItem } from './invitationsApi';
import { cancelReasonLabel } from './requestCancelReason';

export type InvitationInboxListState = 'loading' | 'success' | 'error';

export interface MyInvitationsViewProps {
  invitations: InviteeInvitationListItem[];
  listState: InvitationInboxListState;
  emptyMessage: string | null;
  listError: string | null;
  selectedId: string | null;
  disabled?: boolean;
  respondingId: string | null;
  onRetry: () => void;
  onSelect: (invitationId: string) => void;
  onAccept: (invitationId: string) => void;
  onDecline: (invitationId: string) => void;
}

function expiryLabel(inv: InviteeInvitationListItem): string {
  if (!inv.expiresAt) return 'No expiry on record';
  if (inv.status === 'Expired' || inv.expiredByClock) {
    return 'Expired after 48 hours — acceptance is rejected';
  }
  return `Expires ${new Date(inv.expiresAt).toLocaleString()} (48h window)`;
}

function statusBadgeClass(statusLabel: string): string {
  switch (statusLabel) {
    case 'Pending':
      return 'bg-amber-50 text-amber-900 border-amber-200';
    case 'Accepted':
      return 'bg-emerald-50 text-emerald-900 border-emerald-200';
    case 'Declined':
      return 'bg-slate-100 text-slate-800 border-slate-200';
    case 'Canceled':
    case 'Withdrawn':
      return 'bg-cream-100 text-ink-muted border-cream-200';
    case 'Expired':
      return 'bg-red-50 text-red-800 border-red-200';
    default:
      return 'bg-cream-50 text-ink border-cream-200';
  }
}

/**
 * Invitee inbound invitations (US-019 / #179) — list, detail select, Accept/Decline.
 */
export function MyInvitationsView({
  invitations,
  listState,
  emptyMessage,
  listError,
  selectedId,
  disabled = false,
  respondingId,
  onRetry,
  onSelect,
  onAccept,
  onDecline,
}: MyInvitationsViewProps): React.JSX.Element {
  const selected = invitations.find((inv) => inv.id === selectedId) ?? null;

  return (
    <div className="space-y-4" data-testid="my-invitations-view" aria-label="My invitations">
      {listState === 'loading' && invitations.length === 0 ? (
        <p role="status" className="text-xs text-forest-800" data-testid="invitations-inbox-loading">
          Loading invitations…
        </p>
      ) : null}

      {listState === 'loading' && invitations.length > 0 ? (
        <p
          role="status"
          className="text-xs text-ink-muted"
          data-testid="invitations-inbox-refreshing"
        >
          Refreshing invitations…
        </p>
      ) : null}

      {listState === 'error' ? (
        <div
          role="alert"
          className="text-xs text-red-800 space-y-2"
          data-testid="invitations-inbox-error"
        >
          <p>{listError}</p>
          <p>Your invitation list was kept.</p>
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
          data-testid="invitations-inbox-empty"
        >
          {emptyMessage || 'No invitations yet.'}
        </div>
      ) : null}

      {invitations.length > 0 ? (
        <ul className="space-y-2" data-testid="invitations-inbox-list">
          {invitations.map((inv) => (
            <li
              key={inv.id}
              className={`rounded-md border px-3 py-2 text-xs ${
                selectedId === inv.id
                  ? 'border-forest-300 bg-forest-50/40'
                  : 'border-cream-200 bg-white'
              }`}
              data-testid={`invitation-inbox-row-${inv.id}`}
            >
              <button
                type="button"
                onClick={() => onSelect(inv.id)}
                className="w-full text-left space-y-0.5"
                data-testid={`select-invitation-${inv.id}`}
              >
                <p className="font-medium text-forest-900">
                  {inv.teamName}
                  {inv.vacancyRole ? (
                    <span className="font-normal text-ink-muted"> · {inv.vacancyRole}</span>
                  ) : null}
                </p>
                <p className="text-ink-muted flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${statusBadgeClass(inv.statusLabel || inv.status)}`}
                    data-testid={`invitation-inbox-status-${inv.id}`}
                  >
                    {inv.statusLabel || inv.status}
                  </span>
                  <span data-testid={`invitation-inbox-expiry-${inv.id}`}>
                    {expiryLabel(inv)}
                  </span>
                </p>
                {cancelReasonLabel(inv.cancelReason) ? (
                  <p
                    className="text-amber-900/90"
                    data-testid={`invitation-inbox-cancel-reason-${inv.id}`}
                  >
                    {cancelReasonLabel(inv.cancelReason)}
                  </p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {selected ? (
        <div
          className="rounded-md border border-cream-200 bg-cream-50/50 p-3 space-y-3 text-xs"
          data-testid="invitation-detail-panel"
          aria-label="Invitation details"
        >
          <h4 className="text-sm font-semibold text-forest-900">Invitation details</h4>
          <dl className="space-y-1.5">
            <div className="flex gap-2">
              <dt className="font-medium text-ink-muted shrink-0">Team</dt>
              <dd data-testid="invitation-detail-team">
                {selected.permittedDetails?.teamName || selected.teamName}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-ink-muted shrink-0">Open slot</dt>
              <dd data-testid="invitation-detail-slot">
                {selected.permittedDetails?.vacancyRole || selected.vacancyRole || '—'}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-ink-muted shrink-0">Status</dt>
              <dd data-testid="invitation-detail-status">
                {selected.permittedDetails?.statusLabel || selected.statusLabel}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-ink-muted shrink-0">Expires</dt>
              <dd data-testid="invitation-detail-expiry">{expiryLabel(selected)}</dd>
            </div>
            {cancelReasonLabel(selected.cancelReason) ? (
              <div className="flex gap-2">
                <dt className="font-medium text-ink-muted shrink-0">Outcome</dt>
                <dd data-testid="invitation-detail-cancel-reason">
                  {cancelReasonLabel(selected.cancelReason)}
                </dd>
              </div>
            ) : null}
          </dl>

          {selected.canRespond ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onAccept(selected.id)}
                disabled={disabled || respondingId === selected.id}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-forest rounded hover:bg-forest-800 disabled:opacity-50"
                data-testid={`accept-invitation-${selected.id}`}
              >
                {respondingId === selected.id ? 'Working…' : 'Accept'}
              </button>
              <button
                type="button"
                onClick={() => onDecline(selected.id)}
                disabled={disabled || respondingId === selected.id}
                className="px-3 py-1.5 text-xs font-medium border border-cream-300 rounded bg-white hover:bg-cream-50 disabled:opacity-50"
                data-testid={`decline-invitation-${selected.id}`}
              >
                {respondingId === selected.id ? 'Working…' : 'Decline'}
              </button>
            </div>
          ) : (
            <p className="text-ink-muted" data-testid="invitation-detail-closed">
              This invitation can no longer be accepted or declined.
            </p>
          )}
        </div>
      ) : invitations.length > 0 ? (
        <p
          role="status"
          className="text-xs text-ink-muted"
          data-testid="invitation-detail-empty"
        >
          Select an invitation to inspect team details and respond.
        </p>
      ) : null}
    </div>
  );
}

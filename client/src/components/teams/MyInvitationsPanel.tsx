import React, { useCallback, useEffect, useState } from 'react';
import { MyInvitationsView, type InvitationInboxListState } from './MyInvitationsView';
import {
  AuthRequiredError,
  fetchInvitationDetail,
  fetchMyInvitations,
  respondToInvitation,
  TeamInvitationsApiError,
  type InviteeInvitationListItem,
} from './invitationsApi';

export interface MyInvitationsPanelProps {
  disabled?: boolean;
  refreshKey?: number;
  onStatusNotice?: (notice: string) => void;
}

/**
 * Stateful US-019 / #179 My Invitations panel: list, detail, Accept/Decline.
 * List and detail selection are preserved on response failures (NR-017).
 */
export function MyInvitationsPanel({
  disabled = false,
  refreshKey = 0,
  onStatusNotice,
}: MyInvitationsPanelProps): React.JSX.Element {
  const [invitations, setInvitations] = useState<InviteeInvitationListItem[]>([]);
  const [listState, setListState] = useState<InvitationInboxListState>('loading');
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [statusAlert, setStatusAlert] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setListState('loading');
    setListError(null);
    try {
      const result = await fetchMyInvitations();
      setInvitations(result.invitations);
      setEmptyMessage(result.message);
      setListState('success');
      setSelectedId((prev) => {
        if (prev && result.invitations.some((inv) => inv.id === prev)) return prev;
        return null;
      });
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setListError('You need to sign in to view your invitations.');
      } else if (err instanceof TeamInvitationsApiError) {
        setListError(err.message || 'Could not load invitations.');
      } else {
        setListError('Could not load invitations.');
      }
      setListState('error');
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList, refreshKey]);

  const handleSelect = async (invitationId: string) => {
    setResponseError(null);
    setFieldError(null);
    setSelectedId(invitationId);
    try {
      const detail = await fetchInvitationDetail(invitationId);
      setInvitations((prev) =>
        prev.map((inv) => (inv.id === invitationId ? { ...inv, ...detail } : inv))
      );
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setResponseError('You need to sign in to inspect this invitation.');
      } else if (err instanceof TeamInvitationsApiError) {
        setResponseError(err.message || 'Could not load invitation details.');
      } else {
        setResponseError('Could not load invitation details.');
      }
    }
  };

  const handleRespond = async (invitationId: string, decision: 'accept' | 'decline') => {
    if (disabled || respondingId) return;
    setResponseError(null);
    setFieldError(null);
    setSuccessNotice(null);
    setStatusAlert(null);
    setRespondingId(invitationId);
    try {
      const result = await respondToInvitation(invitationId, decision);
      const inviteeAlert = result.alerts.find((a) => a.audience === 'invitee');
      const ownerAlert = result.alerts.find((a) => a.audience === 'owner');
      setSuccessNotice(result.notice);
      if (decision === 'decline') {
        setStatusAlert(
          inviteeAlert?.message ??
            ownerAlert?.message ??
            'Invitation declined. The team owner has been notified.'
        );
      } else {
        setStatusAlert(
          result.membershipCommitted
            ? 'Invitation accepted. Your team membership is confirmed.'
            : result.notice
        );
      }
      onStatusNotice?.(result.notice);
      await loadList();
      setSelectedId(invitationId);
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setResponseError('You need to sign in to respond to an invitation.');
      } else if (err instanceof TeamInvitationsApiError) {
        setResponseError(err.message || 'Could not respond to invitation.');
        if (err.errors?.decision) {
          setFieldError(err.errors.decision);
        }
      } else {
        setResponseError('Could not respond to invitation.');
      }
    } finally {
      setRespondingId(null);
    }
  };

  return (
    <section
      className="rounded-lg border border-cream-200 bg-white p-4 space-y-4 max-w-2xl mx-auto"
      data-testid="my-invitations-panel"
      aria-label="My invitations"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-forest-900 uppercase tracking-wide">
            My Invitations
          </h3>
          <p className="text-xs text-ink-muted mt-1">
            Inspect permitted team details for invitations addressed to you. Accept confirms your
            membership; Decline notifies the owner without changing your availability.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadList()}
          disabled={listState === 'loading'}
          className="px-3 py-1 text-xs font-medium border border-cream-300 rounded bg-cream-50 hover:bg-cream-100 disabled:opacity-50"
          data-testid="refresh-invitations-inbox"
        >
          {listState === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {successNotice ? (
        <div
          role="status"
          className="text-xs text-forest-900 bg-forest-50 border border-forest-100 rounded p-2"
          data-testid="invitation-respond-success"
        >
          {successNotice}
        </div>
      ) : null}

      {statusAlert ? (
        <div
          role="status"
          className="text-xs text-ink bg-cream-50 border border-cream-200 rounded p-2"
          data-testid="invitation-status-alert"
        >
          {statusAlert}
        </div>
      ) : null}

      {responseError ? (
        <div
          role="alert"
          className="text-xs text-red-800 space-y-1"
          data-testid="invitation-respond-error"
        >
          <p>{responseError}</p>
          {fieldError ? <p data-testid="invitation-decision-error">{fieldError}</p> : null}
          <p>Your invitation selection was kept.</p>
        </div>
      ) : null}

      <MyInvitationsView
        invitations={invitations}
        listState={listState}
        emptyMessage={emptyMessage}
        listError={listError}
        selectedId={selectedId}
        disabled={disabled}
        respondingId={respondingId}
        onRetry={() => void loadList()}
        onSelect={(id) => void handleSelect(id)}
        onAccept={(id) => void handleRespond(id, 'accept')}
        onDecline={(id) => void handleRespond(id, 'decline')}
      />
    </section>
  );
}

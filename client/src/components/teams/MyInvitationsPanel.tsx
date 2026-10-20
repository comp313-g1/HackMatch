import React, { useCallback, useEffect, useState } from 'react';
import { MyInvitationsView, type InvitationInboxListState } from './MyInvitationsView';
import { RosterStatusView } from './RosterStatusView';
import {
  AuthRequiredError,
  fetchInvitationDetail,
  fetchMyInvitations,
  respondToInvitation,
  TeamInvitationsApiError,
  type InviteeInvitationListItem,
  type InvitationRespondResult,
} from './invitationsApi';

export interface MyInvitationsPanelProps {
  disabled?: boolean;
  refreshKey?: number;
  onStatusNotice?: (notice: string) => void;
  /** Navigate to the event or team workspace after a successful accept (#185). */
  onViewRoster?: (teamOrEventId: string, teamId?: string) => void;
}

interface AcceptRosterSnapshot {
  teamName: string;
  teamId: string;
  eventId?: string;
  vacancyRole: string | null;
  vacancyStatus: string | null;
  memberCount: number | null;
  maxTeamSize: number | null;
  membershipRole: string | null;
  membershipStatus: string | null;
  joinedAt: string | null;
  availabilityCleared: boolean;
}

function acceptanceConflictMessage(
  reason: unknown,
  fallback: string
): string {
  switch (reason) {
    case 'ALREADY_ACCEPTED':
      return 'This invitation was already accepted in another request and cannot be accepted again.';
    case 'EVENT_MEMBERSHIP_CONFIRMED':
    case 'INVITEE_ALREADY_CONFIRMED':
      return 'Another invitation was accepted first, so this invitation was canceled. You are already a confirmed member of this team.';
    case 'SLOT_FILLED':
      return 'Another participant accepted first and filled this vacancy. This invitation was canceled.';
    case 'TEAM_FULL':
      return 'Another acceptance filled the team before this request completed. This invitation was canceled.';
    case 'DATABASE_CONCURRENCY_RETRY':
      return 'Another acceptance is being processed. Refresh your invitations and try again.';
    default:
      return fallback;
  }
}

/**
 * Stateful US-019 / #179 / #182 My Invitations panel: list, detail, Accept/Decline.
 * List and detail selection are preserved on response failures (NR-017).
 */
export function MyInvitationsPanel({
  disabled = false,
  refreshKey = 0,
  onStatusNotice,
  onViewRoster,
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
  const [acceptRoster, setAcceptRoster] = useState<AcceptRosterSnapshot | null>(null);

  function toAcceptRoster(result: InvitationRespondResult): AcceptRosterSnapshot {
    return {
      teamName: result.invitation.teamName,
      teamId: result.invitation.teamId,
      eventId: result.invitation.eventId,
      vacancyRole: result.vacancy?.role ?? result.invitation.vacancyRole,
      vacancyStatus: result.vacancy?.status ?? null,
      memberCount: result.memberCount ?? null,
      maxTeamSize: result.maxTeamSize ?? null,
      membershipRole: result.membership?.role ?? null,
      membershipStatus: result.membership?.status ?? null,
      joinedAt: result.membership?.joinedAt ?? null,
      availabilityCleared: Boolean(result.availabilityCleared),
    };
  }

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
    if (decision === 'decline') {
      setAcceptRoster(null);
    }
    setRespondingId(invitationId);
    try {
      const result = await respondToInvitation(invitationId, decision);
      setSuccessNotice(result.notice);
      if (decision === 'decline') {
        setStatusAlert(
          result.idempotent
            ? 'This invitation was already declined; no additional owner alert was created.'
            : 'The team owner was notified. Your availability, membership, and the vacancy are unchanged.'
        );
      } else {
        const cascade = result.cascade;
        const cascadeSummary = cascade
          ? ` Cleared ${cascade.eventInvitationsCanceled} other invitation(s), withdrew ${cascade.eventApplicationsWithdrawn} application(s), and canceled ${cascade.slotRequestsCanceled} competing slot request(s).`
          : '';
        setStatusAlert(
          (result.membershipCommitted
            ? 'Invitation accepted. Your team membership is confirmed.'
            : result.notice) + cascadeSummary
        );
        if (result.membershipCommitted) {
          setAcceptRoster(toAcceptRoster(result));
        }
      }
      onStatusNotice?.(result.notice);
      setInvitations((prev) =>
        prev.map((invitation) =>
          invitation.id === invitationId
            ? {
                ...invitation,
                ...result.invitation,
                expiredByClock: false,
                canRespond: false,
              }
            : invitation
        )
      );
      setSelectedId(invitationId);
      // Decline changes exactly one invitation, so the response is sufficient to
      // update the view without risking a refresh failure that hides valid data.
      if (decision === 'accept') {
        await loadList();
        setSelectedId(invitationId);
      }
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setResponseError('You need to sign in to respond to an invitation.');
      } else if (err instanceof TeamInvitationsApiError) {
        const isAcceptanceConflict =
          decision === 'accept' && err.code === 'INVITATION_ACCEPTANCE_CONFLICT';
        setResponseError(
          isAcceptanceConflict
            ? acceptanceConflictMessage(
                err.details?.reason,
                err.message || 'Another acceptance changed this invitation.'
              )
            : err.message || 'Could not respond to invitation.'
        );

        const fieldMessage = err.errors?.decision ?? err.errors?.invitationId;
        if (fieldMessage) {
          setFieldError(fieldMessage);
        }

        const conflictStatus =
          isAcceptanceConflict && typeof err.details?.status === 'string'
            ? err.details.status
            : null;
        if (conflictStatus) {
          const conflictReason =
            typeof err.details?.reason === 'string' ? err.details.reason : null;
          setInvitations((prev) =>
            prev.map((invitation) =>
              invitation.id === invitationId
                ? {
                    ...invitation,
                    status: conflictStatus,
                    statusLabel: conflictStatus,
                    cancelReason:
                      conflictStatus === 'Canceled'
                        ? conflictReason
                        : invitation.cancelReason,
                    expiredByClock: conflictStatus === 'Expired',
                    canRespond: false,
                    permittedDetails: invitation.permittedDetails
                      ? {
                          ...invitation.permittedDetails,
                          statusLabel: conflictStatus,
                        }
                      : invitation.permittedDetails,
                  }
                : invitation
            )
          );
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

      {acceptRoster ? (
        <div data-testid="invitation-accept-roster">
          <RosterStatusView
            snapshot={acceptRoster}
            viewState="success"
            onViewTeam={
              onViewRoster
                ? () =>
                    onViewRoster(
                      acceptRoster.eventId || acceptRoster.teamId
                    )
                : undefined
            }
          />
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

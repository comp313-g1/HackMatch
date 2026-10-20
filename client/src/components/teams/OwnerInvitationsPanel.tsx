import React, { useCallback, useEffect, useState } from 'react';
import type { TeamVacancyView } from './teamTypes';
import {
  AuthRequiredError,
  TeamInvitationsApiError,
  cancelTeamInvitation,
  fetchTeamInvitations,
  issueTeamInvitation,
  type OwnerInvitationListItem,
} from './invitationsApi';
import { OwnerInviteForm } from './OwnerInviteForm';
import {
  OutboundInvitationsView,
  type InvitationListState,
} from './OutboundInvitationsView';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OwnerInvitationsPanelProps {
  teamId: string;
  vacancies: TeamVacancyView[];
  disabled?: boolean;
  /** Bump to reload outbound list (e.g. after recommendation invite). */
  refreshKey?: number;
}

/**
 * US-017 / #167 — React invite form + outbound invitation view.
 * Loading / success / empty / validation / error states; form values kept on failure (NR-017).
 */
export function OwnerInvitationsPanel({
  teamId,
  vacancies,
  disabled = false,
  refreshKey = 0,
}: OwnerInvitationsPanelProps): React.JSX.Element {
  const openVacancies = vacancies.filter((v) => v.status === 'Open');

  const [listState, setListState] = useState<InvitationListState>('loading');
  const [invitations, setInvitations] = useState<OwnerInvitationListItem[]>([]);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [vacancyId, setVacancyId] = useState(openVacancies[0]?.id ?? '');
  const [inviteeParticipantId, setInviteeParticipantId] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    vacancyId?: string;
    inviteeParticipantId?: string;
  }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [statusAlert, setStatusAlert] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pendingVacancyIds = new Set(
    invitations
      .filter((inv) => inv.status === 'Pending' && !inv.expiredByClock && inv.vacancyId)
      .map((inv) => inv.vacancyId as string)
  );

  const loadList = useCallback(async () => {
    setListState('loading');
    setListError(null);
    try {
      const data = await fetchTeamInvitations(teamId);
      setInvitations(data.invitations);
      setEmptyMessage(data.message);
      setListState('success');
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setListError('You need to sign in to view invitations.');
      } else if (err instanceof TeamInvitationsApiError) {
        setListError(err.message || 'Could not load invitations.');
      } else {
        setListError('Could not load invitations.');
      }
      setListState('error');
    }
  }, [teamId]);

  useEffect(() => {
    void loadList();
  }, [loadList, refreshKey]);

  useEffect(() => {
    if (!vacancyId && openVacancies[0]?.id) {
      setVacancyId(openVacancies[0].id);
    }
  }, [openVacancies, vacancyId]);

  const validateForm = (): boolean => {
    const errors: { vacancyId?: string; inviteeParticipantId?: string } = {};
    if (!vacancyId || !UUID_RE.test(vacancyId)) {
      errors.vacancyId = 'Select an open slot.';
    }
    const invitee = inviteeParticipantId.trim();
    if (!invitee || !UUID_RE.test(invitee)) {
      errors.inviteeParticipantId = 'Enter a valid participant ID (UUID).';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || submitting) return;
    setSubmitError(null);
    setCancelError(null);
    setSuccessNotice(null);
    setStatusAlert(null);
    if (!validateForm()) return;

    setSubmitting(true);
    try {
      const invitation = await issueTeamInvitation(teamId, {
        vacancyId,
        inviteeParticipantId: inviteeParticipantId.trim(),
        source: 'direct',
      });
      setSuccessNotice(
        `Invitation sent for the ${invitation.vacancyRole} slot. Expires ${new Date(
          invitation.expiresAt
        ).toLocaleString()}.`
      );
      setStatusAlert(
        invitation.notice ||
          'Pending invitation created. The invitee can review status in their invitation view.'
      );
      setInviteeParticipantId('');
      setFieldErrors({});
      await loadList();
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setSubmitError('You need to sign in to send an invitation.');
      } else if (err instanceof TeamInvitationsApiError) {
        setSubmitError(err.message || 'Could not send invitation.');
        if (err.errors) {
          setFieldErrors({
            vacancyId: err.errors.vacancyId,
            inviteeParticipantId: err.errors.inviteeParticipantId,
          });
        }
      } else {
        setSubmitError('Could not send invitation.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (invitationId: string) => {
    if (disabled || cancelingId) return;
    setSubmitError(null);
    setCancelError(null);
    setSuccessNotice(null);
    setStatusAlert(null);
    setCancelingId(invitationId);
    try {
      const result = await cancelTeamInvitation(invitationId);
      const ownerAlert = result.alerts.find((a) => a.audience === 'owner');
      setSuccessNotice(result.notice);
      setStatusAlert(ownerAlert?.message ?? 'Invitation status updated to Canceled.');
      await loadList();
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setCancelError('You need to sign in to cancel an invitation.');
      } else if (err instanceof TeamInvitationsApiError) {
        setCancelError(
          err.message ||
            'Could not cancel invitation. If this persists, apply migration 0022 and restart the API.'
        );
      } else {
        setCancelError('Could not cancel invitation.');
      }
    } finally {
      setCancelingId(null);
    }
  };

  return (
    <section
      className="rounded-lg border border-cream-200 bg-white p-4 space-y-4"
      data-testid="owner-invitations-panel"
      aria-label="Team invitations"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-forest-900 uppercase tracking-wide">
          Invitations
        </h3>
        <button
          type="button"
          onClick={() => void loadList()}
          disabled={listState === 'loading'}
          className="px-3 py-1 text-xs font-medium border border-cream-300 rounded bg-cream-50 hover:bg-cream-100 disabled:opacity-50"
          data-testid="refresh-invitations"
        >
          {listState === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <OwnerInviteForm
        openVacancies={openVacancies}
        pendingVacancyIds={pendingVacancyIds}
        vacancyId={vacancyId}
        inviteeParticipantId={inviteeParticipantId}
        fieldErrors={fieldErrors}
        submitError={submitError}
        successNotice={successNotice}
        statusAlert={statusAlert}
        cancelError={cancelError}
        submitting={submitting}
        disabled={disabled}
        onVacancyChange={setVacancyId}
        onInviteeChange={setInviteeParticipantId}
        onSubmit={(e) => void handleSubmit(e)}
      />

      <OutboundInvitationsView
        invitations={invitations}
        listState={listState}
        emptyMessage={emptyMessage}
        listError={listError}
        disabled={disabled}
        cancelingId={cancelingId}
        onRetry={() => void loadList()}
        onCancel={(id) => void handleCancel(id)}
      />
    </section>
  );
}

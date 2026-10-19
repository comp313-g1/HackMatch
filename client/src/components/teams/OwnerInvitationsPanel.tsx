import React, { useCallback, useEffect, useState } from 'react';
import type { TeamVacancyView } from './teamTypes';
import {
  AuthRequiredError,
  TeamInvitationsApiError,
  fetchTeamInvitations,
  issueTeamInvitation,
  type OwnerInvitationListItem,
} from './invitationsApi';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OwnerInvitationsPanelProps {
  teamId: string;
  vacancies: TeamVacancyView[];
  disabled?: boolean;
}

type ListState = 'loading' | 'success' | 'error';

/**
 * Owner-only US-017 invitation issuance + outbound list (#162).
 * Loading / success / empty / validation / error states; form values kept on failure.
 */
export function OwnerInvitationsPanel({
  teamId,
  vacancies,
  disabled = false,
}: OwnerInvitationsPanelProps): React.JSX.Element {
  const openVacancies = vacancies.filter((v) => v.status === 'Open');

  const [listState, setListState] = useState<ListState>('loading');
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
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const pendingVacancyIds = new Set(
    invitations
      .filter((inv) => inv.status === 'Pending' && !inv.expiredByClock && inv.vacancyId)
      .map((inv) => inv.vacancyId as string)
  );
  const [submitting, setSubmitting] = useState(false);

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
  }, [loadList]);

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
    setSuccessNotice(null);
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

  const displayStatus = (inv: OwnerInvitationListItem): string => {
    if (inv.status === 'Expired' || (inv.expiredByClock && inv.status === 'Pending')) {
      return 'Expired';
    }
    return inv.status;
  };

  const expiryLabel = (inv: OwnerInvitationListItem): string => {
    if (!inv.expiresAt) return 'No expiry on record';
    if (inv.status === 'Expired' || inv.expiredByClock) {
      return 'Expired after 48 hours — acceptance is rejected';
    }
    return `Expires ${new Date(inv.expiresAt).toLocaleString()} (48h window)`;
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

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="space-y-3 rounded-md border border-cream-200 bg-cream-50/40 p-3"
        data-testid="owner-invite-form"
      >
        <p className="text-xs text-ink-muted">
          Send a Pending invitation to an open slot. Only one Pending invite is allowed per slot and
          per invitee on this team. It expires in 48 hours and does not reserve the slot against
          applications.
        </p>

        <div>
          <label htmlFor="invite-vacancy" className="block text-xs font-medium text-ink mb-1">
            Open slot
          </label>
          <select
            id="invite-vacancy"
            value={vacancyId}
            onChange={(e) => setVacancyId(e.target.value)}
            disabled={disabled || submitting || openVacancies.length === 0}
            className="w-full px-2 py-1.5 text-sm border border-cream-300 rounded bg-white disabled:bg-cream-100"
            data-testid="invite-vacancy-select"
          >
            {openVacancies.length === 0 ? (
              <option value="">No open slots</option>
            ) : (
              openVacancies.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.role}
                  {v.skills.length ? ` (${v.skills.slice(0, 3).join(', ')})` : ''}
                  {pendingVacancyIds.has(v.id) ? ' — pending invite' : ''}
                </option>
              ))
            )}
          </select>
          {fieldErrors.vacancyId ? (
            <p className="mt-1 text-xs text-red-700" role="alert">
              {fieldErrors.vacancyId}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="invite-participant" className="block text-xs font-medium text-ink mb-1">
            Invitee participant ID
          </label>
          <input
            id="invite-participant"
            type="text"
            value={inviteeParticipantId}
            onChange={(e) => setInviteeParticipantId(e.target.value)}
            disabled={disabled || submitting}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="w-full px-2 py-1.5 text-sm border border-cream-300 rounded bg-white disabled:bg-cream-100"
            data-testid="invite-participant-input"
            autoComplete="off"
          />
          {fieldErrors.inviteeParticipantId ? (
            <p className="mt-1 text-xs text-red-700" role="alert">
              {fieldErrors.inviteeParticipantId}
            </p>
          ) : null}
        </div>

        {submitError ? (
          <div role="alert" className="text-xs text-red-800 space-y-1" data-testid="invite-form-error">
            <p>{submitError}</p>
            <p>Your entered slot and invitee ID were kept.</p>
          </div>
        ) : null}

        {successNotice ? (
          <div
            role="status"
            className="text-xs text-forest-900 bg-forest-50 border border-forest-100 rounded p-2"
            data-testid="invite-form-success"
          >
            {successNotice}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={disabled || submitting || openVacancies.length === 0}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-forest rounded hover:bg-forest-800 disabled:opacity-50"
          data-testid="send-invitation"
        >
          {submitting ? 'Sending…' : 'Send invitation'}
        </button>
      </form>

      {listState === 'loading' && invitations.length === 0 ? (
        <p role="status" className="text-xs text-forest-800" data-testid="invitations-loading">
          Loading invitations…
        </p>
      ) : null}

      {listState === 'error' ? (
        <div role="alert" className="text-xs text-red-800 space-y-2" data-testid="invitations-list-error">
          <p>{listError}</p>
          <p>Your team details were kept.</p>
          <button
            type="button"
            onClick={() => void loadList()}
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
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

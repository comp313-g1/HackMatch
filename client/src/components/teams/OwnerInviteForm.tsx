import React from 'react';
import type { TeamVacancyView } from './teamTypes';

export interface OwnerInviteFormProps {
  openVacancies: TeamVacancyView[];
  pendingVacancyIds: Set<string>;
  vacancyId: string;
  inviteeParticipantId: string;
  fieldErrors: {
    vacancyId?: string;
    inviteeParticipantId?: string;
  };
  submitError: string | null;
  successNotice: string | null;
  statusAlert: string | null;
  cancelError: string | null;
  submitting: boolean;
  disabled: boolean;
  onVacancyChange: (vacancyId: string) => void;
  onInviteeChange: (inviteeParticipantId: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

/**
 * Owner direct-invite form (US-017 / #167 / FR-049).
 * Validation and API failures keep entered slot + invitee values (NR-017).
 */
export function OwnerInviteForm({
  openVacancies,
  pendingVacancyIds,
  vacancyId,
  inviteeParticipantId,
  fieldErrors,
  submitError,
  successNotice,
  statusAlert,
  cancelError,
  submitting,
  disabled,
  onVacancyChange,
  onInviteeChange,
  onSubmit,
}: OwnerInviteFormProps): React.JSX.Element {
  const noOpenSlots = openVacancies.length === 0;

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-md border border-cream-200 bg-cream-50/40 p-3"
      data-testid="owner-invite-form"
    >
      <p className="text-xs text-ink-muted">
        Send a Pending invitation to an open slot. Only one Pending invite is allowed per slot and
        per invitee on this team. It expires in 48 hours and does not reserve the slot against
        applications. You can also invite from the recommendation list on an open vacancy.
      </p>

      {disabled ? (
        <p
          role="status"
          className="text-xs text-amber-900 bg-amber-50 border border-amber-100 rounded p-2"
          data-testid="invite-form-locked"
        >
          This team is locked. Invitations cannot be sent or canceled until recruitment is mutable
          again.
        </p>
      ) : null}

      {noOpenSlots ? (
        <p
          role="status"
          className="text-xs text-ink-muted border border-dashed border-cream-300 rounded p-2"
          data-testid="invite-form-no-slots"
        >
          No open slots available. Add or reopen a vacancy before sending an invitation.
        </p>
      ) : null}

      <div>
        <label htmlFor="invite-vacancy" className="block text-xs font-medium text-ink mb-1">
          Open slot
        </label>
        <select
          id="invite-vacancy"
          value={vacancyId}
          onChange={(e) => onVacancyChange(e.target.value)}
          disabled={disabled || submitting || noOpenSlots}
          className="w-full px-2 py-1.5 text-sm border border-cream-300 rounded bg-white disabled:bg-cream-100"
          data-testid="invite-vacancy-select"
        >
          {noOpenSlots ? (
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
          onChange={(e) => onInviteeChange(e.target.value)}
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

      {statusAlert ? (
        <div
          role="status"
          className="text-xs text-forest-900 bg-cream-50 border border-cream-200 rounded p-2"
          data-testid="invitation-status-alert"
        >
          {statusAlert}
        </div>
      ) : null}

      {cancelError ? (
        <div
          role="alert"
          className="text-xs text-red-800 space-y-1"
          data-testid="cancel-invitation-error"
        >
          <p>{cancelError}</p>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={disabled || submitting || noOpenSlots}
        className="px-3 py-1.5 text-xs font-semibold text-white bg-forest rounded hover:bg-forest-800 disabled:opacity-50"
        data-testid="send-invitation"
      >
        {submitting ? 'Sending…' : 'Send invitation'}
      </button>
    </form>
  );
}

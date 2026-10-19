import React, { useState } from 'react';
import {
  AuthRequiredError,
  InvitationsApiError,
  issueTeamInvitation,
  type IssuedInvitation,
} from './invitationsApi';

export interface InviteDraftCandidate {
  participantId: string;
  displayName: string;
  handle: string | null;
}

export interface InviteFromRecommendationFormProps {
  teamId: string;
  vacancyId: string;
  vacancyLabel: string;
  candidate: InviteDraftCandidate;
  onCancel: () => void;
  onSuccess: (invitation: IssuedInvitation) => void;
}

/**
 * Prefills US-017 invitation for the selected open slot + recommended candidate (FR-048).
 * Keeps the draft visible on validation / eligibility failures.
 */
export function InviteFromRecommendationForm({
  teamId,
  vacancyId,
  vacancyLabel,
  candidate,
  onCancel,
  onSuccess,
}: InviteFromRecommendationFormProps): React.JSX.Element {
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  const label = candidate.handle?.trim() || candidate.displayName;

  const submit = async () => {
    setSubmitting(true);
    setErrorMessage(null);
    setFieldErrors({});
    try {
      const invitation = await issueTeamInvitation(teamId, {
        vacancyId,
        inviteeParticipantId: candidate.participantId,
        source: 'recommendation',
      });
      onSuccess(invitation);
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setErrorMessage('You need to sign in to send an invitation.');
      } else if (err instanceof InvitationsApiError) {
        setErrorMessage(err.message || 'Could not send invitation.');
        if (err.errors) setFieldErrors(err.errors);
      } else {
        setErrorMessage('Could not send invitation.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="rounded-md border border-forest-200 bg-white p-3 space-y-3"
      data-testid="invite-from-recommendation"
      role="region"
      aria-label="Send invitation"
    >
      <h5 className="text-xs font-semibold text-forest-900 uppercase tracking-wide">
        Invite to open slot
      </h5>
      <dl className="text-xs text-ink space-y-1.5">
        <div className="flex gap-2">
          <dt className="font-medium text-ink-muted shrink-0">Candidate</dt>
          <dd data-testid="invite-draft-candidate">{label}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium text-ink-muted shrink-0">Open slot</dt>
          <dd data-testid="invite-draft-slot">{vacancyLabel}</dd>
        </div>
      </dl>
      <p className="text-xs text-ink-muted">
        Sends a Pending invitation that expires in 48 hours. It does not reserve the slot against
        applications.
      </p>

      {errorMessage ? (
        <div role="alert" className="text-xs text-red-800 space-y-1" data-testid="invite-error">
          <p>{errorMessage}</p>
          <p>Your recommendation list and invitation draft were kept.</p>
          {fieldErrors.vacancyId ? <p>{fieldErrors.vacancyId}</p> : null}
          {fieldErrors.inviteeParticipantId ? <p>{fieldErrors.inviteeParticipantId}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-forest rounded hover:bg-forest-800 disabled:opacity-50"
          data-testid="confirm-invitation"
        >
          {submitting ? 'Sending…' : 'Send invitation'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="px-3 py-1.5 text-xs font-medium border border-cream-300 rounded bg-cream-50 hover:bg-cream-100 disabled:opacity-50"
          data-testid="cancel-invitation"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

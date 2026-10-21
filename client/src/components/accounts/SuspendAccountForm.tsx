import React, { useEffect, useState } from 'react';
import type { AccountState, AccountsFieldErrors } from './accountTypes';

const REASON_MAX = 2000;

export interface SuspendAccountFormProps {
  accountId: string | null;
  accountState: AccountState | null;
  submitting?: boolean;
  fieldErrors?: AccountsFieldErrors;
  formError?: string | null;
  successNotice?: string | null;
  onSubmit: (input: { reason: string }) => void | Promise<void>;
}

/**
 * ADMIN suspension reason form (US-027 / #255 / FR-077).
 * Reason is mandatory; drafts are kept on validation errors (NR-017).
 */
export function SuspendAccountForm({
  accountId,
  accountState,
  submitting = false,
  fieldErrors = {},
  formError = null,
  successNotice = null,
  onSubmit,
}: SuspendAccountFormProps): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [localErrors, setLocalErrors] = useState<AccountsFieldErrors>({});

  const errors = { ...localErrors, ...fieldErrors };
  const reasonLen = [...reason].length;
  const deactivated = accountState === 'Deactivated';
  const disabled = !accountId || deactivated || submitting;

  useEffect(() => {
    if (successNotice) {
      setReason('');
      setLocalErrors({});
    }
  }, [successNotice]);

  useEffect(() => {
    setReason('');
    setLocalErrors({});
  }, [accountId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    const next: AccountsFieldErrors = {};
    const trimmed = reason.trim();
    if (!trimmed) {
      next.reason = 'A reason is required for every suspension.';
    } else if ([...reason].length > REASON_MAX) {
      next.reason = `reason must be at most ${REASON_MAX} characters.`;
    }
    setLocalErrors(next);
    if (Object.keys(next).length > 0) return;
    await onSubmit({ reason: trimmed });
  };

  if (!accountId) {
    return (
      <div
        role="status"
        className="p-4 text-sm text-ink-muted border border-dashed border-cream-300 rounded-md"
        data-testid="suspend-account-idle"
      >
        Select an account to suspend. Suspension cancels pending requests, hides the profile, and
        pauses owned Open recruitment.
      </div>
    );
  }

  if (deactivated) {
    return (
      <div
        role="status"
        className="p-4 text-sm text-ink-muted border border-cream-200 rounded-md bg-cream-50"
        data-testid="suspend-account-deactivated"
      >
        Deactivated accounts cannot be suspended from this panel.
      </div>
    );
  }

  const inputClass =
    'mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-forest';

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-md border border-cream-200 bg-white p-4"
      data-testid="suspend-account-form"
      noValidate
    >
      <div>
        <h4 className="text-sm font-semibold text-forest-900">Suspend account</h4>
        <p className="mt-1 text-xs text-ink-muted">
          Revokes sessions, blocks sign-in, cancels pending invitations/applications, hides the
          profile and Looking-for-Team status, and pauses recruitment on owned unlocked Open teams.
          Confirmed memberships stay intact.
        </p>
      </div>

      {accountState === 'Suspended' ? (
        <p
          role="status"
          className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md p-2"
          data-testid="suspend-already-notice"
        >
          This account is already suspended. Re-submitting re-applies session revocation and the
          recruitment cascade.
        </p>
      ) : null}

      <div>
        <label htmlFor="suspend-reason" className="block text-xs font-medium text-forest-900">
          Reason <span className="text-red-700">*</span>
        </label>
        <textarea
          id="suspend-reason"
          data-testid="suspend-reason"
          rows={3}
          value={reason}
          disabled={disabled}
          onChange={(e) => setReason(e.target.value)}
          maxLength={REASON_MAX}
          aria-invalid={Boolean(errors.reason)}
          aria-describedby={
            errors.reason ? 'suspend-reason-error' : 'suspend-reason-count'
          }
          className={`${inputClass} ${errors.reason ? 'border-red-400' : 'border-cream-300'}`}
        />
        <p
          id="suspend-reason-count"
          className="mt-1 text-xs text-ink-muted"
          data-testid="suspend-reason-count"
        >
          {reasonLen}/{REASON_MAX}
        </p>
        {errors.reason ? (
          <p id="suspend-reason-error" role="alert" className="mt-1 text-xs text-red-700">
            {errors.reason}
          </p>
        ) : null}
      </div>

      {formError ? (
        <div
          role="alert"
          className="p-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md"
          data-testid="suspend-form-error"
        >
          {formError}
        </div>
      ) : null}

      {successNotice ? (
        <div
          role="status"
          className="p-2 text-sm text-forest-900 bg-emerald-50 border border-emerald-200 rounded-md"
          data-testid="suspend-success"
        >
          {successNotice}
        </div>
      ) : null}

      <button
        type="submit"
        data-testid="suspend-submit"
        disabled={disabled}
        className="px-3 py-1.5 text-xs font-semibold rounded bg-forest text-white hover:bg-forest-800 disabled:opacity-50"
      >
        {submitting ? 'Suspending…' : 'Suspend account'}
      </button>
    </form>
  );
}

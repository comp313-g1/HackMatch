import React, { useEffect, useState } from 'react';
import type { AccountState, AccountsFieldErrors } from './accountTypes';

const REASON_MAX = 2000;

export interface DeleteAccountFormProps {
  accountId: string | null;
  accountState: AccountState | null;
  submitting?: boolean;
  fieldErrors?: AccountsFieldErrors;
  formError?: string | null;
  successNotice?: string | null;
  onSubmit: (input: { reason: string; ownershipVerified: true }) => void | Promise<void>;
}

/**
 * ADMIN ownership-verified deletion form (US-027 / #252 / FR-078).
 * Requires reason + ownership confirmation; drafts kept on validation errors (NR-017).
 */
export function DeleteAccountForm({
  accountId,
  accountState,
  submitting = false,
  fieldErrors = {},
  formError = null,
  successNotice = null,
  onSubmit,
}: DeleteAccountFormProps): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [ownershipVerified, setOwnershipVerified] = useState(false);
  const [localErrors, setLocalErrors] = useState<AccountsFieldErrors>({});

  const errors = { ...localErrors, ...fieldErrors };
  const alreadyGone = accountState === 'Deactivated';
  const disabled = !accountId || alreadyGone || submitting;

  useEffect(() => {
    if (successNotice) {
      setReason('');
      setOwnershipVerified(false);
      setLocalErrors({});
    }
  }, [successNotice]);

  useEffect(() => {
    setReason('');
    setOwnershipVerified(false);
    setLocalErrors({});
  }, [accountId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    const next: AccountsFieldErrors = {};
    const trimmed = reason.trim();
    if (!trimmed) {
      next.reason = 'A reason is required for every deletion request.';
    } else if ([...reason].length > REASON_MAX) {
      next.reason = `reason must be at most ${REASON_MAX} characters.`;
    }
    if (!ownershipVerified) {
      next.ownershipVerified =
        'Confirm that account ownership was verified before submitting deletion.';
    }
    setLocalErrors(next);
    if (Object.keys(next).length > 0) return;
    await onSubmit({ reason: trimmed, ownershipVerified: true });
  };

  if (!accountId) {
    return (
      <div
        role="status"
        className="p-4 text-sm text-ink-muted border border-dashed border-cream-300 rounded-md"
        data-testid="delete-account-idle"
      >
        Select an account to submit an ownership-verified deletion request (30-day live-PII target).
      </div>
    );
  }

  if (alreadyGone) {
    return (
      <div
        role="status"
        className="p-4 text-sm text-ink-muted border border-cream-200 rounded-md bg-cream-50"
        data-testid="delete-account-deactivated"
      >
        This account is already deactivated. Live identifying fields should already be erased.
      </div>
    );
  }

  const inputClass =
    'mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-forest';

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-md border border-cream-200 bg-white p-4"
      data-testid="delete-account-form"
      noValidate
    >
      <div>
        <h4 className="text-sm font-semibold text-forest-900">Ownership-verified deletion</h4>
        <p className="mt-1 text-xs text-ink-muted">
          Records a verified deletion request with a proposed 30-day live-PII processing target
          (R-06 / NR-023 — not a legal-compliance claim). Unlocked team owners must disband first.
          Locked roster memberships stay intact for later pseudonymization.
        </p>
      </div>

      <div>
        <label htmlFor="delete-reason" className="block text-xs font-medium text-forest-900">
          Reason <span className="text-red-700">*</span>
        </label>
        <textarea
          id="delete-reason"
          data-testid="delete-reason"
          rows={3}
          value={reason}
          disabled={disabled}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={Boolean(errors.reason)}
          aria-describedby={errors.reason ? 'delete-reason-error' : undefined}
          className={`${inputClass} ${errors.reason ? 'border-red-400' : 'border-cream-300'}`}
        />
        {errors.reason ? (
          <p id="delete-reason-error" role="alert" className="mt-1 text-xs text-red-700">
            {errors.reason}
          </p>
        ) : null}
      </div>

      <div className="flex items-start gap-2">
        <input
          id="delete-ownership-verified"
          data-testid="delete-ownership-verified"
          type="checkbox"
          checked={ownershipVerified}
          disabled={disabled}
          onChange={(e) => setOwnershipVerified(e.target.checked)}
          aria-invalid={Boolean(errors.ownershipVerified)}
          className="mt-0.5"
        />
        <label htmlFor="delete-ownership-verified" className="text-xs text-forest-900">
          I verified that the requester owns this account (ownershipVerified).
        </label>
      </div>
      {errors.ownershipVerified ? (
        <p role="alert" className="text-xs text-red-700" data-testid="delete-ownership-error">
          {errors.ownershipVerified}
        </p>
      ) : null}

      {formError ? (
        <div
          role="alert"
          className="p-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md"
          data-testid="delete-form-error"
        >
          {formError}
        </div>
      ) : null}

      {successNotice ? (
        <div
          role="status"
          className="p-2 text-sm text-forest-900 bg-emerald-50 border border-emerald-200 rounded-md"
          data-testid="delete-success"
        >
          {successNotice}
        </div>
      ) : null}

      <button
        type="submit"
        data-testid="delete-submit"
        disabled={disabled}
        className="px-3 py-1.5 text-xs font-semibold rounded bg-red-800 text-white hover:bg-red-900 disabled:opacity-50"
      >
        {submitting ? 'Processing deletion…' : 'Submit deletion request'}
      </button>
    </form>
  );
}

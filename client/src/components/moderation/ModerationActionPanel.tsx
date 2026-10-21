import React, { useState } from 'react';
import type {
  ModerationCaseStatus,
  ModerationDecisionAction,
  ModerationFieldErrors,
} from './moderationTypes';

const ACTIONS: Array<{ value: ModerationDecisionAction; label: string; help: string }> = [
  { value: 'dismiss', label: 'Dismiss', help: 'Close the case with no content change.' },
  { value: 'redact', label: 'Redact text', help: 'Replace offensive listing/profile text.' },
  { value: 'warn', label: 'Warn', help: 'Record a warning and notify the owner.' },
  { value: 'hide', label: 'Hide listing', help: 'Remove from ordinary discovery; keep memberships.' },
  {
    value: 'disable_url',
    label: 'Disable URL',
    help: 'Remove a malicious communication link immediately.',
  },
];

export interface ModerationActionPanelProps {
  caseId: string | null;
  caseStatus: ModerationCaseStatus | null;
  submitting?: boolean;
  fieldErrors?: ModerationFieldErrors;
  formError?: string | null;
  successNotice?: string | null;
  onSubmit: (input: { action: ModerationDecisionAction; reason: string }) => void | Promise<void>;
}

/**
 * ADMIN enforcement actions for an open case (US-026 / #242 / FR-075–076).
 * Reason is mandatory; drafts are kept on validation errors (NR-017).
 */
export function ModerationActionPanel({
  caseId,
  caseStatus,
  submitting = false,
  fieldErrors = {},
  formError = null,
  successNotice = null,
  onSubmit,
}: ModerationActionPanelProps): React.JSX.Element {
  const [action, setAction] = useState<ModerationDecisionAction>('dismiss');
  const [reason, setReason] = useState('');
  const [localErrors, setLocalErrors] = useState<ModerationFieldErrors>({});

  const errors = { ...localErrors, ...fieldErrors };
  const closed = caseStatus != null && caseStatus !== 'Open';
  const disabled = !caseId || closed || submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    const next: ModerationFieldErrors = {};
    if (!ACTIONS.some((a) => a.value === action)) {
      next.action = 'Choose a moderation action.';
    }
    const trimmed = reason.trim();
    if (!trimmed) {
      next.reason = 'A reason is required for every moderation decision.';
    }
    setLocalErrors(next);
    if (Object.keys(next).length > 0) return;
    await onSubmit({ action, reason: trimmed });
  };

  if (!caseId) {
    return (
      <div
        role="status"
        className="p-4 text-sm text-ink-muted border border-dashed border-cream-300 rounded-md"
        data-testid="moderation-action-idle"
      >
        Select an open case to apply dismiss, redact, warn, hide, or URL-disable.
      </div>
    );
  }

  const selectedHelp = ACTIONS.find((a) => a.value === action)?.help;

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-md border border-cream-200 bg-white p-4"
      data-testid="moderation-action-panel"
      noValidate
    >
      <h3 className="font-display text-base font-semibold text-forest-900">Enforcement actions</h3>
      <p className="text-xs text-ink-muted">
        Every decision needs a reason and creates a basic action record.
      </p>

      {closed ? (
        <div
          role="status"
          className="p-2 text-xs text-ink bg-cream-50 border border-cream-200 rounded"
          data-testid="moderation-action-closed"
        >
          This case is {caseStatus}. Further decisions are not available.
        </div>
      ) : null}

      {successNotice ? (
        <div
          role="status"
          className="p-2 text-xs text-forest-900 bg-forest-50 border border-forest-100 rounded"
          data-testid="moderation-action-success"
        >
          {successNotice}
        </div>
      ) : null}

      {formError ? (
        <div
          role="alert"
          className="p-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded"
          data-testid="moderation-action-form-error"
        >
          {formError}
        </div>
      ) : null}

      <fieldset disabled={disabled} className="space-y-3">
        <legend className="sr-only">Choose action</legend>
        <div className="space-y-2" data-testid="moderation-action-options">
          {ACTIONS.map((item) => {
            const inputId = `moderation-action-${item.value}`;
            return (
              <div key={item.value} className="flex items-start gap-2 text-sm text-ink">
                <input
                  id={inputId}
                  type="radio"
                  name="moderation-action"
                  value={item.value}
                  checked={action === item.value}
                  onChange={() => {
                    setAction(item.value);
                    setLocalErrors((prev) => ({ ...prev, action: undefined }));
                  }}
                  className="mt-1"
                  data-testid={inputId}
                />
                <label htmlFor={inputId} className="cursor-pointer">
                  <span className="font-medium text-forest-900">{item.label}</span>
                  <span className="block text-xs text-ink-muted">{item.help}</span>
                </label>
              </div>
            );
          })}
        </div>
        {errors.action ? (
          <p role="alert" className="text-xs text-red-600">
            {errors.action}
          </p>
        ) : null}
        {selectedHelp ? (
          <p className="text-xs text-ink-muted" data-testid="moderation-action-help">
            {selectedHelp}
          </p>
        ) : null}

        <div>
          <label htmlFor="moderation-decision-reason" className="block text-xs font-medium text-ink">
            Decision reason
          </label>
          <textarea
            id="moderation-decision-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (errors.reason) setLocalErrors((prev) => ({ ...prev, reason: undefined }));
            }}
            rows={3}
            aria-invalid={Boolean(errors.reason)}
            className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-forest ${
              errors.reason ? 'border-red-400 bg-red-50/30' : 'border-cream-300'
            }`}
            data-testid="moderation-decision-reason"
          />
          {errors.reason ? (
            <p role="alert" className="mt-1 text-xs text-red-600" data-testid="moderation-decision-reason-error">
              {errors.reason}
            </p>
          ) : null}
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={disabled}
        aria-busy={submitting}
        className="w-full py-2 px-4 rounded-md text-sm font-semibold text-white bg-forest hover:bg-forest-800 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2"
        data-testid="moderation-action-submit"
      >
        {submitting ? 'Applying…' : 'Apply decision'}
      </button>
    </form>
  );
}

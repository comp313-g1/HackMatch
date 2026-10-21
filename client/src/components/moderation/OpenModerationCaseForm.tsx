import React, { useState } from 'react';
import type { CreateModerationCaseInput, ModerationFieldErrors, ModerationTargetType } from './moderationTypes';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REASON_MAX = 2000;

export interface OpenModerationCaseFormProps {
  submitting?: boolean;
  fieldErrors?: ModerationFieldErrors;
  formError?: string | null;
  successNotice?: string | null;
  onSubmit: (input: CreateModerationCaseInput) => void | Promise<void>;
}

/**
 * ADMIN form to open a moderation case (US-026 AC 1).
 * Keeps entered values on validation errors (NR-017).
 */
export function OpenModerationCaseForm({
  submitting = false,
  fieldErrors = {},
  formError = null,
  successNotice = null,
  onSubmit,
}: OpenModerationCaseFormProps): React.JSX.Element {
  const [targetType, setTargetType] = useState<ModerationTargetType>('team');
  const [targetId, setTargetId] = useState('');
  const [reason, setReason] = useState('');
  const [flaggedUrl, setFlaggedUrl] = useState('');
  const [localErrors, setLocalErrors] = useState<ModerationFieldErrors>({});

  const errors = { ...localErrors, ...fieldErrors };

  const validate = (): CreateModerationCaseInput | null => {
    const next: ModerationFieldErrors = {};
    if (!['team', 'profile', 'url'].includes(targetType)) {
      next.targetType = 'Choose team, profile, or url.';
    }
    const id = targetId.trim();
    if (!UUID_RE.test(id)) {
      next.targetId = 'Enter a valid target UUID.';
    }
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      next.reason = 'A reason is required.';
    } else if ([...reason].length > REASON_MAX) {
      next.reason = `Reason must be at most ${REASON_MAX} characters.`;
    }
    let url: string | null = null;
    if (targetType === 'url') {
      const u = flaggedUrl.trim();
      if (!u.startsWith('https://') || u.length <= 8) {
        next.flaggedUrl = 'flaggedUrl must be an https URL.';
      } else {
        url = u;
      }
    }
    setLocalErrors(next);
    if (Object.keys(next).length > 0) return null;
    return {
      targetType,
      targetId: id,
      reason: trimmedReason,
      flaggedUrl: url,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const payload = validate();
    if (!payload) return;
    await onSubmit(payload);
  };

  const inputClass =
    'mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-forest';

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-md border border-cream-200 bg-white p-4"
      data-testid="open-moderation-case-form"
      noValidate
    >
      <h3 className="font-display text-base font-semibold text-forest-900">Open a moderation case</h3>
      <p className="text-xs text-ink-muted">
        Record a target, reason, and time. Cases appear newest first in the queue.
      </p>

      {successNotice ? (
        <div
          role="status"
          className="p-2 text-xs text-forest-900 bg-forest-50 border border-forest-100 rounded"
          data-testid="open-case-success"
        >
          {successNotice}
        </div>
      ) : null}

      {formError ? (
        <div
          role="alert"
          className="p-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded"
          data-testid="open-case-form-error"
        >
          {formError}
        </div>
      ) : null}

      <div>
        <label htmlFor="moderation-target-type" className="block text-xs font-medium text-ink">
          Target type
        </label>
        <select
          id="moderation-target-type"
          value={targetType}
          onChange={(e) => {
            setTargetType(e.target.value as ModerationTargetType);
            setLocalErrors((prev) => ({ ...prev, targetType: undefined, flaggedUrl: undefined }));
          }}
          aria-invalid={Boolean(errors.targetType)}
          className={`${inputClass} ${errors.targetType ? 'border-red-400 bg-red-50/30' : 'border-cream-300'}`}
          data-testid="moderation-target-type"
        >
          <option value="team">Team listing</option>
          <option value="profile">Participant profile</option>
          <option value="url">Suspicious URL</option>
        </select>
        {errors.targetType ? (
          <p id="moderation-target-type-error" role="alert" className="mt-1 text-xs text-red-600">
            {errors.targetType}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="moderation-target-id" className="block text-xs font-medium text-ink">
          Target ID
        </label>
        <input
          id="moderation-target-id"
          type="text"
          value={targetId}
          onChange={(e) => {
            setTargetId(e.target.value);
            if (errors.targetId) setLocalErrors((prev) => ({ ...prev, targetId: undefined }));
          }}
          aria-invalid={Boolean(errors.targetId)}
          aria-describedby={errors.targetId ? 'moderation-target-id-error' : undefined}
          className={`${inputClass} ${errors.targetId ? 'border-red-400 bg-red-50/30' : 'border-cream-300'}`}
          placeholder="UUID of team or participant"
          data-testid="moderation-target-id"
        />
        {errors.targetId ? (
          <p id="moderation-target-id-error" role="alert" className="mt-1 text-xs text-red-600">
            {errors.targetId}
          </p>
        ) : null}
      </div>

      {targetType === 'url' ? (
        <div>
          <label htmlFor="moderation-flagged-url" className="block text-xs font-medium text-ink">
            Flagged URL
          </label>
          <input
            id="moderation-flagged-url"
            type="url"
            value={flaggedUrl}
            onChange={(e) => {
              setFlaggedUrl(e.target.value);
              if (errors.flaggedUrl) setLocalErrors((prev) => ({ ...prev, flaggedUrl: undefined }));
            }}
            aria-invalid={Boolean(errors.flaggedUrl)}
            className={`${inputClass} ${errors.flaggedUrl ? 'border-red-400 bg-red-50/30' : 'border-cream-300'}`}
            placeholder="https://…"
            data-testid="moderation-flagged-url"
          />
          {errors.flaggedUrl ? (
            <p role="alert" className="mt-1 text-xs text-red-600">
              {errors.flaggedUrl}
            </p>
          ) : null}
        </div>
      ) : null}

      <div>
        <label htmlFor="moderation-reason" className="block text-xs font-medium text-ink">
          Reason
        </label>
        <textarea
          id="moderation-reason"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (errors.reason) setLocalErrors((prev) => ({ ...prev, reason: undefined }));
          }}
          rows={3}
          aria-invalid={Boolean(errors.reason)}
          aria-describedby={errors.reason ? 'moderation-reason-error' : undefined}
          className={`${inputClass} ${errors.reason ? 'border-red-400 bg-red-50/30' : 'border-cream-300'}`}
          data-testid="moderation-reason"
        />
        {errors.reason ? (
          <p id="moderation-reason-error" role="alert" className="mt-1 text-xs text-red-600">
            {errors.reason}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting}
        className="w-full py-2 px-4 rounded-md text-sm font-semibold text-white bg-forest hover:bg-forest-800 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2"
        data-testid="open-case-submit"
      >
        {submitting ? 'Opening case…' : 'Open case'}
      </button>
    </form>
  );
}

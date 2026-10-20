import React from 'react';
import {
  APPLICATION_MESSAGE_MAX_LENGTH,
  MAX_PENDING_APPLICATIONS_PER_EVENT,
  normalizeApplicationMessage,
} from './applicationsApi';
import type { OpenTeamApplyTarget } from './openTeamsApi';

export interface ApplicationFormProps {
  target: OpenTeamApplyTarget | null;
  message: string;
  fieldErrors: { message?: string; vacancyId?: string };
  submitError: string | null;
  successNotice: string | null;
  submitting: boolean;
  disabled?: boolean;
  onMessageChange: (message: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

/**
 * US-018 / #171 React apply-to-slot form with optional 250-character message (FR-053).
 * Validation and API failures keep the entered message (NR-017).
 */
export function ApplicationForm({
  target,
  message,
  fieldErrors,
  submitError,
  successNotice,
  submitting,
  disabled = false,
  onMessageChange,
  onSubmit,
  onCancel,
}: ApplicationFormProps): React.JSX.Element {
  const trimmedLen = normalizeApplicationMessage(message)?.length ?? 0;
  const overLimit = trimmedLen > APPLICATION_MESSAGE_MAX_LENGTH;

  if (!target || !target.vacancyId || !target.teamId) {
    return (
      <div
        role="status"
        className="rounded-md border border-dashed border-cream-300 bg-cream-50/40 p-4 text-center text-xs text-ink-muted"
        data-testid="application-form-empty"
      >
        Select an open vacancy and click Apply to submit an application.
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border border-cream-200 bg-white p-4 shadow-sm"
      data-testid="application-form"
      aria-label="Apply to team vacancy"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-forest-900 uppercase tracking-wide">
          Apply to join
        </h3>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="px-2 py-1 text-xs font-medium border border-cream-300 rounded bg-cream-50 hover:bg-cream-100 disabled:opacity-50"
          data-testid="application-form-cancel"
        >
          Close
        </button>
      </div>

      <p className="text-xs text-ink-muted" data-testid="application-form-quota-hint">
        Submit a Pending Review application for an open slot. An optional message of at most{' '}
        {APPLICATION_MESSAGE_MAX_LENGTH} characters may be included. You may hold at most{' '}
        {MAX_PENDING_APPLICATIONS_PER_EVENT} pending applications per event; other events have
        separate limits.
      </p>

      <dl className="text-xs text-ink space-y-1.5 rounded-md border border-cream-200 bg-cream-50/40 p-3">
        <div className="flex gap-2">
          <dt className="font-medium text-ink-muted shrink-0">Team</dt>
          <dd data-testid="application-form-team">{target.teamName}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium text-ink-muted shrink-0">Open slot</dt>
          <dd data-testid="application-form-slot">{target.role}</dd>
        </div>
      </dl>

      {fieldErrors.vacancyId ? (
        <p className="text-xs text-red-700" role="alert" data-testid="application-vacancy-error">
          {fieldErrors.vacancyId}
        </p>
      ) : null}

      <div>
        <label htmlFor="application-message" className="block text-xs font-medium text-ink mb-1">
          Message <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <textarea
          id="application-message"
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          disabled={disabled || submitting}
          rows={4}
          maxLength={APPLICATION_MESSAGE_MAX_LENGTH + 20}
          placeholder="Brief note for the team lead (optional, max 250 characters)"
          className="w-full px-2 py-1.5 text-sm border border-cream-300 rounded bg-white disabled:bg-cream-100 resize-y min-h-[6rem]"
          data-testid="application-message-input"
        />
        <p
          className={`mt-1 text-xs ${overLimit ? 'text-red-700' : 'text-ink-muted'}`}
          data-testid="application-message-count"
        >
          {trimmedLen} / {APPLICATION_MESSAGE_MAX_LENGTH} characters
          {overLimit ? ' — too long' : ''}
        </p>
        {fieldErrors.message ? (
          <p className="mt-1 text-xs text-red-700" role="alert" data-testid="application-message-error">
            {fieldErrors.message}
          </p>
        ) : null}
      </div>

      {submitError ? (
        <div
          role="alert"
          className="text-xs text-red-800 space-y-1"
          data-testid="application-form-error"
        >
          <p>{submitError}</p>
          <p>Your entered message was kept.</p>
        </div>
      ) : null}

      {successNotice ? (
        <div
          role="status"
          className="text-xs text-forest-900 bg-forest-50 border border-forest-100 rounded p-2"
          data-testid="application-form-success"
        >
          {successNotice}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={disabled || submitting}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-forest rounded hover:bg-forest-800 disabled:opacity-50"
          data-testid="submit-application"
        >
          {submitting ? 'Submitting…' : 'Submit application'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="px-3 py-1.5 text-xs font-medium border border-cream-300 rounded bg-cream-50 hover:bg-cream-100 disabled:opacity-50"
          data-testid="application-form-dismiss"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

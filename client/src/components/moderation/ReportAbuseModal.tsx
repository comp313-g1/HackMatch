import React, { useEffect, useState } from 'react';
import {
  MAX_REPORT_EXPLANATION_LENGTH,
  REPORT_CATEGORIES,
  type ReportCategory,
  type ReportReceiptDto,
  type ReportTargetSummary,
  type ReportTargetType,
} from './reportTypes';
import { validateReportSubmissionInput } from './reportValidation';
import { submitModerationReport } from './reportsApi';

export interface ReportAbuseModalProps {
  isOpen: boolean;
  target: ReportTargetSummary | null;
  authToken?: string;
  onClose: () => void;
  onSuccess?: (receipt: ReportReceiptDto) => void;
  submitReportFn?: typeof submitModerationReport;
}

const TARGET_TYPE_LABELS: Record<ReportTargetType, string> = {
  profile: 'Participant Profile',
  team: 'Team Listing',
  event: 'Verified Event Listing',
  url: 'Suspicious External URL',
};

export function ReportAbuseModal({
  isOpen,
  target,
  authToken,
  onClose,
  onSuccess,
  submitReportFn = submitModerationReport,
}: ReportAbuseModalProps): React.JSX.Element | null {
  const [category, setCategory] = useState<string>('');
  const [explanation, setExplanation] = useState<string>('');
  const [flaggedUrl, setFlaggedUrl] = useState<string>(
    target?.flaggedUrl ?? ''
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(
    null
  );
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [receipt, setReceipt] = useState<ReportReceiptDto | null>(null);

  const targetKey = target
    ? `${target.targetType}:${target.targetId}:${target.flaggedUrl ?? ''}`
    : '';

  useEffect(() => {
    if (isOpen && target) {
      setCategory('');
      setExplanation('');
      setFlaggedUrl(target.flaggedUrl ?? '');
      setFieldErrors({});
      setAlertMessage(null);
      setRetryAfterSeconds(null);
      setIsSubmitting(false);
      setReceipt(null);
    }
  }, [isOpen, targetKey, target]);

  if (!isOpen) {
    return null;
  }

  if (!target) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-abuse-modal-title"
        aria-describedby="report-abuse-modal-desc"
      >
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl border border-cream-200 space-y-4">
          <h2
            id="report-abuse-modal-title"
            className="text-lg font-bold text-ink"
          >
            Report Misconduct
          </h2>
          <p id="report-abuse-modal-desc" className="text-sm text-ink-muted">
            No report target is currently selected. Please choose a profile, team
            listing, or Verified event listing to report.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-ink bg-cream-100 hover:bg-cream-200 rounded-md focus:outline-none focus:ring-2 focus:ring-forest"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  const showFlaggedUrlField =
    target.targetType === 'url' ||
    category === 'Phishing Link' ||
    Boolean(target.flaggedUrl);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFieldErrors({});
    setAlertMessage(null);
    setRetryAfterSeconds(null);

    const validation = validateReportSubmissionInput({
      targetType: target.targetType,
      targetId: target.targetId,
      category,
      explanation,
      flaggedUrl: showFlaggedUrlField ? flaggedUrl : null,
    });

    if (!validation.valid || !validation.normalized) {
      setFieldErrors(validation.fieldErrors);
      const firstError =
        Object.values(validation.fieldErrors)[0] ||
        'Please correct the highlighted fields before submitting.';
      setAlertMessage(firstError);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await submitReportFn(validation.normalized, authToken);
      if (result.ok) {
        setReceipt(result.data);
        if (onSuccess) {
          onSuccess(result.data);
        }
        return;
      }

      if (result.error.fieldErrors) {
        setFieldErrors(result.error.fieldErrors);
      }
      if (typeof result.error.retryAfterSeconds === 'number') {
        setRetryAfterSeconds(result.error.retryAfterSeconds);
      }
      setAlertMessage(result.error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const remainingChars =
    MAX_REPORT_EXPLANATION_LENGTH - [...explanation.trim()].length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-abuse-modal-title"
      aria-describedby="report-abuse-modal-desc"
      data-testid="report-abuse-modal"
    >
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl border border-cream-200 space-y-4">
        <div className="flex items-start justify-between gap-3 border-b border-cream-100 pb-3">
          <div>
            <h2
              id="report-abuse-modal-title"
              className="text-lg font-bold text-ink"
            >
              Report {TARGET_TYPE_LABELS[target.targetType]}
            </h2>
            <p
              id="report-abuse-modal-desc"
              className="text-xs text-ink-muted mt-0.5"
            >
              Other participants cannot read your report. Submissions feed
              directly into the confidential Administrator moderation queue.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report modal"
            className="text-xs font-semibold text-ink-muted hover:text-ink px-2 py-1 rounded focus:outline-none focus:ring-2 focus:ring-forest"
          >
            ✕
          </button>
        </div>

        {/* Target summary banner */}
        <div
          className="rounded-lg bg-cream-50 border border-cream-200 p-3 text-xs space-y-1"
          data-testid="report-target-summary"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-forest-900">
              Target: {target.targetName}
            </span>
            <span className="px-2 py-0.5 rounded bg-forest-50 text-forest-800 border border-forest-200 font-medium">
              {TARGET_TYPE_LABELS[target.targetType]}
            </span>
          </div>
          <div className="text-[11px] text-ink-muted font-mono">
            ID: {target.targetId}
          </div>
        </div>

        {receipt ? (
          <div
            role="status"
            aria-live="polite"
            data-testid="report-receipt-confirmation"
            className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 space-y-3 text-xs text-emerald-950"
          >
            <div className="font-bold text-sm text-emerald-900">
              Report Received
            </div>
            <p>{receipt.confirmationMessage}</p>
            <dl className="grid grid-cols-2 gap-2 pt-2 border-t border-emerald-200/70 text-[11px]">
              <div>
                <dt className="font-semibold text-emerald-800">Receipt ID</dt>
                <dd className="font-mono">{receipt.reportId}</dd>
              </div>
              <div>
                <dt className="font-semibold text-emerald-800">
                  Moderation Case ID
                </dt>
                <dd className="font-mono">{receipt.caseId}</dd>
              </div>
              <div>
                <dt className="font-semibold text-emerald-800">Category</dt>
                <dd>{receipt.category}</dd>
              </div>
              <div>
                <dt className="font-semibold text-emerald-800">
                  Hourly Reports Remaining
                </dt>
                <dd>
                  {receipt.rateLimit.remaining} of {receipt.rateLimit.limit}
                </dd>
              </div>
            </dl>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                data-testid="report-receipt-done-btn"
                className="px-4 py-2 text-xs font-semibold text-white bg-forest hover:bg-forest-800 rounded-md focus:outline-none focus:ring-2 focus:ring-forest"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {alertMessage && (
              <div
                role="alert"
                aria-live="assertive"
                data-testid="report-error-alert"
                className="rounded-md bg-red-50 border border-red-200 p-3 text-xs text-red-800 space-y-1"
              >
                <p className="font-semibold">{alertMessage}</p>
                {retryAfterSeconds !== null && retryAfterSeconds > 0 && (
                  <p data-testid="report-retry-hint">
                    You can submit another report in{' '}
                    {Math.max(1, Math.ceil(retryAfterSeconds / 60))} minute(s) (
                    {retryAfterSeconds} seconds). Your entered details are
                    preserved below.
                  </p>
                )}
              </div>
            )}

            {isSubmitting && (
              <div
                role="status"
                aria-live="polite"
                className="text-xs font-medium text-forest-800"
              >
                Submitting report to moderation queue...
              </div>
            )}

            <div>
              <label
                htmlFor="report-category-select"
                className="block text-xs font-semibold text-ink mb-1"
              >
                Report Category <span aria-hidden="true">*</span>
              </label>
              <select
                id="report-category-select"
                name="category"
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as ReportCategory | '')
                }
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.category)}
                aria-describedby={
                  fieldErrors.category ? 'report-category-error' : undefined
                }
                className="w-full rounded-md border border-cream-300 bg-white px-3 py-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-forest"
              >
                <option value="">Select a category...</option>
                {REPORT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              {fieldErrors.category && (
                <p
                  id="report-category-error"
                  className="mt-1 text-xs text-red-700"
                >
                  {fieldErrors.category}
                </p>
              )}
            </div>

            {showFlaggedUrlField && (
              <div>
                <label
                  htmlFor="report-flagged-url-input"
                  className="block text-xs font-semibold text-ink mb-1"
                >
                  Suspicious External URL (https://){' '}
                  {target.targetType === 'url' ? (
                    <span aria-hidden="true">*</span>
                  ) : (
                    <span className="font-normal text-ink-muted">
                      (optional)
                    </span>
                  )}
                </label>
                <input
                  id="report-flagged-url-input"
                  name="flaggedUrl"
                  type="url"
                  value={flaggedUrl}
                  onChange={(e) => setFlaggedUrl(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="https://example.com/suspicious-link"
                  aria-invalid={Boolean(fieldErrors.flaggedUrl)}
                  aria-describedby={
                    fieldErrors.flaggedUrl
                      ? 'report-flagged-url-error'
                      : undefined
                  }
                  className="w-full rounded-md border border-cream-300 bg-white px-3 py-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-forest"
                />
                {fieldErrors.flaggedUrl && (
                  <p
                    id="report-flagged-url-error"
                    className="mt-1 text-xs text-red-700"
                  >
                    {fieldErrors.flaggedUrl}
                  </p>
                )}
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="report-explanation-input"
                  className="block text-xs font-semibold text-ink"
                >
                  Explanation{' '}
                  <span className="font-normal text-ink-muted">(optional)</span>
                </label>
                <span className="text-[11px] text-ink-muted">
                  {remainingChars} characters remaining
                </span>
              </div>
              <textarea
                id="report-explanation-input"
                name="explanation"
                rows={4}
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                disabled={isSubmitting}
                placeholder="Provide optional context for Administrators (up to 1000 characters)..."
                aria-invalid={Boolean(fieldErrors.explanation)}
                aria-describedby={
                  fieldErrors.explanation
                    ? 'report-explanation-error'
                    : undefined
                }
                className="w-full rounded-md border border-cream-300 bg-white px-3 py-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-forest"
              />
              {fieldErrors.explanation && (
                <p
                  id="report-explanation-error"
                  className="mt-1 text-xs text-red-700"
                >
                  {fieldErrors.explanation}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-cream-100">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-3 py-1.5 text-xs font-semibold text-ink bg-cream-100 hover:bg-cream-200 rounded-md focus:outline-none focus:ring-2 focus:ring-forest"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                data-testid="submit-report-btn"
                className="px-4 py-1.5 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-60 rounded-md focus:outline-none focus:ring-2 focus:ring-red-700"
              >
                {isSubmitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default ReportAbuseModal;

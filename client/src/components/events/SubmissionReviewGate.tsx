import React, { useEffect, useState } from 'react';
import {
  isSubmissionId,
  loadSubmissionReview,
  parseReview,
  recruitmentBlockReason,
  ReviewLoadError,
  type ReviewLoader,
  type SubmissionReview,
} from './submissionReview';

type ReviewState = {
  id: string;
  phase: 'loading' | 'ready' | 'error';
  review?: SubmissionReview | null;
  message?: string;
};

interface SubmissionReviewGateProps {
  submissionId: string;
  loadReview?: ReviewLoader;
  children: (canonicalEventId: string) => React.ReactNode;
}

export function SubmissionReviewGate({
  submissionId,
  loadReview = loadSubmissionReview,
  children,
}: SubmissionReviewGateProps): React.JSX.Element {
  const [state, setState] = useState<ReviewState>({
    id: submissionId,
    phase: 'loading',
  });

  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now);

  const valid = isSubmissionId(submissionId);

  useEffect(() => {
    if (!valid) return;

    const controller = new AbortController();

    setState({
      id: submissionId,
      phase: 'loading',
    });

    void loadReview(submissionId, controller.signal)
      .then(value => {
        if (controller.signal.aborted) return;

        const review = parseReview(value, submissionId);

        setNow(Date.now());
        setState({
          id: submissionId,
          phase: 'ready',
          review,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;

        let message = 'Could not verify review status. Please retry.';

        if (error instanceof ReviewLoadError) {
          if (error.kind === 'unauthorized') {
            message =
              'Sign in with permission to view this submission. Recruitment remains blocked.';
          } else if (error.kind === 'unavailable') {
            message = error.message;
          } else {
            message = 'Could not load review status. Please retry.';
          }
        }

        setState({
          id: submissionId,
          phase: 'error',
          message,
        });
      });

    return () => controller.abort();
  }, [submissionId, loadReview, revision, valid]);

  useEffect(() => {
    const endDate = state.review?.canonicalEvent?.endDate;

    if (!endDate) return;

    const remaining = Date.parse(endDate) - Date.now();

    if (remaining <= 0) return;

    // Recheck when the event expires, even if the page stays open.
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(remaining, 2147483647)
    );

    return () => window.clearTimeout(timer);
  }, [state, now]);

  function refresh(): void {
    // Remove previously enabled actions immediately while rechecking.
    setState({
      id: submissionId,
      phase: 'loading',
    });

    setRevision(value => value + 1);
  }

  if (!submissionId) {
    return (
      <p role="status">
        Select a submission to inspect its review status.
        Recruitment is blocked.
      </p>
    );
  }

  if (!valid) {
    return (
      <p role="alert">
        Enter a valid submission ID (UUID). Recruitment is blocked.
      </p>
    );
  }

  if (state.id !== submissionId || state.phase === 'loading') {
    return (
      <p role="status" aria-busy="true">
        Checking ADMIN approval… Recruitment is blocked.
      </p>
    );
  }

  const review = state.review;

  const reason = review
    ? recruitmentBlockReason(review, Math.max(now, Date.now()))
    : null;

  return (
    <section
      aria-label="Submission review"
      className="space-y-4 rounded-xl border border-cream-200 bg-white p-6"
    >
      {state.phase === 'error' ? (
        <p role="alert">{state.message}</p>
      ) : !review ? (
        <p role="status">
          No visible submission was found. Check the ID and your account.
          Recruitment is blocked.
        </p>
      ) : (
        <>
          <h2 className="text-lg font-semibold">
            {review.status === 'Pending'
              ? 'Pending Verification'
              : review.status}
          </h2>

          <p role="status">
            {reason ??
              (review.status === 'Merged'
                ? 'Merged into a published canonical event. Continue recruitment there.'
                : 'ADMIN approved this submission. Recruitment is available for the canonical event.')}
          </p>

          <h3 className="font-semibold">ADMIN feedback</h3>

          <p className="whitespace-pre-wrap break-words">
            {review.adminFeedback?.trim() || 'No ADMIN feedback yet.'}
          </p>

          {review.canonicalEvent && (
            <p className="break-words">
              Canonical event: {review.canonicalEvent.id}
            </p>
          )}

          {!reason &&
            review.canonicalEvent &&
            children(review.canonicalEvent.id)}
        </>
      )}

      <button
        type="button"
        onClick={refresh}
        className="rounded border px-4 py-2 text-forest"
      >
        Refresh review status
      </button>
    </section>
  );
}
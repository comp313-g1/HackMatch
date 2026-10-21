// Frontend integration contract.
// This is NOT an existing backend endpoint or response format.

export interface SubmissionReview {
  id: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Merged';
  adminFeedback: string | null;
  canonicalEvent: {
    id: string;
    status: 'Published' | 'Archived' | 'Disabled';
    endDate: string;
    minTeamSize: number | null;
    maxTeamSize: number | null;
  } | null;
}

export type ReviewLoader = (
  submissionId: string,
  signal: AbortSignal
) => Promise<unknown>;

export class ReviewLoadError extends Error {
  constructor(
    readonly kind: 'unauthorized' | 'unavailable' | 'network',
    message: string
  ) {
    super(message);
  }
}

// The supplied project does not have a submission-status endpoint.
// Keep recruitment blocked instead of calling an invented URL.
export const loadSubmissionReview: ReviewLoader = async () => {
  throw new ReviewLoadError(
    'unavailable',
    'Event review status is not connected yet. Recruitment remains blocked.'
  );
};

export function isSubmissionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function parseReview(
  value: unknown,
  expectedId: string
): SubmissionReview | null {
  if (value === null) return null;

  if (!value || typeof value !== 'object') {
    throw new Error('Invalid review response.');
  }

  const review = value as SubmissionReview;

  if (
    review.id !== expectedId ||
    !['Pending', 'Approved', 'Rejected', 'Merged'].includes(review.status) ||
    !(
      review.adminFeedback === null ||
      typeof review.adminFeedback === 'string'
    )
  ) {
    throw new Error('Invalid review response.');
  }

  const event = review.canonicalEvent;

  if (
    event !== null &&
    (
      !event ||
      !isSubmissionId(event.id) ||
      !['Published', 'Archived', 'Disabled'].includes(event.status) ||
      typeof event.endDate !== 'string' ||
      !Number.isFinite(Date.parse(event.endDate)) ||
      ![event.minTeamSize, event.maxTeamSize].every(
        limit =>
          limit === null ||
          (Number.isSafeInteger(limit) && Number(limit) > 0)
      ) ||
      (
        event.minTeamSize !== null &&
        event.maxTeamSize !== null &&
        event.minTeamSize > event.maxTeamSize
      )
    )
  ) {
    throw new Error('Invalid canonical event response.');
  }

  return review;
}

export function recruitmentBlockReason(
  review: SubmissionReview,
  now: number
): string | null {
  if (review.status === 'Pending') {
    return 'Pending Verification: recruitment is blocked until ADMIN approval.';
  }

  if (review.status === 'Rejected') {
    return 'Rejected: review the ADMIN feedback and correct your submission before another review.';
  }

  const event = review.canonicalEvent;

  if (!event) {
    return 'The canonical event is not available. Recruitment remains blocked.';
  }

  if (event.status !== 'Published') {
    return 'The canonical event is archived or disabled. Recruitment is blocked.';
  }

  if (Date.parse(event.endDate) <= now) {
    return 'This event has ended. Recruitment is closed.';
  }

  if (event.minTeamSize === null || event.maxTeamSize === null) {
    return 'Official team limits are unresolved. Recruitment remains blocked.';
  }

  return null;
}
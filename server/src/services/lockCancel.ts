/**
 * US-022 / #209 / FR-067 — cancel-on-lock contract helpers.
 *
 * The atomic write lives in lock_team (0036 / #208). This module documents and
 * unit-tests the cancel outcome shape that Express and React must surface.
 */

export const LOCK_CANCEL_REASON = 'TEAM_LOCKED' as const;
export const LOCK_CANCEL_NOTIFICATION_TYPE = 'REQUEST_CANCELED_TEAM_LOCKED' as const;
export const LOCK_MEMBER_NOTIFICATION_TYPE = 'TEAM_ROSTER_LOCKED' as const;

export interface LockCancelOutcome {
  canceledRequests: number;
  cancelReason: typeof LOCK_CANCEL_REASON;
  invitationCanceled: boolean;
  applicationCanceled: boolean;
  acceptedUntouched: boolean;
}

/**
 * Pure assertion helper for cancel-on-lock evidence (happy / boundary / failure).
 * Mirrors what the SQL CTE must produce after lock_team commits.
 */
export function summarizeLockCancelOutcome(input: {
  pendingInvitations: number;
  pendingApplications: number;
  acceptedBefore: number;
  acceptedAfter: number;
  canceledRows: Array<{ request_type: 'Invitation' | 'Application'; status: string; cancel_reason: string | null }>;
}): LockCancelOutcome {
  const invitationCanceled = input.canceledRows.some(
    (row) =>
      row.request_type === 'Invitation' &&
      row.status === 'Canceled' &&
      row.cancel_reason === LOCK_CANCEL_REASON
  );
  const applicationCanceled = input.canceledRows.some(
    (row) =>
      row.request_type === 'Application' &&
      row.status === 'Canceled' &&
      row.cancel_reason === LOCK_CANCEL_REASON
  );

  return {
    canceledRequests: input.pendingInvitations + input.pendingApplications,
    cancelReason: LOCK_CANCEL_REASON,
    invitationCanceled:
      input.pendingInvitations === 0 ? true : invitationCanceled,
    applicationCanceled:
      input.pendingApplications === 0 ? true : applicationCanceled,
    acceptedUntouched: input.acceptedBefore === input.acceptedAfter,
  };
}

export function canceledRequestsLockMessage(canceledRequests: number): string {
  if (canceledRequests === 1) {
    return '1 pending request was canceled.';
  }
  return `${canceledRequests} pending requests were canceled.`;
}

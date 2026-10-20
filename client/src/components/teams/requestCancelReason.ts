/**
 * US-022 / #209 / FR-064 / FR-067 — humanize team_requests.cancel_reason for UI.
 * Includes TEAM_LOCKED from atomic lock cancel (#208 RPC).
 */

export const TEAM_LOCKED_CANCEL_REASON = 'TEAM_LOCKED';

export function cancelReasonLabel(reason: string | null | undefined): string | null {
  if (!reason || !reason.trim()) return null;

  switch (reason) {
    case 'TEAM_LOCKED':
      return 'Canceled because the roster was locked.';
    case 'TEAM_DISBANDED':
      return 'Canceled because the team was disbanded.';
    case 'SLOT_REMOVED':
      return 'Canceled because the open slot was removed.';
    case 'OWNER_CANCELED':
      return 'Canceled by the team owner.';
    case 'APPLICANT_WITHDRAWN':
      return 'Withdrawn by the applicant.';
    case 'OWNER_DECLINED':
      return 'Declined by the team owner.';
    case 'INVITEE_DECLINED':
      return 'Declined by the invitee.';
    case 'OWNER_CREATED_TEAM':
      return 'Canceled because the participant created their own team.';
    default:
      return `Canceled (${reason}).`;
  }
}

/** Owner-facing lock success copy from canceledRequests count (#208 / #209). */
export function canceledRequestsOnLockNotice(canceledRequests: number): string {
  if (canceledRequests <= 0) {
    return 'No pending invitations or applications needed canceling.';
  }
  if (canceledRequests === 1) {
    return '1 pending invitation or application was canceled.';
  }
  return `${canceledRequests} pending invitations and applications were canceled.`;
}

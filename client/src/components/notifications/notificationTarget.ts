import type { RequestsTab } from '../RequestsPage';
import type { NotificationView } from './notificationTypes';

/**
 * Where clicking a notification should take the user (US-021 AC 3).
 * Destinations are existing views that re-fetch and re-authorize their own data,
 * so a stale, deleted, or hidden target shows that view's normal state and never
 * the notification's content (FR-065).
 */
export type NotificationTarget =
  | { kind: 'requests'; tab: RequestsTab }
  | { kind: 'team'; eventId: string | null }
  | { kind: 'none' };

export function resolveNotificationTarget(n: NotificationView): NotificationTarget {
  const { type } = n;

  // Inbound invitation (the invitee responds under Requests → Invitations).
  if (type === 'team_invitation' || type === 'team_invitation_expired') {
    return { kind: 'requests', tab: 'invitations' };
  }

  // Outcomes of the viewer's own applications.
  if (type.startsWith('team_application_') && type !== 'team_application_submitted') {
    return { kind: 'requests', tab: 'applications' };
  }
  if (type.startsWith('REQUEST_CANCELED_') || type === 'team_request_canceled_membership') {
    return { kind: 'requests', tab: 'applications' };
  }

  // Owner-side review: applications received, invitation responses, roster events.
  if (
    type === 'team_application_submitted' ||
    type.startsWith('team_invitation_') ||
    n.category === 'roster' ||
    type === 'TEAM_DISBANDED'
  ) {
    return { kind: 'team', eventId: n.eventId };
  }

  // Event verification: an approved/merged event is ready for team work; a rejection
  // has no destination view yet, so it is only marked read.
  if (n.category === 'event_verification') {
    return type === 'event_verification_rejected' || !n.eventId
      ? { kind: 'none' }
      : { kind: 'team', eventId: n.eventId };
  }

  return n.eventId ? { kind: 'team', eventId: n.eventId } : { kind: 'none' };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact relative time, e.g. "just now", "5m ago", "3h ago", "2d ago", else a date. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, now - then);
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Badge text: hidden at 0, capped at 99+. */
export function formatBadgeCount(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? '99+' : String(Math.floor(count));
}

/** Short hint shown on each item describing where clicking leads; null when it only marks read. */
export function describeNotificationTarget(target: NotificationTarget): string | null {
  switch (target.kind) {
    case 'requests':
      return target.tab === 'invitations'
        ? 'Opens Requests › Invitations'
        : 'Opens Requests › Applications';
    case 'team':
      return 'Opens your team';
    default:
      return null;
  }
}
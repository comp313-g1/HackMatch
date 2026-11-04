/**
 * US-021 / #197 notification center model contract (PostgreSQL).
 *
 * Source of truth: migrations 0011 (participant_notifications) and
 * 0044_extend_participant_notifications_for_notification_center.sql.
 * Express endpoints and React UI ship in later US-021 tasks.
 */

export const NOTIFICATION_TYPE_MAX_LENGTH = 50;
export const NOTIFICATION_MESSAGE_MAX_LENGTH = 500;

export const NOTIFICATION_CATEGORIES = [
  'invitation',
  'application',
  'decision',
  'roster',
  'event_verification',
  'general',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface NotificationModelFields {
  id: string;
  participantId: string;
  teamId: string | null;
  eventId: string | null;
  requestId: string | null;
  submissionId: string | null;
  type: string;
  category: NotificationCategory;
  message: string;
  readAt: string | null;
  createdAt: string;
}

const DECISION_TYPES = new Set([
  'team_application_approved',
  'team_application_declined',
  'team_invitation_accepted',
  'team_invitation_declined',
]);

/** Mirrors SQL notification_category_for_type(); keep the two in sync. */
export function notificationCategoryForType(type: string): NotificationCategory {
  if (type === 'team_invitation') return 'invitation';
  if (type === 'team_application_submitted') return 'application';
  if (DECISION_TYPES.has(type)) return 'decision';
  if (type === 'TEAM_ROSTER_LOCKED') return 'roster';
  if (type.startsWith('event_verification_')) return 'event_verification';
  return 'general';
}

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return (
    typeof value === 'string' &&
    (NOTIFICATION_CATEGORIES as readonly string[]).includes(value)
  );
}

/** Trim; empty / whitespace-only → null (callers treat null as invalid). */
export function normalizeNotificationMessage(
  message: string | null | undefined
): string | null {
  if (message == null) return null;
  const trimmed = message.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function isNotificationMessageTooLong(
  message: string | null | undefined
): boolean {
  const normalized = normalizeNotificationMessage(message);
  return normalized != null && normalized.length > NOTIFICATION_MESSAGE_MAX_LENGTH;
}

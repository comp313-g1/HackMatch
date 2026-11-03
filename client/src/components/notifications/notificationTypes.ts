/** US-021 / #200 notification center client types (FR-063, FR-065). Mirrors server/src/services/notificationHub.ts. */

export const NOTIFICATION_CATEGORIES = [
  'invitation',
  'application',
  'decision',
  'roster',
  'event_verification',
  'general',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface NotificationView {
  id: string;
  type: string;
  category: NotificationCategory;
  message: string;
  teamId: string | null;
  eventId: string | null;
  requestId: string | null;
  submissionId: string | null;
  /** null while unread. */
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListParams {
  limit?: number;
  cursor?: string | null;
  unreadOnly?: boolean;
}

export interface NotificationListPage {
  notifications: NotificationView[];
  unreadCount: number;
  nextCursor: string | null;
}

export interface MarkReadResult {
  notification: NotificationView;
  alreadyRead: boolean;
  unreadCount: number;
}

export interface MarkAllReadResult {
  markedCount: number;
  unreadCount: number;
}

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  invitation: 'Invitation',
  application: 'Application',
  decision: 'Decision',
  roster: 'Roster',
  event_verification: 'Event verification',
  general: 'Update',
};

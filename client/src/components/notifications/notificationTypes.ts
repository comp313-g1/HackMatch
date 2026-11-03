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

/** Specific alert labels by type (US-021 AC 2); unknown types fall back to the category label. */
const TYPE_LABELS: Record<string, string> = {
  team_invitation: 'Invitation',
  team_invitation_accepted: 'Invitation accepted',
  team_invitation_declined: 'Invitation declined',
  team_invitation_canceled: 'Invitation canceled',
  team_invitation_expired: 'Invitation expired',
  team_application_submitted: 'Application received',
  team_application_approved: 'Application approved',
  team_application_declined: 'Application declined',
  team_application_withdrawn: 'Application withdrawn',
  TEAM_ROSTER_LOCKED: 'Roster locked',
  TEAM_DISBANDED: 'Team disbanded',
  event_verification_approved: 'Event approved',
  event_verification_rejected: 'Event not approved',
  event_verification_merged: 'Event merged',
};

export function getNotificationLabel(n: Pick<NotificationView, 'type' | 'category'>): string {
  if (TYPE_LABELS[n.type]) return TYPE_LABELS[n.type];
  if (n.type.startsWith('REQUEST_CANCELED_')) return 'Request canceled';
  if (n.type.startsWith('moderation_')) return 'Moderation notice';
  return CATEGORY_LABELS[n.category] ?? CATEGORY_LABELS.general;
}
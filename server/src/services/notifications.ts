/**
 * US-021 / #198 notification service for recruitment and event events.
 *
 * Recruitment alerts (invitation, application, decision, roster lock) are written
 * by the lifecycle SQL functions inside their own transactions; this service
 * delivers those rows live via deliverStoredNotification(), fed by the Realtime
 * bridge. Event-verification alerts have no SQL producer, so notify() /
 * notifyEventVerificationOutcome() create them here. Delivery is best effort and
 * never rolls back or fails a committed notification: offline recipients see it
 * on their next load (FR-064, NR-004).
 */

import {
  NOTIFICATION_MESSAGE_MAX_LENGTH,
  NOTIFICATION_TYPE_MAX_LENGTH,
  normalizeNotificationMessage,
  type NotificationCategory,
} from '../db/notificationModel.js';
import {
  notificationsRepository,
  type INotificationFeedRepository,
  type INotificationsRepository,
  type NotificationCursor,
} from '../db/notifications.repository.js';
import type { ParticipantNotification } from '../db/types.js';
import {
  notificationHub,
  type NotificationHub,
  type NotificationView,
} from './notificationHub.js';

export type { NotificationView };

export type NotificationFieldErrors = Partial<
  Record<'participantId' | 'type' | 'message', string>
>;

export class NotificationServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: NotificationFieldErrors;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors?: NotificationFieldErrors
  ) {
    super(message);
    this.name = 'NotificationServiceError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export interface NotifyInput {
  participantId: string;
  type: string;
  message: string;
  teamId?: string | null;
  eventId?: string | null;
  requestId?: string | null;
  submissionId?: string | null;
}

export interface NotificationServiceDeps {
  repository?: INotificationsRepository;
  hub?: NotificationHub;
}

export function toNotificationView(row: ParticipantNotification): NotificationView {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    message: row.message,
    teamId: row.team_id,
    eventId: row.event_id,
    requestId: row.request_id,
    submissionId: row.submission_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

function validate(input: NotifyInput): { type: string; message: string } {
  const errors: NotificationFieldErrors = {};
  const type = typeof input.type === 'string' ? input.type.trim() : '';
  const message = normalizeNotificationMessage(input.message);

  if (!input.participantId || !input.participantId.trim()) {
    errors.participantId = 'A recipient is required.';
  }
  if (!type) {
    errors.type = 'A notification type is required.';
  } else if (type.length > NOTIFICATION_TYPE_MAX_LENGTH) {
    errors.type = `Type must be ${NOTIFICATION_TYPE_MAX_LENGTH} characters or fewer.`;
  }
  if (message == null) {
    errors.message = 'A message is required.';
  } else if (message.length > NOTIFICATION_MESSAGE_MAX_LENGTH) {
    errors.message = `Message must be ${NOTIFICATION_MESSAGE_MAX_LENGTH} characters or fewer.`;
  }

  if (Object.keys(errors).length > 0 || message == null) {
    throw new NotificationServiceError(
      400,
      'VALIDATION_ERROR',
      'Notification validation failed.',
      errors
    );
  }
  return { type, message };
}

// Both notify() and the Realtime bridge see the same insert; remember recent ids
// so a notification is pushed to the recipient exactly once.
const RECENT_DELIVERY_LIMIT = 1000;
const recentlyDelivered = new Set<string>();

function rememberDelivery(id: string): boolean {
  if (recentlyDelivered.has(id)) return false;
  recentlyDelivered.add(id);
  if (recentlyDelivered.size > RECENT_DELIVERY_LIMIT) {
    const oldest = recentlyDelivered.values().next().value;
    if (oldest !== undefined) recentlyDelivered.delete(oldest);
  }
  return true;
}

/** Test seam: clears the delivery de-duplication memory. */
export function resetDeliveryMemory(): void {
  recentlyDelivered.clear();
}

/**
 * Pushes an already-stored notification to the recipient's live subscribers.
 * Returns the number of subscribers reached (0 when offline or already pushed).
 * Never throws: a delivery problem must not affect the stored notification.
 */
export async function deliverStoredNotification(
  row: ParticipantNotification,
  deps: NotificationServiceDeps = {}
): Promise<number> {
  const repository = deps.repository ?? notificationsRepository;
  const hub = deps.hub ?? notificationHub;

  if (hub.subscriberCount(row.participant_id) === 0) return 0;
  if (!rememberDelivery(row.id)) return 0;

  try {
    const unreadCount = await repository.countUnread(row.participant_id);
    return hub.publish(row.participant_id, {
      notification: toNotificationView(row),
      unreadCount,
    });
  } catch (err) {
    console.warn('[NOTIFICATIONS] live delivery failed; stored notification unaffected:', err);
    return 0;
  }
}

/**
 * Validates, stores, then delivers a notification. Invalid input is rejected
 * before anything is written; a failed insert is thrown and nothing is pushed.
 */
export async function notify(
  input: NotifyInput,
  deps: NotificationServiceDeps = {}
): Promise<NotificationView> {
  const { type, message } = validate(input);
  const repository = deps.repository ?? notificationsRepository;

  const row = await repository.create({
    participant_id: input.participantId,
    type,
    message,
    team_id: input.teamId,
    event_id: input.eventId,
    request_id: input.requestId,
    submission_id: input.submissionId,
  });

  await deliverStoredNotification(row, deps);
  return toNotificationView(row);
}

export type EventVerificationOutcome = 'approved' | 'rejected' | 'merged';

export interface EventVerificationNotificationInput {
  participantId: string;
  submissionId: string;
  eventId?: string | null;
  outcome: EventVerificationOutcome;
  eventTitle: string;
  adminFeedback?: string | null;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function eventVerificationMessage(input: EventVerificationNotificationInput): string {
  const title = input.eventTitle.trim() || 'your event';
  const feedback = input.adminFeedback?.trim();

  switch (input.outcome) {
    case 'approved':
      return truncate(`Your event "${title}" was approved and is now listed.`, NOTIFICATION_MESSAGE_MAX_LENGTH);
    case 'merged':
      return truncate(
        `Your event "${title}" matched an existing event and was merged with it.`,
        NOTIFICATION_MESSAGE_MAX_LENGTH
      );
    case 'rejected':
    default:
      return truncate(
        feedback
          ? `Your event "${title}" was not approved. Feedback: ${feedback}`
          : `Your event "${title}" was not approved.`,
        NOTIFICATION_MESSAGE_MAX_LENGTH
      );
  }
}

/** Event verification approval / rejection alert for the submitter (US-021 AC 2). */
export async function notifyEventVerificationOutcome(
  input: EventVerificationNotificationInput,
  deps: NotificationServiceDeps = {}
): Promise<NotificationView> {
  return notify(
    {
      participantId: input.participantId,
      type: `event_verification_${input.outcome}`,
      message: eventVerificationMessage(input),
      eventId: input.eventId ?? null,
      submissionId: input.submissionId,
    },
    deps
  );
}


// ---------------------------------------------------------------------------
// US-021 / #199 notification list, mark-read and mark-all-read (FR-063, FR-065)
// ---------------------------------------------------------------------------

export interface NotificationListResult {
  notifications: NotificationView[];
  unreadCount: number;
  nextCursor: string | null;
}

export interface NotificationFeedDeps {
  repository?: INotificationsRepository & INotificationFeedRepository;
}

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id]), 'utf8').toString(
    'base64url'
  );
}

export interface ListNotificationsInput {
  participantId: string;
  limit: number;
  cursor: NotificationCursor | null;
  unreadOnly: boolean;
  category: NotificationCategory | null;
}

/** Newest-first feed for one participant plus the unread badge count. */
export async function listNotifications(
  input: ListNotificationsInput,
  deps: NotificationFeedDeps = {}
): Promise<NotificationListResult> {
  const repository = deps.repository ?? notificationsRepository;

  // Fetch one extra row to know whether another page exists.
  const [rows, unreadCount] = await Promise.all([
    repository.listForParticipant(input.participantId, {
      limit: input.limit + 1,
      cursor: input.cursor,
      unreadOnly: input.unreadOnly,
      category: input.category,
    }),
    repository.countUnread(input.participantId),
  ]);

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];

  return {
    notifications: page.map(toNotificationView),
    unreadCount,
    nextCursor:
      hasMore && last
        ? encodeNotificationCursor({ createdAt: last.created_at, id: last.id })
        : null,
  };
}

function toFeedError(err: unknown): NotificationServiceError | null {
  const message = err instanceof Error ? err.message : (err as { message?: unknown })?.message;
  if (typeof message !== 'string') return null;
  if (message.includes('NOTIFICATION_NOT_FOUND')) {
    return new NotificationServiceError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found.');
  }
  if (message.includes('VALIDATION_ERROR')) {
    return new NotificationServiceError(400, 'VALIDATION_ERROR', 'Validation failed.');
  }
  return null;
}

/** Idempotent; another account's id is indistinguishable from a missing one (404). */
export async function markNotificationRead(
  participantId: string,
  notificationId: string,
  deps: NotificationFeedDeps = {}
): Promise<{ notification: NotificationView; alreadyRead: boolean; unreadCount: number }> {
  const repository = deps.repository ?? notificationsRepository;
  try {
    const result = await repository.markRead(participantId, notificationId);
    return {
      notification: toNotificationView(result.notification),
      alreadyRead: result.alreadyRead,
      unreadCount: result.unreadCount,
    };
  } catch (err) {
    throw toFeedError(err) ?? err;
  }
}

export async function markAllNotificationsRead(
  participantId: string,
  deps: NotificationFeedDeps = {}
): Promise<{ markedCount: number; unreadCount: number }> {
  const repository = deps.repository ?? notificationsRepository;
  try {
    const result = await repository.markAllRead(participantId);
    return { markedCount: result.markedCount, unreadCount: result.unreadCount };
  } catch (err) {
    throw toFeedError(err) ?? err;
  }
}
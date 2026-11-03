import { getSupabaseClient } from './client.js';
import type { NotificationCategory } from './notificationModel.js';
import type { ParticipantNotification } from './types.js';

export interface CreateNotificationDTO {
  participant_id: string;
  type: string;
  message: string;
  team_id?: string | null;
  event_id?: string | null;
  request_id?: string | null;
  submission_id?: string | null;
}

export interface INotificationsRepository {
  create(data: CreateNotificationDTO): Promise<ParticipantNotification>;
  countUnread(participantId: string): Promise<number>;
}

/** Keyset position for newest-first paging (created_at DESC, id DESC). */
export interface NotificationCursor {
  createdAt: string;
  id: string;
}

export interface ListNotificationsOptions {
  limit: number;
  cursor?: NotificationCursor | null;
  unreadOnly?: boolean;
  category?: NotificationCategory | null;
}

export interface MarkNotificationReadResult {
  notification: ParticipantNotification;
  alreadyRead: boolean;
  unreadCount: number;
}

export interface MarkAllNotificationsReadResult {
  markedCount: number;
  unreadCount: number;
}

/** US-021 / #199 feed and read-state operations (kept separate from the #198 producer interface). */
export interface INotificationFeedRepository {
  listForParticipant(
    participantId: string,
    options: ListNotificationsOptions
  ): Promise<ParticipantNotification[]>;
  markRead(participantId: string, notificationId: string): Promise<MarkNotificationReadResult>;
  markAllRead(participantId: string): Promise<MarkAllNotificationsReadResult>;
}

/**
 * US-021 / #198. `category` is never written here: the database derives it from
 * `type` (migration 0044 trigger), so producers cannot drift from the mapping.
 */
export const notificationsRepository: INotificationsRepository & INotificationFeedRepository = {
  async listForParticipant(participantId, options) {
    const client = getSupabaseClient();
    let query = client
      .from('participant_notifications')
      .select('*')
      .eq('participant_id', participantId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(options.limit);

    if (options.unreadOnly) query = query.is('read_at', null);
    if (options.category) query = query.eq('category', options.category);
    if (options.cursor) {
      // Cursor parts are format-validated upstream; quoted so '+' / ':' are literal.
      const { createdAt, id } = options.cursor;
      query = query.or(
        `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt.${id})`
      );
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as ParticipantNotification[];
  },

  async markRead(participantId, notificationId) {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('mark_participant_notification_read', {
      p_participant: participantId,
      p_notification: notificationId,
    });
    if (error) throw error;
    return data as MarkNotificationReadResult;
  },

  async markAllRead(participantId) {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('mark_all_participant_notifications_read', {
      p_participant: participantId,
    });
    if (error) throw error;
    return data as MarkAllNotificationsReadResult;
  },

  async create(data: CreateNotificationDTO): Promise<ParticipantNotification> {
    const client = getSupabaseClient();
    const { data: record, error } = await client
      .from('participant_notifications')
      .insert({
        participant_id: data.participant_id,
        type: data.type,
        message: data.message,
        team_id: data.team_id ?? null,
        event_id: data.event_id ?? null,
        request_id: data.request_id ?? null,
        submission_id: data.submission_id ?? null,
      })
      .select('*')
      .single();

    if (error) throw error;
    return record as ParticipantNotification;
  },

  async countUnread(participantId: string): Promise<number> {
    const client = getSupabaseClient();
    const { count, error } = await client
      .from('participant_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('participant_id', participantId)
      .is('read_at', null);

    if (error) throw error;
    return count ?? 0;
  },
};

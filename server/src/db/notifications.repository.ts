import { getSupabaseClient } from './client.js';
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

/**
 * US-021 / #198. `category` is never written here: the database derives it from
 * `type` (migration 0044 trigger), so producers cannot drift from the mapping.
 */
export const notificationsRepository: INotificationsRepository = {
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

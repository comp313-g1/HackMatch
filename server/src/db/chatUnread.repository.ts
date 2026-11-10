import { getSupabaseClient } from './client.js';

export type StoredChatConversationType = 'channel' | 'direct_message';

export interface StoredChatUnreadCount {
  conversation_type: StoredChatConversationType;
  conversation_id: string;
  unread_count: number;
}

export interface IChatUnreadRepository {
  listForParticipant(participantId: string): Promise<StoredChatUnreadCount[]>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toStoredUnreadCount(value: unknown): StoredChatUnreadCount {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid chat unread-count row.');
  }

  const row = value as Record<string, unknown>;
  const type = row.conversation_type;
  const id = row.conversation_id;
  const count = typeof row.unread_count === 'number'
    ? row.unread_count
    : Number(row.unread_count);

  if (
    (type !== 'channel' && type !== 'direct_message') ||
    typeof id !== 'string' ||
    !UUID_PATTERN.test(id) ||
    !Number.isSafeInteger(count) ||
    count < 0
  ) {
    throw new Error('Invalid chat unread-count row.');
  }

  // Explicit allowlist: database joins can never leak message or participant fields.
  return {
    conversation_type: type,
    conversation_id: id,
    unread_count: count,
  };
}

export const chatUnreadRepository: IChatUnreadRepository = {
  async listForParticipant(participantId: string): Promise<StoredChatUnreadCount[]> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('get_participant_chat_unread_counts', {
      p_participant: participantId,
    });

    if (error) throw error;
    if (!Array.isArray(data)) {
      throw new Error('Invalid chat unread-count response.');
    }
    return data.map(toStoredUnreadCount);
  },
};

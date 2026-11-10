import { getSupabaseClient } from './client.js';
import type { StoredChatConversationType } from './chatUnread.repository.js';

export interface StoredChatReadResult {
  conversation_type: StoredChatConversationType;
  conversation_id: string;
  last_read_message_id: string;
  last_read_message_created_at: string;
  advanced: boolean;
  unread_count: number;
  unread_mention_count: number;
}

export interface MarkChatReadDTO {
  participantId: string;
  conversationType: StoredChatConversationType;
  conversationId: string;
  messageId: string;
}

export interface IChatReadRepository {
  markRead(input: MarkChatReadDTO): Promise<StoredChatReadResult>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeCount(value: unknown): number {
  const count = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Invalid chat mark-read response.');
  }
  return count;
}

function toStoredChatReadResult(value: unknown): StoredChatReadResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid chat mark-read response.');
  }

  const row = value as Record<string, unknown>;
  const type = row.conversation_type;
  const conversationId = row.conversation_id;
  const messageId = row.last_read_message_id;
  const createdAt = row.last_read_message_created_at;

  if (
    (type !== 'channel' && type !== 'direct_message') ||
    typeof conversationId !== 'string' ||
    !UUID_PATTERN.test(conversationId) ||
    typeof messageId !== 'string' ||
    !UUID_PATTERN.test(messageId) ||
    typeof createdAt !== 'string' ||
    !Number.isFinite(Date.parse(createdAt)) ||
    typeof row.advanced !== 'boolean'
  ) {
    throw new Error('Invalid chat mark-read response.');
  }

  // Explicit allowlist: no message body, profile, membership, or account data.
  return {
    conversation_type: type,
    conversation_id: conversationId,
    last_read_message_id: messageId,
    last_read_message_created_at: new Date(createdAt).toISOString(),
    advanced: row.advanced,
    unread_count: normalizeCount(row.unread_count),
    unread_mention_count: normalizeCount(row.unread_mention_count),
  };
}

export const chatReadRepository: IChatReadRepository = {
  async markRead(input: MarkChatReadDTO): Promise<StoredChatReadResult> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('mark_chat_conversation_read', {
      p_participant: input.participantId,
      p_conversation_type: input.conversationType,
      p_conversation: input.conversationId,
      p_message: input.messageId,
    });

    if (error) throw error;
    if (!Array.isArray(data) || data.length !== 1) {
      throw new Error('Invalid chat mark-read response.');
    }
    return toStoredChatReadResult(data[0]);
  },
};

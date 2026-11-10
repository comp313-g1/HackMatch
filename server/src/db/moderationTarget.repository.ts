import { getSupabaseClient } from './client.js';

type ChatModerationTable = 'chat_channels' | 'chat_messages';

/** Exact allowlisted columns used to build ADMIN moderation evidence (#394). */
export interface ChatChannelModerationEvidenceRecord {
  id: string;
  title: string;
  description: string;
  created_by: string;
  channel_type: 'public' | 'team';
  created_at: string;
}

/** Exact allowlisted columns used to build ADMIN moderation evidence (#394). */
export interface ChatMessageModerationEvidenceRecord {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface IModerationTargetRepository {
  chatChannelExists(id: string): Promise<boolean>;
  chatMessageExists(id: string): Promise<boolean>;
  findChatChannelEvidence(id: string): Promise<ChatChannelModerationEvidenceRecord | null>;
  findChatMessageEvidence(id: string): Promise<ChatMessageModerationEvidenceRecord | null>;
}

/**
 * Resolves only target identity for US-033 / #392.
 *
 * Selecting `id` alone is intentional: target validation must not retrieve a
 * private message body, channel metadata, authors, or membership information.
 * Privacy-safe evidence belongs to #394.
 */
async function chatTargetExists(table: ChatModerationTable, id: string): Promise<boolean> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(table)
    .select('id')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export const moderationTargetRepository: IModerationTargetRepository = {
  chatChannelExists(id: string): Promise<boolean> {
    return chatTargetExists('chat_channels', id);
  },

  chatMessageExists(id: string): Promise<boolean> {
    return chatTargetExists('chat_messages', id);
  },

  async findChatChannelEvidence(
    id: string
  ): Promise<ChatChannelModerationEvidenceRecord | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('chat_channels')
      .select('id, title, description, created_by, channel_type, created_at')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data as ChatChannelModerationEvidenceRecord | null;
  },

  async findChatMessageEvidence(
    id: string
  ): Promise<ChatMessageModerationEvidenceRecord | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('chat_messages')
      .select('id, author_id, body, created_at')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data as ChatMessageModerationEvidenceRecord | null;
  },
};

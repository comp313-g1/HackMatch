import { getSupabaseClient } from './client.js';

type ChatModerationTable = 'chat_channels' | 'chat_messages';

export interface IModerationTargetRepository {
  chatChannelExists(id: string): Promise<boolean>;
  chatMessageExists(id: string): Promise<boolean>;
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
};

import { getSupabaseClient } from './client.js';
import type {
  ChatChannel,
  ChatMessage,
  CreateChatChannelDTO,
  CreateChatMessageDTO,
} from './types.js';

export interface ListChatChannelsOptions {
  limit?: number;
}

export interface ListChatMessagesOptions {
  limit?: number;
}

export interface IChatRepository {
  createChannel(data: CreateChatChannelDTO): Promise<ChatChannel>;
  findChannelById(id: string): Promise<ChatChannel | null>;
  listChannelsNewestFirst(options?: ListChatChannelsOptions): Promise<ChatChannel[]>;
  createMessage(data: CreateChatMessageDTO): Promise<ChatMessage>;
  findMessageById(id: string): Promise<ChatMessage | null>;
  listMessagesByChannel(
    channelId: string,
    options?: ListChatMessagesOptions
  ): Promise<ChatMessage[]>;
}

const DEFAULT_CHANNEL_LIMIT = 100;
const DEFAULT_MESSAGE_LIMIT = 200;
const MAX_LIMIT = 500;

export const chatRepository: IChatRepository = {
  async createChannel(data: CreateChatChannelDTO): Promise<ChatChannel> {
    const client = getSupabaseClient();
    const { data: record, error } = await client
      .from('chat_channels')
      .insert({
        title: data.title,
        description: data.description,
        created_by: data.created_by,
      })
      .select('*')
      .single();

    if (error) throw error;
    return record as ChatChannel;
  },

  async findChannelById(id: string): Promise<ChatChannel | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('chat_channels')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data as ChatChannel | null;
  },

  async listChannelsNewestFirst(
    options: ListChatChannelsOptions = {}
  ): Promise<ChatChannel[]> {
    const client = getSupabaseClient();
    const limit = Math.min(
      Math.max(1, options.limit ?? DEFAULT_CHANNEL_LIMIT),
      MAX_LIMIT
    );

    const { data, error } = await client
      .from('chat_channels')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data || []) as ChatChannel[];
  },

  async createMessage(data: CreateChatMessageDTO): Promise<ChatMessage> {
    const client = getSupabaseClient();
    const { data: record, error } = await client
      .from('chat_messages')
      .insert({
        channel_id: data.channel_id,
        author_id: data.author_id,
        body: data.body,
      })
      .select('*')
      .single();

    if (error) throw error;
    return record as ChatMessage;
  },

  async findMessageById(id: string): Promise<ChatMessage | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('chat_messages')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data as ChatMessage | null;
  },

  async listMessagesByChannel(
    channelId: string,
    options: ListChatMessagesOptions = {}
  ): Promise<ChatMessage[]> {
    const client = getSupabaseClient();
    const limit = Math.min(
      Math.max(1, options.limit ?? DEFAULT_MESSAGE_LIMIT),
      MAX_LIMIT
    );

    const { data, error } = await client
      .from('chat_messages')
      .select('*')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw error;
    return (data || []) as ChatMessage[];
  },
};

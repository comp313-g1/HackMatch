import { getSupabaseClient } from './client.js';
import type {
  ChatChannel,
  ChatMessage,
  CreateChatChannelDTO,
  CreateChatMessageDTO,
  ProvisionTeamChannelDTO,
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
  /** US-031 / #378: the private channel linked to a team, if any (served by uq_chat_channels_team_id). */
  findChannelByTeamId(teamId: string): Promise<ChatChannel | null>;
  /** #431: ids of teams that are not disbanded and have no private channel yet (for the backfill). */
  listTeamIdsNeedingChannel(): Promise<string[]>;
  /** US-031 / #378 / T2: Idempotently provision or link a private team chat channel. */
  provisionOrLinkTeamChannel(
    data: ProvisionTeamChannelDTO
  ): Promise<{ channel: ChatChannel; created: boolean }>;
  /** Public (US-030) forums only: private team channels are never listed here. */
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

  async findChannelByTeamId(teamId: string): Promise<ChatChannel | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('chat_channels')
      .select('*')
      .eq('team_id', teamId)
      .maybeSingle();

    if (error) throw error;
    return data as ChatChannel | null;
  },

  async listTeamIdsNeedingChannel(): Promise<string[]> {
    const client = getSupabaseClient();
    const PAGE = 1000;

    const readAll = async (
      table: 'teams' | 'chat_channels',
      column: string,
      filter: (q: any) => any // eslint-disable-line @typescript-eslint/no-explicit-any
    ): Promise<string[]> => {
      const ids: string[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await filter(client.from(table).select(column)).range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as Array<Record<string, string>>;
        ids.push(...rows.map((r) => r[column]));
        if (rows.length < PAGE) return ids;
      }
    };

    const activeTeamIds = await readAll('teams', 'id', (q) =>
      q.is('disbanded_at', null).neq('recruitment_status', 'Disbanded').order('id')
    );
    const linkedTeamIds = new Set(
      await readAll('chat_channels', 'team_id', (q) => q.not('team_id', 'is', null).order('team_id'))
    );
    return activeTeamIds.filter((id) => !linkedTeamIds.has(id));
  },

  async provisionOrLinkTeamChannel(
    data: ProvisionTeamChannelDTO
  ): Promise<{ channel: ChatChannel; created: boolean }> {
    const existing = await this.findChannelByTeamId(data.team_id);
    if (existing) {
      return { channel: existing, created: false };
    }

    const client = getSupabaseClient();
    try {
      const { data: record, error } = await client
        .from('chat_channels')
        .insert({
          channel_type: 'team',
          team_id: data.team_id,
          title: data.title,
          description: data.description,
          created_by: data.created_by,
        })
        .select('*')
        .single();

      if (!error && record) {
        return { channel: record as ChatChannel, created: true };
      }

      const errCode = (error as { code?: string } | null)?.code;
      const errMsg = (error as { message?: string } | null)?.message ?? '';
      if (errCode === '23505' || /duplicate key|unique/i.test(errMsg)) {
        const linked = await this.findChannelByTeamId(data.team_id);
        if (linked) {
          return { channel: linked, created: false };
        }
      }

      if (error) {
        throw error;
      }
    } catch (err: unknown) {
      const errCode = (err as { code?: string } | null)?.code;
      const errMsg = (err as { message?: string } | null)?.message ?? '';
      if (errCode === '23505' || /duplicate key|unique/i.test(errMsg)) {
        const linked = await this.findChannelByTeamId(data.team_id);
        if (linked) {
          return { channel: linked, created: false };
        }
      }
      throw err;
    }

    const linked = await this.findChannelByTeamId(data.team_id);
    if (linked) {
      return { channel: linked, created: false };
    }
    throw new Error('Failed to provision or link team channel.');
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
      .eq('channel_type', 'public')
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

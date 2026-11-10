import { getSupabaseClient } from './client.js';

/** US-032 / #386: a one-to-one thread, stored with its two participants in canonical order. */
export interface DirectMessageThread {
  id: string;
  participant_low_id: string;
  participant_high_id: string;
  /** Added by 0055 for deterministic recent-activity inbox ordering. */
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

/** US-032 / #387: direct-message text record (PostgreSQL). */
export interface DirectMessage {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface CreateDirectMessageDTO {
  thread_id: string;
  author_id: string;
  body: string;
}

export interface ListDirectMessageThreadsOptions {
  limit?: number;
}

export interface ListDirectMessagesOptions {
  limit?: number;
}

/** US-032 / #385 persisted text message belonging to one direct-message thread. */
export interface DirectMessage {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

/**
 * Orders a pair canonically (lower id first, as PostgreSQL orders uuid values), so (A,B) and
 * (B,A) always address the same row. Returns null when both ids are the same participant.
 */
export function canonicalParticipantPair(
  a: string,
  b: string
): { low: string; high: string } | null {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return null;
  return x < y ? { low: x, high: y } : { low: y, high: x };
}

/**
 * True only when `participantId` is one of the two participants on `thread`.
 */
export function isDirectMessageParticipant(
  thread: Pick<DirectMessageThread, 'participant_low_id' | 'participant_high_id'> | null | undefined,
  participantId: string | null | undefined
): boolean {
  if (!thread || !participantId) return false;
  const normalized = participantId.trim().toLowerCase();
  if (!normalized) return false;
  return (
    thread.participant_low_id.toLowerCase() === normalized ||
    thread.participant_high_id.toLowerCase() === normalized
  );
}

/**
 * Resolves the other participant's ID in a two-participant DM thread for `viewerId`.
 * Returns null if `viewerId` is not a participant in `thread`.
 */
export function getPeerParticipantId(
  thread: Pick<DirectMessageThread, 'participant_low_id' | 'participant_high_id'> | null | undefined,
  viewerId: string | null | undefined
): string | null {
  if (!thread || !viewerId) return null;
  const normalized = viewerId.trim().toLowerCase();
  if (thread.participant_low_id.toLowerCase() === normalized) {
    return thread.participant_high_id;
  }
  if (thread.participant_high_id.toLowerCase() === normalized) {
    return thread.participant_low_id;
  }
  return null;
}

export interface IDirectMessageRepository {
  findThreadById(threadId: string): Promise<DirectMessageThread | null>;
  findThreadByPair(low: string, high: string): Promise<DirectMessageThread | null>;
  /** Returns the existing thread for the pair, or creates it. Safe under concurrent calls. */
  findOrCreateThread(
    low: string,
    high: string
  ): Promise<{ thread: DirectMessageThread; created: boolean }>;
  listThreadsForParticipant(
    participantId: string,
    options?: ListDirectMessageThreadsOptions
  ): Promise<DirectMessageThread[]>;
  listMessagesByThread(
    threadId: string,
    options?: ListDirectMessagesOptions
  ): Promise<DirectMessage[]>;
  findLatestMessagesForThreads(
    threadIds: string[]
  ): Promise<Map<string, DirectMessage>>;
  createMessage(data: CreateDirectMessageDTO): Promise<DirectMessage>;
  isParticipantPairBlocked(
    participantAId: string,
    participantBId: string
  ): Promise<boolean>;
}

const DEFAULT_THREAD_LIMIT = 100;
const DEFAULT_MESSAGE_LIMIT = 200;
const MAX_LIMIT = 500;

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  const message = (err as { message?: string } | null)?.message ?? '';
  return code === '23505' || /duplicate key|unique/i.test(message);
}

export const directMessageRepository: IDirectMessageRepository = {
  async findThreadById(threadId: string): Promise<DirectMessageThread | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('direct_message_threads')
      .select('*')
      .eq('id', threadId)
      .maybeSingle();

    if (error) throw error;
    return (data as DirectMessageThread | null) ?? null;
  },

  async findThreadByPair(low, high) {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('direct_message_threads')
      .select('*')
      .eq('participant_low_id', low)
      .eq('participant_high_id', high)
      .maybeSingle();

    if (error) throw error;
    return data as DirectMessageThread | null;
  },

  async findOrCreateThread(low, high) {
    const existing = await this.findThreadByPair(low, high);
    if (existing) return { thread: existing, created: false };

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('direct_message_threads')
      .insert({ participant_low_id: low, participant_high_id: high })
      .select('*')
      .single();

    if (!error && data) return { thread: data as DirectMessageThread, created: true };

    // A concurrent request created it first: resolve to that row instead of failing.
    if (isUniqueViolation(error)) {
      const winner = await this.findThreadByPair(low, high);
      if (winner) return { thread: winner, created: false };
    }
    throw error ?? new Error('Could not create the direct-message thread.');
  },

  async listThreadsForParticipant(
    participantId: string,
    options: ListDirectMessageThreadsOptions = {}
  ): Promise<DirectMessageThread[]> {
    const client = getSupabaseClient();
    const limit = Math.min(
      Math.max(1, options.limit ?? DEFAULT_THREAD_LIMIT),
      MAX_LIMIT
    );
    const pid = participantId.trim().toLowerCase();

    const { data, error } = await client
      .from('direct_message_threads')
      .select('*')
      .or(`participant_low_id.eq.${pid},participant_high_id.eq.${pid}`)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return ((data ?? []) as DirectMessageThread[]).slice(0, limit);
  },

  async listMessagesByThread(
    threadId: string,
    options: ListDirectMessagesOptions = {}
  ): Promise<DirectMessage[]> {
    const client = getSupabaseClient();
    const limit = Math.min(
      Math.max(1, options.limit ?? DEFAULT_MESSAGE_LIMIT),
      MAX_LIMIT
    );

    const { data, error } = await client
      .from('direct_messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw error;
    return (data ?? []) as DirectMessage[];
  },

  async findLatestMessagesForThreads(
    threadIds: string[]
  ): Promise<Map<string, DirectMessage>> {
    const uniqueIds = [...new Set(threadIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('direct_messages')
      .select('*')
      .in('thread_id', uniqueIds)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const latestByThread = new Map<string, DirectMessage>();
    for (const row of (data ?? []) as DirectMessage[]) {
      if (!latestByThread.has(row.thread_id)) {
        latestByThread.set(row.thread_id, row);
      }
    }
    return latestByThread;
  },

  async createMessage(data: CreateDirectMessageDTO): Promise<DirectMessage> {
    const client = getSupabaseClient();
    const { data: record, error } = await client
      .from('direct_messages')
      .insert({
        thread_id: data.thread_id,
        author_id: data.author_id,
        body: data.body,
      })
      .select('*')
      .single();

    if (error) throw error;
    return record as DirectMessage;
  },

  async isParticipantPairBlocked(
    participantAId: string,
    participantBId: string
  ): Promise<boolean> {
    const pair = canonicalParticipantPair(participantAId, participantBId);
    if (!pair) return false;

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('participant_blocks')
      .select('blocker_id, blocked_id')
      .or(
        `and(blocker_id.eq.${pair.low},blocked_id.eq.${pair.high}),and(blocker_id.eq.${pair.high},blocked_id.eq.${pair.low})`
      )
      .limit(1);

    if (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === '42P01' || code === 'PGRST205') {
        return false;
      }
      throw error;
    }

    return Array.isArray(data) && data.length > 0;
  },
};

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

export interface IDirectMessageRepository {
  findThreadByPair(low: string, high: string): Promise<DirectMessageThread | null>;
  /** Returns the existing thread for the pair, or creates it. Safe under concurrent calls. */
  findOrCreateThread(
    low: string,
    high: string
  ): Promise<{ thread: DirectMessageThread; created: boolean }>;
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  const message = (err as { message?: string } | null)?.message ?? '';
  return code === '23505' || /duplicate key|unique/i.test(message);
}

export const directMessageRepository: IDirectMessageRepository = {
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
};

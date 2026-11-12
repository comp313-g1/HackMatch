import { getSupabaseClient } from './client.js';
import { isChatReaction, type ChatReaction, type ChatReactionScope } from './chatReactionModel.js';

/**
 * US-035 / #405 — reaction persistence through the service-role functions of
 * migration 0067. Writes re-check conversation send rules inside PostgreSQL;
 * reads return per-message aggregates only (no reactor ids leave the database).
 */

export interface SetChatReactionDTO {
  scope: ChatReactionScope;
  participantId: string;
  /** Channel id (public or team) or direct-message thread id. */
  conversationId: string;
  messageId: string;
  reaction: ChatReaction;
  /** true = ensure present (add), false = ensure absent (remove). */
  present: boolean;
}

export interface StoredReactionSummaryRow {
  message_id: string;
  reaction: ChatReaction;
  reaction_count: number;
  reacted_by_me: boolean;
}

export interface IChatReactionRepository {
  /** Returns whether a row was actually inserted or deleted (false = idempotent no-op). */
  setReaction(input: SetChatReactionDTO): Promise<{ changed: boolean }>;
  summarize(input: {
    scope: ChatReactionScope;
    participantId: string;
    messageIds: string[];
  }): Promise<StoredReactionSummaryRow[]>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SET_FUNCTION: Record<ChatReactionScope, string> = {
  channel: 'set_chat_message_reaction',
  directMessage: 'set_direct_message_reaction',
};

const SUMMARY_FUNCTION: Record<ChatReactionScope, string> = {
  channel: 'summarize_chat_message_reactions',
  directMessage: 'summarize_direct_message_reactions',
};

const CONVERSATION_PARAM: Record<ChatReactionScope, string> = {
  channel: 'p_channel',
  directMessage: 'p_thread',
};

function invalidResponse(): Error {
  return new Error('Invalid chat reaction response.');
}

function toSummaryRow(value: unknown): StoredReactionSummaryRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse();
  const row = value as Record<string, unknown>;
  const count = typeof row.reaction_count === 'number' ? row.reaction_count : Number(row.reaction_count);
  if (
    typeof row.message_id !== 'string' ||
    !UUID_PATTERN.test(row.message_id) ||
    !isChatReaction(row.reaction) ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    typeof row.reacted_by_me !== 'boolean'
  ) {
    throw invalidResponse();
  }
  // Explicit allowlist: nothing else from the row is carried forward.
  return {
    message_id: row.message_id.toLowerCase(),
    reaction: row.reaction,
    reaction_count: count,
    reacted_by_me: row.reacted_by_me,
  };
}

export const chatReactionRepository: IChatReactionRepository = {
  async setReaction(input: SetChatReactionDTO): Promise<{ changed: boolean }> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc(SET_FUNCTION[input.scope], {
      p_participant: input.participantId,
      [CONVERSATION_PARAM[input.scope]]: input.conversationId,
      p_message: input.messageId,
      p_reaction: input.reaction,
      p_present: input.present,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    const changed = (row as { changed?: unknown } | null | undefined)?.changed;
    if (typeof changed !== 'boolean') throw invalidResponse();
    return { changed };
  },

  async summarize(input): Promise<StoredReactionSummaryRow[]> {
    if (input.messageIds.length === 0) return [];
    const client = getSupabaseClient();
    const { data, error } = await client.rpc(SUMMARY_FUNCTION[input.scope], {
      p_participant: input.participantId,
      p_messages: input.messageIds,
    });
    if (error) throw error;
    if (!Array.isArray(data)) throw invalidResponse();
    return data.map(toSummaryRow);
  },
};

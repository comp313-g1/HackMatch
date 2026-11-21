import { config } from '../config/index.js';
import {
  chatReactionRepository,
  type IChatReactionRepository,
} from '../db/chatReaction.repository.js';
import {
  compareChatReactions,
  type ChatReactionScope,
  type ChatReactionSummary,
} from '../db/chatReactionModel.js';

/**
 * US-035 / #405 — reaction aggregates for message lists and responses.
 *
 * Kept separate from the mutation service so the US-030/031/032 message
 * services can attach summaries without an import cycle. All lookups are
 * batched: one query per message list, never one per message.
 */

/** Server-authoritative flag (#404 section 8). Read per request so tests can toggle it. */
export function isChatReactionsEnabled(): boolean {
  return config.richChat.reactionsEnabled === true;
}

/**
 * Aggregates per message id, in the approved reaction order. Every requested id
 * is present in the result (an empty array when it has no reactions).
 */
export async function summarizeChatReactions(
  input: { scope: ChatReactionScope; participantId: string; messageIds: string[] },
  repository: IChatReactionRepository = chatReactionRepository
): Promise<Map<string, ChatReactionSummary[]>> {
  const ids = [...new Set(input.messageIds.map((id) => id.toLowerCase()))];
  const result = new Map<string, ChatReactionSummary[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return result;

  const rows = await repository.summarize({
    scope: input.scope,
    participantId: input.participantId,
    messageIds: ids,
  });
  for (const row of rows) {
    const list = result.get(row.message_id);
    if (!list) continue; // never return data for a message the caller did not ask about
    list.push({ reaction: row.reaction, count: row.reaction_count, reactedByMe: row.reacted_by_me });
  }
  for (const list of result.values()) list.sort((a, b) => compareChatReactions(a.reaction, b.reaction));
  return result;
}

/**
 * Adds `reactions` to already-authorized message views when the feature is on.
 * When it is off the views are returned unchanged (no `reactions` field), so
 * existing text-chat responses are byte-for-byte what they were before #405.
 */
export async function withChatReactionSummaries<T extends { id: string }>(
  scope: ChatReactionScope,
  viewerId: string | undefined,
  views: T[]
): Promise<Array<T & { reactions?: ChatReactionSummary[] }>> {
  if (!isChatReactionsEnabled() || !viewerId || views.length === 0) return views;
  const summaries = await summarizeChatReactions({
    scope,
    participantId: viewerId,
    messageIds: views.map((view) => view.id),
  });
  return views.map((view) => ({ ...view, reactions: summaries.get(view.id.toLowerCase()) ?? [] }));
}

/** A newly sent message has no reactions yet; mark that explicitly when the feature is on. */
export function withEmptyChatReactions<T extends object>(view: T): T & { reactions?: ChatReactionSummary[] } {
  return isChatReactionsEnabled() ? { ...view, reactions: [] } : view;
}

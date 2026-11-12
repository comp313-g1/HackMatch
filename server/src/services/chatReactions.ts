import { chatRepository } from '../db/chat.repository.js';
import { isPublicChatChannel } from '../db/chatModel.js';
import {
  chatReactionRepository,
  type IChatReactionRepository,
} from '../db/chatReaction.repository.js';
import type { ChatReaction, ChatReactionScope, ChatReactionSummary } from '../db/chatReactionModel.js';
import type { Participant } from '../db/types.js';
import { ChatServiceError, mapTeamChannelWriteError } from './chat.js';
import { summarizeChatReactions } from './chatReactionSummaries.js';
import { mapDirectMessageWriteError } from './directMessages.js';

/**
 * US-035 / #405 — idempotent add/remove of message reactions.
 *
 * Callers are routes that already ran the conversation's own guard chain
 * (public channel, confirmed team member, or DM send access). The database
 * function re-checks the same send rules at write time, so a race with a
 * membership, block, or account change still cannot produce a reaction.
 * The reactor is always the authenticated participant passed in by the route.
 */

export interface ChatReactionMutationInput {
  participant: Participant;
  messageId: string;
  reaction: ChatReaction;
  /** true = add (ensure present), false = remove (ensure absent). */
  present: boolean;
}

export interface ChatReactionMutationView {
  messageId: string;
  reaction: ChatReaction;
  /** The caller's final state for this reaction, read back from the database. */
  reactedByMe: boolean;
  /** false when the request was an idempotent no-op (already present / already absent). */
  changed: boolean;
  /** Current aggregate for the whole message, in the approved order. */
  reactions: ChatReactionSummary[];
}

const MESSAGE_NOT_FOUND = () => new ChatServiceError(404, 'MESSAGE_NOT_FOUND', 'Chat message not found.');

/** Maps 0067 function errors onto the answers each conversation type already uses. */
export function mapChatReactionStorageError(err: unknown, scope: ChatReactionScope): ChatServiceError | null {
  const record = (err ?? {}) as { message?: unknown; code?: unknown };
  const text = String(record.message ?? '');

  if (text.includes('CHAT_REACTION_INVALID') || text.includes('CHAT_REACTION_VALIDATION_ERROR')) {
    return new ChatServiceError(400, 'VALIDATION_ERROR', 'Validation failed.');
  }
  // A message deleted between the check and the insert (foreign-key violation) is just "not found".
  if (text.includes('CHAT_REACTION_MESSAGE_NOT_FOUND') || record.code === '23503') {
    return MESSAGE_NOT_FOUND();
  }
  if (text.includes('CHAT_REACTION_NOT_ELIGIBLE')) {
    return new ChatServiceError(403, 'CHAT_REACTION_NOT_ELIGIBLE', 'Your account cannot react in chat.');
  }
  return scope === 'directMessage' ? mapDirectMessageWriteError(err) : mapTeamChannelWriteError(err);
}

async function applyReaction(
  scope: ChatReactionScope,
  conversationId: string,
  input: ChatReactionMutationInput,
  repository: IChatReactionRepository
): Promise<ChatReactionMutationView> {
  const participantId = input.participant.id;
  const messageId = input.messageId.trim().toLowerCase();

  let changed: boolean;
  try {
    ({ changed } = await repository.setReaction({
      scope,
      participantId,
      conversationId,
      messageId,
      reaction: input.reaction,
      present: input.present,
    }));
  } catch (err) {
    throw mapChatReactionStorageError(err, scope) ?? err;
  }

  // The response reflects stored state, not the request, so a retry can never invert it.
  const summaries = await summarizeChatReactions({ scope, participantId, messageIds: [messageId] }, repository);
  const reactions = summaries.get(messageId) ?? [];
  return {
    messageId,
    reaction: input.reaction,
    reactedByMe: reactions.some((entry) => entry.reaction === input.reaction && entry.reactedByMe),
    changed,
    reactions,
  };
}

/** Public forum message. A private team channel id is treated exactly like a missing channel. */
export async function setPublicChannelMessageReaction(
  input: ChatReactionMutationInput & { channelId: string },
  repository: IChatReactionRepository = chatReactionRepository
): Promise<ChatReactionMutationView> {
  const channelId = input.channelId.trim().toLowerCase();
  const channel = await chatRepository.findChannelById(channelId);
  if (!channel || !isPublicChatChannel(channel)) {
    throw new ChatServiceError(404, 'CHANNEL_NOT_FOUND', 'Chat channel not found.');
  }
  return applyReaction('channel', channel.id, input, repository);
}

/**
 * Team channel message. The caller already passed requireConfirmedTeamMember.
 * Unlike opening the chat, reacting never provisions a missing channel.
 */
export async function setTeamChannelMessageReaction(
  input: ChatReactionMutationInput & { teamId: string },
  repository: IChatReactionRepository = chatReactionRepository
): Promise<ChatReactionMutationView> {
  const teamId = input.teamId.trim().toLowerCase();
  const channel = await chatRepository.findChannelByTeamId(teamId);
  if (!channel || channel.channel_type !== 'team' || channel.team_id?.toLowerCase() !== teamId) {
    throw new ChatServiceError(404, 'TEAM_CHANNEL_NOT_FOUND', 'Team channel not found.');
  }
  return applyReaction('channel', channel.id, input, repository);
}

/** Direct message. The caller already passed requireDirectThreadSendAccess (blocks included). */
export async function setDirectMessageReaction(
  input: ChatReactionMutationInput & { threadId: string },
  repository: IChatReactionRepository = chatReactionRepository
): Promise<ChatReactionMutationView> {
  return applyReaction('directMessage', input.threadId.trim().toLowerCase(), input, repository);
}

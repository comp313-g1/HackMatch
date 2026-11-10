import { chatRepository } from '../db/chat.repository.js';
import {
  chatReadRepository,
  type IChatReadRepository,
  type StoredChatReadResult,
} from '../db/chatRead.repository.js';
import { isPublicChatChannel } from '../db/chatModel.js';
import type { Participant } from '../db/types.js';
import { authorizeDirectThreadAccess } from './directMessageAccess.js';
import { ChatServiceError } from './chat.js';
import { isEligibleDirectMessageParticipant } from './directMessageAccess.js';
import {
  authorizeConfirmedTeamChatMember,
  TeamChatAuthorizationError,
} from './teamChatAuthorization.js';
import type { ChatUnreadConversationType } from './chatUnread.js';

export interface MarkChatConversationReadInput {
  conversationType: ChatUnreadConversationType;
  conversationId: string;
  messageId: string;
}

export interface ChatReadCursorView {
  messageId: string;
  createdAt: string;
}

export interface MarkChatConversationReadResult {
  conversationType: ChatUnreadConversationType;
  conversationId: string;
  readCursor: ChatReadCursorView;
  advanced: boolean;
  unreadCount: number;
  unreadMentionCount: number;
}

export interface ChatReadServiceDeps {
  repository?: IChatReadRepository;
  authorize?: (
    participant: Participant,
    input: MarkChatConversationReadInput
  ) => Promise<void>;
}

/** Reuses the current US-030/031/032 read authorization before the atomic RPC. */
export async function authorizeChatConversationRead(
  participant: Participant,
  input: MarkChatConversationReadInput
): Promise<void> {
  if (input.conversationType === 'directMessage') {
    await authorizeDirectThreadAccess({
      caller: participant,
      threadId: input.conversationId,
    });
    return;
  }

  const channel = await chatRepository.findChannelById(input.conversationId);
  if (!channel) {
    throw new ChatServiceError(404, 'CHANNEL_NOT_FOUND', 'Chat channel not found.');
  }
  if (isPublicChatChannel(channel)) return;

  try {
    await authorizeConfirmedTeamChatMember({
      actorParticipantId: participant.id,
      channelId: input.conversationId,
    });
  } catch (error) {
    if (error instanceof TeamChatAuthorizationError) {
      throw new ChatServiceError(error.status, error.code, error.message);
    }
    throw error;
  }
}

function mapMarkReadStorageError(error: unknown): ChatServiceError | null {
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  if (message.includes('CHAT_MARK_READ_NOT_ELIGIBLE')) {
    return new ChatServiceError(
      403,
      'CHAT_READ_NOT_ELIGIBLE',
      'Your account cannot update chat read state.'
    );
  }
  if (message.includes('CHAT_MARK_READ_CHANNEL_NOT_FOUND')) {
    return new ChatServiceError(404, 'CHANNEL_NOT_FOUND', 'Chat channel not found.');
  }
  if (message.includes('CHAT_MARK_READ_TEAM_ACCESS_DENIED')) {
    return new ChatServiceError(
      403,
      'TEAM_CHAT_ACCESS_DENIED',
      'You do not have permission to access this team chat.'
    );
  }
  if (message.includes('CHAT_MARK_READ_ACCESS_CHANGED')) {
    return new ChatServiceError(
      403,
      'CHAT_READ_ACCESS_CHANGED',
      'Conversation access changed. Refresh and try again.'
    );
  }
  if (message.includes('CHAT_MARK_READ_DM_ACCESS_DENIED')) {
    return new ChatServiceError(
      403,
      'FORBIDDEN_NOT_THREAD_PARTICIPANT',
      'You do not have access to this conversation.'
    );
  }
  if (message.includes('CHAT_MARK_READ_POSITION_NOT_FOUND')) {
    return new ChatServiceError(
      404,
      'CHAT_READ_POSITION_NOT_FOUND',
      'The requested read position is unavailable.'
    );
  }
  if (message.includes('CHAT_MARK_READ_VALIDATION_ERROR')) {
    return new ChatServiceError(400, 'VALIDATION_ERROR', 'Validation failed.');
  }
  return null;
}

function toResult(row: StoredChatReadResult): MarkChatConversationReadResult {
  return {
    conversationType: row.conversation_type === 'channel' ? 'channel' : 'directMessage',
    conversationId: row.conversation_id,
    readCursor: {
      messageId: row.last_read_message_id,
      createdAt: row.last_read_message_created_at,
    },
    advanced: row.advanced,
    unreadCount: row.unread_count,
    unreadMentionCount: row.unread_mention_count,
  };
}

export async function markChatConversationRead(
  participant: Participant,
  input: MarkChatConversationReadInput,
  deps: ChatReadServiceDeps = {}
): Promise<MarkChatConversationReadResult> {
  if (!isEligibleDirectMessageParticipant(participant)) {
    throw new ChatServiceError(
      403,
      'CHAT_READ_NOT_ELIGIBLE',
      'Your account cannot update chat read state.'
    );
  }

  await (deps.authorize ?? authorizeChatConversationRead)(participant, input);
  const repository = deps.repository ?? chatReadRepository;

  try {
    return toResult(
      await repository.markRead({
        participantId: participant.id,
        conversationType:
          input.conversationType === 'channel' ? 'channel' : 'direct_message',
        conversationId: input.conversationId,
        messageId: input.messageId,
      })
    );
  } catch (error) {
    throw mapMarkReadStorageError(error) ?? error;
  }
}

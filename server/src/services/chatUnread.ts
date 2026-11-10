import {
  chatUnreadRepository,
  type IChatUnreadRepository,
  type StoredChatUnreadCount,
} from '../db/chatUnread.repository.js';
import type { Participant } from '../db/types.js';
import { isEligibleDirectMessageParticipant } from './directMessageAccess.js';
import { ChatServiceError } from './chat.js';

export type ChatUnreadConversationType = 'channel' | 'directMessage';

export interface ChatUnreadCountView {
  conversationType: ChatUnreadConversationType;
  conversationId: string;
  unreadCount: number;
}

export interface ParticipantChatUnreadSummary {
  counts: ChatUnreadCountView[];
  totalUnreadCount: number;
}

export interface ChatUnreadServiceDeps {
  repository?: IChatUnreadRepository;
}

function toUnreadCountView(row: StoredChatUnreadCount): ChatUnreadCountView {
  return {
    conversationType: row.conversation_type === 'channel' ? 'channel' : 'directMessage',
    conversationId: row.conversation_id,
    unreadCount: row.unread_count,
  };
}

/**
 * US-034 / #399 — counts only, for conversations authorized by the set-based
 * database query. Notification rows remain independent from this chat summary.
 */
export async function getParticipantChatUnreadSummary(
  participant: Participant,
  deps: ChatUnreadServiceDeps = {}
): Promise<ParticipantChatUnreadSummary> {
  // US-030/031/032 share this exact verified, active PART eligibility rule.
  if (!isEligibleDirectMessageParticipant(participant)) {
    throw new ChatServiceError(
      403,
      'CHAT_UNREAD_NOT_ELIGIBLE',
      'Your account cannot access chat unread counts.'
    );
  }

  const repository = deps.repository ?? chatUnreadRepository;
  const stored = await repository.listForParticipant(participant.id);
  const counts = stored.map(toUnreadCountView);
  const totalUnreadCount = counts.reduce((total, item) => total + item.unreadCount, 0);

  if (!Number.isSafeInteger(totalUnreadCount)) {
    throw new Error('Chat unread total exceeds the supported range.');
  }

  return { counts, totalUnreadCount };
}

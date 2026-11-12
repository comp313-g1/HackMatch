import { CHAT_REACTIONS, type ChatReaction } from '../db/chatReactionModel.js';
import { isChatReactionsEnabled } from './chatReactionSummaries.js';
import { isChatTypingEnabled } from './chatTyping.js';

/**
 * US-035 / #405 — what rich-chat features this server currently offers
 * (#404 policy, section 8). The browser uses it only to show or hide controls;
 * every rich-chat route still checks its own flag on the server.
 *
 * Typing follows RICH_CHAT_TYPING_ENABLED (#407). Attachments are not implemented
 * yet, so they are reported off unconditionally. Voice/video has no flag and is
 * always false.
 */
export interface RichChatCapabilities {
  reactions: { enabled: true; allowedReactions: ChatReaction[] } | { enabled: false };
  typing: { enabled: boolean };
  attachments: { enabled: false };
  voiceVideo: false;
}

export function getRichChatCapabilities(): RichChatCapabilities {
  return {
    reactions: isChatReactionsEnabled()
      ? { enabled: true, allowedReactions: [...CHAT_REACTIONS] }
      : { enabled: false },
    typing: { enabled: isChatTypingEnabled() },
    attachments: { enabled: false },
    voiceVideo: false,
  };
}

import { CHAT_REACTIONS, type ChatReaction } from '../db/chatReactionModel.js';
import { isChatReactionsEnabled } from './chatReactionSummaries.js';
import { isChatTypingEnabled } from './chatTyping.js';
import { areAttachmentsUsable } from './attachmentScanPolicy.js';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MIME_TYPES,
  ATTACHMENTS_PER_MESSAGE_MAX,
  type AttachmentMimeType,
} from '../db/chatAttachmentModel.js';

/**
 * US-035 / #405 — what rich-chat features this server currently offers
 * (#404 policy, section 8). The browser uses it only to show or hide controls;
 * every rich-chat route still checks its own flag on the server.
 *
 * Typing follows RICH_CHAT_TYPING_ENABLED (#407). Attachments (#409) are reported
 * as ACTUALLY usable: RICH_CHAT_ATTACHMENTS_ENABLED and the malware policy gate (no
 * scanner exists, so never under NODE_ENV=production). Voice/video has no flag and
 * is always false.
 */
export interface RichChatCapabilities {
  reactions: { enabled: true; allowedReactions: ChatReaction[] } | { enabled: false };
  typing: { enabled: boolean };
  attachments:
    | {
        enabled: true;
        maxBytes: number;
        maxPerMessage: number;
        allowedTypes: AttachmentMimeType[];
        /** No malware scanner exists: every file is "Not scanned for malware". */
        malwareScanning: 'not_available';
      }
    | { enabled: false };
  voiceVideo: false;
}

export function getRichChatCapabilities(): RichChatCapabilities {
  return {
    reactions: isChatReactionsEnabled()
      ? { enabled: true, allowedReactions: [...CHAT_REACTIONS] }
      : { enabled: false },
    typing: { enabled: isChatTypingEnabled() },
    attachments: areAttachmentsUsable()
      ? {
          enabled: true,
          maxBytes: ATTACHMENT_MAX_BYTES,
          maxPerMessage: ATTACHMENTS_PER_MESSAGE_MAX,
          allowedTypes: [...ATTACHMENT_MIME_TYPES],
          malwareScanning: 'not_available',
        }
      : { enabled: false },
    voiceVideo: false,
  };
}

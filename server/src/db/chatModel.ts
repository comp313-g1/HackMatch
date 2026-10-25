/**
 * US-030 / #342 chat channel and message model contract (PostgreSQL).
 *
 * Source of truth: migration 0041_create_chat_channel_message_models.sql.
 * Express validation and privacy scrubbing ship in later US-030 tasks.
 */

export const CHAT_CHANNEL_TITLE_MAX_LENGTH = 120;
export const CHAT_CHANNEL_DESCRIPTION_MAX_LENGTH = 2000;
export const CHAT_MESSAGE_BODY_MAX_LENGTH = 4000;

export interface ChatChannelModelFields {
  id: string;
  title: string;
  description: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageModelFields {
  id: string;
  channelId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

/** Trim; empty / whitespace-only → null (callers treat null as invalid). */
export function normalizeChatTitle(title: string | null | undefined): string | null {
  if (title == null) return null;
  const trimmed = title.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function normalizeChatDescription(
  description: string | null | undefined
): string | null {
  if (description == null) return null;
  const trimmed = description.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function normalizeChatMessageBody(
  body: string | null | undefined
): string | null {
  if (body == null) return null;
  const trimmed = body.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function isChatTitleTooLong(title: string | null | undefined): boolean {
  const normalized = normalizeChatTitle(title);
  return normalized != null && normalized.length > CHAT_CHANNEL_TITLE_MAX_LENGTH;
}

export function isChatDescriptionTooLong(
  description: string | null | undefined
): boolean {
  const normalized = normalizeChatDescription(description);
  return (
    normalized != null && normalized.length > CHAT_CHANNEL_DESCRIPTION_MAX_LENGTH
  );
}

export function isChatMessageBodyTooLong(body: string | null | undefined): boolean {
  const normalized = normalizeChatMessageBody(body);
  return normalized != null && normalized.length > CHAT_MESSAGE_BODY_MAX_LENGTH;
}

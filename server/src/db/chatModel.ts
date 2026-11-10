/**
 * US-030 / #342 chat channel and message model contract (PostgreSQL).
 *
 * Source of truth: migration 0041_create_chat_channel_message_models.sql.
 * Express validation and privacy scrubbing ship in later US-030 tasks.
 */

export const CHAT_CHANNEL_TITLE_MAX_LENGTH = 120;
export const CHAT_CHANNEL_DESCRIPTION_MAX_LENGTH = 2000;
export const CHAT_MESSAGE_BODY_MAX_LENGTH = 4000;

/** US-031 / #378: 'public' = US-030 platform forum; 'team' = private channel tied to one team. */
export const CHAT_CHANNEL_TYPES = ['public', 'team'] as const;
export type ChatChannelType = (typeof CHAT_CHANNEL_TYPES)[number];

export interface ChatChannelModelFields {
  id: string;
  title: string;
  description: string;
  createdBy: string;
  channelType: ChatChannelType;
  /** The team a private channel belongs to; null for public channels. */
  teamId: string | null;
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

export function isChatChannelType(value: unknown): value is ChatChannelType {
  return typeof value === 'string' && (CHAT_CHANNEL_TYPES as readonly string[]).includes(value);
}

export type ChatChannelLinkageError =
  | 'INVALID_CHANNEL_TYPE'
  | 'TEAM_ID_REQUIRED'
  | 'TEAM_ID_NOT_ALLOWED'
  | 'INVALID_TEAM_ID';

const TEAM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Mirrors the database rule chk_chat_channels_team_linkage (migration 0051): a 'team' channel
 * needs a team id, a 'public' channel must not have one. Returns null when the pair is valid,
 * otherwise a stable error code, so callers can refuse before ever reaching the database.
 */
export function validateChatChannelLinkage(input: {
  channelType: unknown;
  teamId?: string | null;
}): ChatChannelLinkageError | null {
  if (!isChatChannelType(input.channelType)) return 'INVALID_CHANNEL_TYPE';
  const hasTeam = input.teamId !== undefined && input.teamId !== null;
  if (input.channelType === 'public') return hasTeam ? 'TEAM_ID_NOT_ALLOWED' : null;
  if (!hasTeam) return 'TEAM_ID_REQUIRED';
  return typeof input.teamId === 'string' && TEAM_ID_PATTERN.test(input.teamId) ? null : 'INVALID_TEAM_ID';
}

/**
 * True only for a US-030 public channel. Fails closed: a row without an explicit 'public'
 * channel_type is not treated as public, so a private channel can never be served by the
 * public chat endpoints.
 */
export function isPublicChatChannel(channel: { channel_type?: unknown }): boolean {
  return channel.channel_type === 'public';
}

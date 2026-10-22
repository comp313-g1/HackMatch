import { chatRepository } from '../db/chat.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import type { ChatChannel, ChatMessage } from '../db/types.js';

/**
 * Safe channel payload (US-030 / #344 / FR-087, FR-089).
 * Never includes email, credentials, OTPs, or firebase_uid.
 */
export interface ChatChannelView {
  id: string;
  title: string;
  description: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Safe message payload (US-030 / #344 / FR-088, FR-089).
 * Author is exposed as handle only — never email.
 */
export interface ChatMessageView {
  id: string;
  channelId: string;
  authorId: string;
  authorHandle: string | null;
  body: string;
  createdAt: string;
}

export class ChatServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ChatServiceError';
    this.status = status;
    this.code = code;
  }
}

export function toChannelView(channel: ChatChannel): ChatChannelView {
  return {
    id: channel.id,
    title: channel.title,
    description: channel.description,
    createdBy: channel.created_by,
    createdAt: channel.created_at,
    updatedAt: channel.updated_at,
  };
}

export function toMessageView(
  message: ChatMessage,
  authorHandle: string | null
): ChatMessageView {
  return {
    id: message.id,
    channelId: message.channel_id,
    authorId: message.author_id,
    authorHandle,
    body: message.body,
    createdAt: message.created_at,
  };
}

async function resolveAuthorHandles(
  authorIds: string[]
): Promise<Map<string, string | null>> {
  const unique = [...new Set(authorIds)];
  const entries = await Promise.all(
    unique.map(async (id) => {
      const profile = await profileRepository.findProfileByParticipantId(id);
      return [id, profile?.handle ?? null] as const;
    })
  );
  return new Map(entries);
}

export async function listChannels(): Promise<ChatChannelView[]> {
  const channels = await chatRepository.listChannelsNewestFirst();
  return channels.map(toChannelView);
}

export async function createChannel(input: {
  title: string;
  description: string;
  createdBy: string;
}): Promise<ChatChannelView> {
  const channel = await chatRepository.createChannel({
    title: input.title,
    description: input.description,
    created_by: input.createdBy,
  });
  return toChannelView(channel);
}

export async function listChannelMessages(
  channelId: string
): Promise<ChatMessageView[]> {
  const channel = await chatRepository.findChannelById(channelId);
  if (!channel) {
    throw new ChatServiceError(404, 'CHANNEL_NOT_FOUND', 'Chat channel not found.');
  }

  const messages = await chatRepository.listMessagesByChannel(channelId);
  const handles = await resolveAuthorHandles(messages.map((m) => m.author_id));
  return messages.map((message) =>
    toMessageView(message, handles.get(message.author_id) ?? null)
  );
}

export async function sendChannelMessage(input: {
  channelId: string;
  authorId: string;
  body: string;
}): Promise<ChatMessageView> {
  const channel = await chatRepository.findChannelById(input.channelId);
  if (!channel) {
    throw new ChatServiceError(404, 'CHANNEL_NOT_FOUND', 'Chat channel not found.');
  }

  const message = await chatRepository.createMessage({
    channel_id: input.channelId,
    author_id: input.authorId,
    body: input.body,
  });

  const profile = await profileRepository.findProfileByParticipantId(input.authorId);
  return toMessageView(message, profile?.handle ?? null);
}

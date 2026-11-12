import { authFetch, AuthRequiredError } from '../../config/authFetch';
import {
  CHAT_REACTION_CODES,
  type ChatChannelView,
  type ChatFieldErrors,
  type ChatMessageView,
  type ChatPrivacyFlags,
  type ChatReactionCode,
  type ChatReactionMutationResult,
  type ChatReactionSummary,
  type ChatReactionTarget,
  type ChatUnreadSummary,
  type CreateChannelInput,
  type DirectMessageThreadDetail,
  type DirectMessageThreadView,
  type DirectMessageView,
  type PresenceStatus,
  type PresenceView,
  type MarkChatConversationReadInput,
  type MarkChatConversationReadResult,
  type RichChatCapabilities,
  type SendMessageInput,
  type TeamChatChannelView,
} from './chatTypes';

export { AuthRequiredError };

export class ChatApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly errors?: ChatFieldErrors,
    readonly submitted?: unknown,
    message?: string,
    /** US-035 / #406: seconds from a 429 Retry-After header (or body), when the server sent one. */
    readonly retryAfterSeconds?: number
  ) {
    super(message || code);
    this.name = 'ChatApiError';
  }
}

async function parseErrorBody(res: Response): Promise<{
  error?: string;
  code?: string;
  errors?: ChatFieldErrors;
  fieldErrors?: ChatFieldErrors;
  submitted?: unknown;
  retryAfterSeconds?: unknown;
}> {
  try {
    return (await res.json()) as {
      error?: string;
      code?: string;
      errors?: ChatFieldErrors;
      fieldErrors?: ChatFieldErrors;
      submitted?: unknown;
      retryAfterSeconds?: unknown;
    };
  } catch {
    return {};
  }
}

function parseRetryAfter(res: Response, body: { retryAfterSeconds?: unknown }): number | undefined {
  const header = Number(res.headers?.get?.('Retry-After') ?? NaN);
  if (Number.isFinite(header) && header > 0) return Math.ceil(header);
  const fromBody = Number(body.retryAfterSeconds);
  return Number.isFinite(fromBody) && fromBody > 0 ? Math.ceil(fromBody) : undefined;
}

function throwFromResponse(
  res: Response,
  body: Awaited<ReturnType<typeof parseErrorBody>>,
  fallbackSubmitted?: unknown
): never {
  throw new ChatApiError(
    res.status,
    body.code || 'UNKNOWN_ERROR',
    body.fieldErrors || body.errors,
    body.submitted ?? fallbackSubmitted,
    body.error || `Request failed with status ${res.status}`,
    res.status === 429 ? parseRetryAfter(res, body) : undefined
  );
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
  fallbackSubmitted?: unknown
): Promise<T> {
  let res: Response;
  try {
    res = await authFetch(path, init);
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new ChatApiError(
      0,
      'NETWORK',
      { _form: 'Network error. Please try again.' },
      fallbackSubmitted,
      'Network error. Please try again.'
    );
  }

  if (!res.ok) {
    const body = await parseErrorBody(res);
    throwFromResponse(res, body, fallbackSubmitted);
  }

  return (await res.json()) as T;
}

export async function fetchMyPresence(): Promise<PresenceView> {
  const data = await requestJson<{ presence: PresenceView }>('/api/presence/me', {
    method: 'GET',
  });
  return data.presence;
}

export async function updateMyPresence(
  presenceStatus: PresenceStatus
): Promise<PresenceView> {
  const payload = { presenceStatus };
  const data = await requestJson<{ presence: PresenceView }>(
    '/api/presence/me',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    payload
  );
  return data.presence;
}

export async function listChatChannels(): Promise<ChatChannelView[]> {
  const data = await requestJson<{
    channels: ChatChannelView[];
    privacy?: ChatPrivacyFlags;
  }>('/api/chat/channels', { method: 'GET' });
  return data.channels ?? [];
}

export async function createChatChannel(
  input: CreateChannelInput
): Promise<ChatChannelView> {
  const data = await requestJson<{ channel: ChatChannelView }>(
    '/api/chat/channels',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    input
  );
  return data.channel;
}

export async function listChatMessages(
  channelId: string
): Promise<ChatMessageView[]> {
  const data = await requestJson<{ messages: ChatMessageView[] }>(
    `/api/chat/channels/${encodeURIComponent(channelId)}/messages`,
    { method: 'GET' }
  );
  return data.messages ?? [];
}

export async function sendChatMessage(
  channelId: string,
  input: SendMessageInput
): Promise<ChatMessageView> {
  const data = await requestJson<{ message: ChatMessageView }>(
    `/api/chat/channels/${encodeURIComponent(channelId)}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    input
  );
  return data.message;
}

/** Opens the persisted private channel for one confirmed team member (US-031 / #381). */
export async function openTeamChat(teamId: string): Promise<TeamChatChannelView> {
  const data = await requestJson<{ channel: TeamChatChannelView }>(
    `/api/teams/${encodeURIComponent(teamId)}/chat`,
    { method: 'GET' }
  );
  if (
    !data.channel ||
    data.channel.channelType !== 'team' ||
    data.channel.teamId !== teamId
  ) {
    throw new ChatApiError(
      502,
      'INVALID_RESPONSE',
      { _form: 'The server returned an invalid team chat response.' },
      undefined,
      'Could not load team chat. Please try again.'
    );
  }
  return data.channel;
}

export async function listTeamChatMessages(
  teamId: string
): Promise<ChatMessageView[]> {
  const data = await requestJson<{ messages: ChatMessageView[] }>(
    `/api/teams/${encodeURIComponent(teamId)}/chat/messages`,
    { method: 'GET' }
  );
  if (!Array.isArray(data.messages)) {
    throw new ChatApiError(
      502,
      'INVALID_RESPONSE',
      { _form: 'The server returned an invalid team message response.' },
      undefined,
      'Could not load team messages. Please try again.'
    );
  }
  return data.messages;
}

export async function sendTeamChatMessage(
  teamId: string,
  input: SendMessageInput
): Promise<ChatMessageView> {
  const data = await requestJson<{ message: ChatMessageView }>(
    `/api/teams/${encodeURIComponent(teamId)}/chat/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    input
  );
  if (!data.message || data.message.channelId.length === 0) {
    throw new ChatApiError(
      502,
      'INVALID_RESPONSE',
      { _form: 'The server returned an invalid sent-message response.' },
      input,
      'Could not send message. Your draft has been kept.'
    );
  }
  return data.message;
}

/** Lists the authenticated participant's safe direct-message inbox (US-032 / #389). */
export async function listDirectMessageThreads(): Promise<DirectMessageThreadView[]> {
  const data = await requestJson<{
    threads: DirectMessageThreadView[];
    isEmpty: boolean;
  }>('/api/direct-messages/threads', { method: 'GET' });
  if (!Array.isArray(data.threads)) {
    throw new ChatApiError(
      502,
      'INVALID_RESPONSE',
      { _form: 'The server returned an invalid direct-message inbox.' },
      undefined,
      'Could not load direct messages. Please try again.'
    );
  }
  return data.threads;
}

/** Opens or continues the canonical thread for an eligible participant. */
export async function openDirectMessageThread(
  participantId: string
): Promise<DirectMessageThreadView> {
  const payload = { participantId };
  const data = await requestJson<{ thread: DirectMessageThreadView }>(
    '/api/direct-messages/threads',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    payload
  );
  if (!data.thread || !data.thread.id) {
    throw new ChatApiError(
      502,
      'INVALID_RESPONSE',
      { _form: 'The server returned an invalid direct-message thread.' },
      payload,
      'Could not open the direct-message conversation.'
    );
  }
  return data.thread;
}

/** Loads one authorized thread and its chronologically ordered messages. */
export async function getDirectMessageThread(
  threadId: string
): Promise<DirectMessageThreadDetail> {
  const data = await requestJson<DirectMessageThreadDetail>(
    `/api/direct-messages/threads/${encodeURIComponent(threadId)}`,
    { method: 'GET' }
  );
  if (!data.thread || data.thread.id !== threadId || !Array.isArray(data.messages)) {
    throw new ChatApiError(
      502,
      'INVALID_RESPONSE',
      { _form: 'The server returned an invalid direct-message thread.' },
      undefined,
      'Could not load this conversation. Please try again.'
    );
  }
  return data;
}

/** Sends a text message while retaining the submitted draft in any API error. */
export async function sendDirectMessage(
  threadId: string,
  input: SendMessageInput
): Promise<DirectMessageView> {
  const data = await requestJson<{ message: DirectMessageView }>(
    `/api/direct-messages/threads/${encodeURIComponent(threadId)}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    input
  );
  if (!data.message || data.message.threadId !== threadId) {
    throw new ChatApiError(
      502,
      'INVALID_RESPONSE',
      { _form: 'The server returned an invalid direct message.' },
      input,
      'Could not send message. Your draft has been kept.'
    );
  }
  return data.message;
}

async function changeDirectMessageBlock(participantId: string, method: 'PUT' | 'DELETE'): Promise<boolean> {
  const data = await requestJson<{ youBlockedPeer?: unknown }>(
    `/api/direct-messages/blocks/${encodeURIComponent(participantId)}`,
    { method }
  );
  if (typeof data.youBlockedPeer !== 'boolean') {
    throw new ChatApiError(
      502,
      'INVALID_RESPONSE',
      { _form: 'The server returned an invalid answer.' },
      undefined,
      method === 'PUT' ? 'Could not block this participant. Please try again.' : 'Could not unblock this participant. Please try again.'
    );
  }
  return data.youBlockedPeer;
}

/** #433: block a participant. Neither of you can send messages to the other until you unblock them. Resolves to true. */
export function blockDirectMessageParticipant(participantId: string): Promise<boolean> {
  return changeDirectMessageBlock(participantId, 'PUT');
}

/** #433: remove your block on a participant. Resolves to false (you no longer block them). */
export function unblockDirectMessageParticipant(participantId: string): Promise<boolean> {
  return changeDirectMessageBlock(participantId, 'DELETE');
}

/** Loads authoritative unread and mention counts for currently authorized conversations. */
export async function fetchChatUnreadSummary(): Promise<ChatUnreadSummary> {
  const data = await requestJson<ChatUnreadSummary>('/api/chat/unread-counts', {
    method: 'GET',
  });
  if (
    !Array.isArray(data.counts) ||
    !data.counts.every(
      (count) =>
        (count.conversationType === 'channel' ||
          count.conversationType === 'directMessage') &&
        typeof count.conversationId === 'string' &&
        count.conversationId.length > 0 &&
        Number.isSafeInteger(count.unreadCount) &&
        count.unreadCount >= 0 &&
        Number.isSafeInteger(count.unreadMentionCount) &&
        count.unreadMentionCount >= 0
    ) ||
    !Number.isSafeInteger(data.totalUnreadCount) ||
    data.totalUnreadCount < 0 ||
    !Number.isSafeInteger(data.totalUnreadMentionCount) ||
    data.totalUnreadMentionCount < 0
  ) {
    throw new ChatApiError(
      502,
      'INVALID_RESPONSE',
      { _form: 'The server returned invalid chat activity counts.' },
      undefined,
      'Could not load chat activity. Please try again.'
    );
  }
  return {
    counts: data.counts,
    totalUnreadCount: data.totalUnreadCount,
    totalUnreadMentionCount: data.totalUnreadMentionCount,
  };
}

/** Advances one authorized conversation cursor only after server confirmation. */
export async function markChatConversationRead(
  input: MarkChatConversationReadInput
): Promise<MarkChatConversationReadResult> {
  const data = await requestJson<MarkChatConversationReadResult>(
    '/api/chat/read',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    input
  );
  if (
    data.conversationType !== input.conversationType ||
    data.conversationId !== input.conversationId ||
    !data.readCursor?.messageId ||
    typeof data.readCursor.createdAt !== 'string' ||
    typeof data.advanced !== 'boolean' ||
    !Number.isSafeInteger(data.unreadCount) ||
    data.unreadCount < 0 ||
    !Number.isSafeInteger(data.unreadMentionCount) ||
    data.unreadMentionCount < 0
  ) {
    throw new ChatApiError(
      502,
      'INVALID_RESPONSE',
      { _form: 'The server returned an invalid read-state response.' },
      input,
      'Could not update chat read state. Your badges were not cleared.'
    );
  }
  return {
    conversationType: data.conversationType,
    conversationId: data.conversationId,
    readCursor: {
      messageId: data.readCursor.messageId,
      createdAt: data.readCursor.createdAt,
    },
    advanced: data.advanced,
    unreadCount: data.unreadCount,
    unreadMentionCount: data.unreadMentionCount,
  };
}

const REACTION_CODE_SET = new Set<string>(CHAT_REACTION_CODES);

function isReactionCode(value: unknown): value is ChatReactionCode {
  return typeof value === 'string' && REACTION_CODE_SET.has(value);
}

function invalidReactionResponse(message: string): ChatApiError {
  return new ChatApiError(502, 'INVALID_RESPONSE', { _form: message }, undefined, message);
}

/**
 * US-035 / #406: validates a server reaction aggregate and returns it in the approved order.
 * Only the safe fields are kept; anything unexpected (unknown code, bad count) is rejected
 * rather than rendered.
 */
export function normalizeReactionSummaries(value: unknown): ChatReactionSummary[] {
  if (!Array.isArray(value)) throw invalidReactionResponse('The server returned invalid reactions.');
  const seen = new Set<string>();
  const summaries = value.map((entry: unknown) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    if (
      !isReactionCode(row.reaction) ||
      seen.has(row.reaction) ||
      !Number.isSafeInteger(row.count) ||
      (row.count as number) < 1 ||
      typeof row.reactedByMe !== 'boolean'
    ) {
      throw invalidReactionResponse('The server returned invalid reactions.');
    }
    seen.add(row.reaction);
    return { reaction: row.reaction, count: row.count as number, reactedByMe: row.reactedByMe };
  });
  return summaries.sort(
    (a, b) => CHAT_REACTION_CODES.indexOf(a.reaction) - CHAT_REACTION_CODES.indexOf(b.reaction)
  );
}

/** Loads which rich-chat features the server offers. The server stays authoritative per route. */
export async function fetchChatCapabilities(): Promise<RichChatCapabilities> {
  const data = await requestJson<{ capabilities?: { reactions?: { enabled?: unknown; allowedReactions?: unknown } } }>(
    '/api/chat/capabilities',
    { method: 'GET' }
  );
  const reactions = data.capabilities?.reactions;
  const enabled = reactions?.enabled === true;
  const allowed = Array.isArray(reactions?.allowedReactions)
    ? CHAT_REACTION_CODES.filter((code) => (reactions!.allowedReactions as unknown[]).includes(code))
    : [];
  return {
    reactions: { enabled: enabled && allowed.length > 0, allowedReactions: enabled ? allowed : [] },
    // Not implemented yet (#407–#410); never reported as available by the client.
    typing: { enabled: false },
    attachments: { enabled: false },
    voiceVideo: false,
  };
}

function reactionPath(target: ChatReactionTarget, messageId: string, reaction: ChatReactionCode): string {
  const tail = `messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(reaction)}`;
  switch (target.kind) {
    case 'channel':
      return `/api/chat/channels/${encodeURIComponent(target.channelId)}/${tail}`;
    case 'team':
      return `/api/teams/${encodeURIComponent(target.teamId)}/chat/${tail}`;
    case 'directMessage':
      return `/api/direct-messages/threads/${encodeURIComponent(target.threadId)}/${tail}`;
  }
}

/**
 * US-035 / #406: add (`present: true`, PUT) or remove (`present: false`, DELETE) one of the
 * caller's reactions. Both are idempotent on the server. No body is sent: the server takes the
 * reactor from the authenticated session. Resolves to the stored aggregate for the message.
 */
export async function setChatMessageReaction(
  target: ChatReactionTarget,
  messageId: string,
  reaction: ChatReactionCode,
  present: boolean
): Promise<ChatReactionMutationResult> {
  const data = await requestJson<Record<string, unknown>>(reactionPath(target, messageId, reaction), {
    method: present ? 'PUT' : 'DELETE',
  });
  if (
    data.messageId !== messageId ||
    data.reaction !== reaction ||
    typeof data.reactedByMe !== 'boolean' ||
    typeof data.changed !== 'boolean'
  ) {
    throw invalidReactionResponse('The server returned an invalid reaction response.');
  }
  return {
    messageId,
    reaction,
    reactedByMe: data.reactedByMe,
    changed: data.changed,
    reactions: normalizeReactionSummaries(data.reactions),
  };
}

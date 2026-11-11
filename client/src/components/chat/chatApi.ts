import { authFetch, AuthRequiredError } from '../../config/authFetch';
import type {
  ChatChannelView,
  ChatFieldErrors,
  ChatMessageView,
  ChatPrivacyFlags,
  CreateChannelInput,
  DirectMessageThreadDetail,
  DirectMessageThreadView,
  DirectMessageView,
  PresenceStatus,
  PresenceView,
  SendMessageInput,
  TeamChatChannelView,
} from './chatTypes';

export { AuthRequiredError };

export class ChatApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly errors?: ChatFieldErrors,
    readonly submitted?: unknown,
    message?: string
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
}> {
  try {
    return (await res.json()) as {
      error?: string;
      code?: string;
      errors?: ChatFieldErrors;
      fieldErrors?: ChatFieldErrors;
      submitted?: unknown;
    };
  } catch {
    return {};
  }
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
    body.error || `Request failed with status ${res.status}`
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

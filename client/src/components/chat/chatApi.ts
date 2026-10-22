import { authFetch, AuthRequiredError } from '../../config/authFetch';
import type {
  ChatChannelView,
  ChatFieldErrors,
  ChatMessageView,
  ChatPrivacyFlags,
  CreateChannelInput,
  PresenceStatus,
  PresenceView,
  SendMessageInput,
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

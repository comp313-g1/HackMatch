import { authFetch, AuthRequiredError } from '../../config/authFetch';
import {
  CHAT_ATTACHMENT_MIME_TYPES,
  CHAT_ATTACHMENT_SCAN_STATUSES,
  CHAT_REACTION_CODES,
  DEFAULT_CHAT_ATTACHMENT_LIMITS,
  type ChatAttachmentAccessView,
  type ChatAttachmentLimits,
  type ChatAttachmentMimeType,
  type ChatAttachmentScanStatus,
  type ChatAttachmentStatus,
  type ChatAttachmentView,
  type ChatChannelView,
  type ChatFieldErrors,
  type ChatMessageView,
  type ChatPrivacyFlags,
  type ChatReactionCode,
  type ChatReactionMutationResult,
  type ChatReactionSummary,
  type ChatReactionTarget,
  type ChatConversationTarget,
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

function withNormalizedMessageAttachments<T extends { attachments?: unknown }>(message: T): T {
  if (message.attachments === undefined) return message;
  return { ...message, attachments: normalizeAttachmentViews(message.attachments) };
}

export async function listChatMessages(
  channelId: string
): Promise<ChatMessageView[]> {
  const data = await requestJson<{ messages: ChatMessageView[] }>(
    `/api/chat/channels/${encodeURIComponent(channelId)}/messages`,
    { method: 'GET' }
  );
  return (data.messages ?? []).map(withNormalizedMessageAttachments);
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
  return withNormalizedMessageAttachments(data.message);
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
  return data.messages.map(withNormalizedMessageAttachments);
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
  return withNormalizedMessageAttachments(data.message);
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
  return {
    ...data,
    messages: data.messages.map(withNormalizedMessageAttachments),
  };
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
  return withNormalizedMessageAttachments(data.message);
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

const ATTACHMENT_MIME_SET = new Set<string>(CHAT_ATTACHMENT_MIME_TYPES);
const ATTACHMENT_SCAN_STATUS_SET = new Set<string>(CHAT_ATTACHMENT_SCAN_STATUSES);

function isAttachmentMimeType(value: unknown): value is ChatAttachmentMimeType {
  return typeof value === 'string' && ATTACHMENT_MIME_SET.has(value);
}

function isAttachmentScanStatus(value: unknown): value is ChatAttachmentScanStatus {
  return typeof value === 'string' && ATTACHMENT_SCAN_STATUS_SET.has(value);
}

function isAttachmentStatus(value: unknown): value is ChatAttachmentStatus {
  return value === 'pending' || value === 'attached';
}

function invalidAttachmentResponse(message: string): ChatApiError {
  return new ChatApiError(502, 'INVALID_RESPONSE', { _form: message }, undefined, message);
}

function normalizeAttachmentEntry(entry: unknown): ChatAttachmentView {
  const row = (entry ?? {}) as Record<string, unknown>;
  if (
    typeof row.id !== 'string' ||
    row.id.trim().length === 0 ||
    typeof row.filename !== 'string' ||
    row.filename.trim().length === 0 ||
    row.filename.length > 255 ||
    !isAttachmentMimeType(row.mimeType) ||
    typeof row.sizeBytes !== 'number' ||
    !Number.isSafeInteger(row.sizeBytes) ||
    row.sizeBytes < 1 ||
    row.sizeBytes > DEFAULT_CHAT_ATTACHMENT_LIMITS.maxBytes ||
    !isAttachmentScanStatus(row.scanStatus) ||
    !isAttachmentStatus(row.status) ||
    typeof row.downloadable !== 'boolean'
  ) {
    throw invalidAttachmentResponse('The server returned invalid attachment metadata.');
  }

  return {
    id: row.id.trim(),
    filename: row.filename.trim(),
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    scanStatus: row.scanStatus,
    status: row.status,
    downloadable:
      row.downloadable &&
      row.status === 'attached' &&
      (row.scanStatus === 'not_scanned' || row.scanStatus === 'clean'),
  };
}

/**
 * US-035 / #410: validates attachment metadata from the server and keeps only safe
 * allowlisted fields (never storage keys, uploader ids, or raw URLs).
 */
export function normalizeAttachmentViews(value: unknown): ChatAttachmentView[] {
  if (!Array.isArray(value)) {
    throw invalidAttachmentResponse('The server returned invalid attachments.');
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    const normalized = normalizeAttachmentEntry(entry);
    if (seen.has(normalized.id)) {
      throw invalidAttachmentResponse('The server returned duplicate attachments.');
    }
    seen.add(normalized.id);
    return normalized;
  });
}

function parseAttachmentLimits(rawAttachments: Record<string, unknown> | undefined): ChatAttachmentLimits | undefined {
  if (!rawAttachments) return undefined;
  const source =
    rawAttachments.limits && typeof rawAttachments.limits === 'object'
      ? (rawAttachments.limits as Record<string, unknown>)
      : rawAttachments;

  const hasAnyLimit =
    Array.isArray(source.allowedTypes) ||
    typeof source.maxBytes === 'number' ||
    typeof source.maxPerMessage === 'number' ||
    source.malwareScanning === 'not_available';

  if (!hasAnyLimit) return undefined;

  const allowedTypes = Array.isArray(source.allowedTypes)
    ? CHAT_ATTACHMENT_MIME_TYPES.filter((mime) => (source.allowedTypes as unknown[]).includes(mime))
    : [...DEFAULT_CHAT_ATTACHMENT_LIMITS.allowedTypes];

  const positiveIntOrDefault = (candidate: unknown, fallback: number): number =>
    typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate > 0 ? candidate : fallback;

  return {
    allowedTypes: allowedTypes.length > 0 ? allowedTypes : [...DEFAULT_CHAT_ATTACHMENT_LIMITS.allowedTypes],
    maxBytes: positiveIntOrDefault(source.maxBytes, DEFAULT_CHAT_ATTACHMENT_LIMITS.maxBytes),
    maxPerMessage: positiveIntOrDefault(source.maxPerMessage, DEFAULT_CHAT_ATTACHMENT_LIMITS.maxPerMessage),
    malwareScanning: 'not_available',
  };
}

/** Loads which rich-chat features the server offers. The server stays authoritative per route. */
export async function fetchChatCapabilities(): Promise<RichChatCapabilities> {
  const data = await requestJson<{
    capabilities?: {
      reactions?: { enabled?: unknown; allowedReactions?: unknown };
      typing?: { enabled?: unknown };
      attachments?: Record<string, unknown>;
    };
  }>('/api/chat/capabilities', { method: 'GET' });
  const reactions = data.capabilities?.reactions;
  const enabled = reactions?.enabled === true;
  const allowed = Array.isArray(reactions?.allowedReactions)
    ? CHAT_REACTION_CODES.filter((code) => (reactions!.allowedReactions as unknown[]).includes(code))
    : [];
  const typing = data.capabilities?.typing;
  const rawAttachments = data.capabilities?.attachments;
  const attachmentsEnabled = rawAttachments?.enabled === true;
  const attachmentLimits = attachmentsEnabled ? parseAttachmentLimits(rawAttachments) : undefined;
  return {
    reactions: { enabled: enabled && allowed.length > 0, allowedReactions: enabled ? allowed : [] },
    // US-035 / #407–#408: straight from the server flag; only an exact true enables it.
    typing: { enabled: typing?.enabled === true },
    // US-035 / #409–#410: straight from the server flag; only an exact true enables it.
    attachments: attachmentsEnabled
      ? attachmentLimits
        ? { enabled: true, limits: attachmentLimits }
        : { enabled: true }
      : { enabled: false },
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

/** US-035 / #408: the route segment for one conversation, shared by typing signals and streams. */
export function conversationBasePath(target: ChatConversationTarget): string {
  switch (target.kind) {
    case 'channel':
      return `/api/chat/channels/${encodeURIComponent(target.channelId)}`;
    case 'team':
      return `/api/teams/${encodeURIComponent(target.teamId)}/chat`;
    case 'directMessage':
      return `/api/direct-messages/threads/${encodeURIComponent(target.threadId)}`;
  }
}

export function conversationIdOf(target: ChatConversationTarget): string {
  return target.kind === 'channel' ? target.channelId : target.kind === 'team' ? target.teamId : target.threadId;
}

/**
 * US-035 / #408: tell the server the caller is typing (true) or stopped (false) in this
 * conversation. The body is exactly `{ typing }`: never draft text, message text, or any
 * identity. The server takes the typist from the session and may silently drop the signal
 * (for example when the caller's presence is Invisible).
 */
export async function signalChatTyping(target: ChatConversationTarget, typing: boolean): Promise<void> {
  await requestJson<unknown>(`${conversationBasePath(target)}/typing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ typing }),
  });
}

/**
 * US-035 / #410: upload one pending attachment to an authorized conversation using
 * multipart/form-data (`file` field, #409). Keeps only safe normalized metadata.
 */
export async function uploadChatAttachment(
  target: ChatConversationTarget,
  file: File
): Promise<ChatAttachmentView> {
  const form = new FormData();
  form.append('file', file, file.name);
  const data = await requestJson<Record<string, unknown>>(`${conversationBasePath(target)}/attachments`, {
    method: 'POST',
    body: form,
  });
  return normalizeAttachmentEntry(data.attachment ?? data);
}

/**
 * US-035 / #410: request a 60-second signed download link for an attached file (#409).
 * Re-checks conversation read access and scan state on the server.
 */
export async function requestChatAttachmentAccess(
  target: ChatConversationTarget,
  attachmentId: string
): Promise<ChatAttachmentAccessView> {
  const path = `${conversationBasePath(target)}/attachments/${encodeURIComponent(attachmentId)}/access`;
  const data = await requestJson<Record<string, unknown>>(path, { method: 'GET' });
  const raw = (data.access ?? data) as Record<string, unknown>;

  if (
    typeof raw.url !== 'string' ||
    !raw.url.startsWith('/api/chat/attachments/content') ||
    typeof raw.expiresAt !== 'string' ||
    raw.expiresAt.trim().length === 0
  ) {
    throw invalidAttachmentResponse('The server returned an invalid attachment download response.');
  }

  return {
    url: raw.url,
    expiresAt: raw.expiresAt,
  };
}

/**
 * US-035 / #410: fetch attachment bytes from the signed `/api/chat/attachments/content`
 * endpoint so URLs stay strictly on the API origin and expiry/access denials propagate.
 */
export async function fetchAttachmentContentBlob(accessUrl: string): Promise<Blob> {
  if (!accessUrl.startsWith('/api/chat/attachments/content')) {
    throw invalidAttachmentResponse('Refused non-API attachment download URL.');
  }
  let res: Response;
  try {
    res = await authFetch(accessUrl, { method: 'GET' });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new ChatApiError(
      0,
      'NETWORK',
      { _form: 'Network error. Please try again.' },
      undefined,
      'Network error. Please try again.'
    );
  }
  if (!res.ok) {
    const body = await parseErrorBody(res);
    throwFromResponse(res, body);
  }
  return await res.blob();
}

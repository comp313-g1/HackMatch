import type { DirectMessage, DirectMessageThread } from '../db/directMessage.repository.js';
import {
  chatPrivacyFlags,
  isPrivateChatKey,
  scrubPrivateChatFields,
  type ChatPrivacyFlags,
} from './chatPrivacy.js';

/**
 * US-032 / #390 / FR-089 bar — what a direct-message response may contain.
 *
 * Two layers:
 *  1. ALLOWLIST projections (`toDirectThreadView`, `toDirectMessageView`, ...). A field reaches a
 *     response only if it is named here; a new column on a table can never leak by accident.
 *  2. A SAFETY SCRUB (`scrubDirectMessageFields`) over the finished payload that drops any key
 *     that looks like credentials, OTPs, account email, internal ids, presence, contact data,
 *     account state, or block state, in case a future change adds one to a projection.
 *
 * A DM response never includes: passwords, OTPs/hashes, tokens, account email, full name,
 * firebase uid, the raw participant_low/high columns, presence status (an "Invisible" person
 * must not be exposed), shared contact handles, role / verification / suspension state, or any
 * block information.
 */

/** Keys that must never appear anywhere in a direct-message payload, on top of the chat list. */
const PRIVATE_DM_KEY_PATTERN =
  /^(presence([_-]?status)?|last[_-]?seen([_-]?at)?|online|full[_-]?name|first[_-]?name|last[_-]?name|institution|phone|phone[_-]?number|contact[_-]?handle|shared[_-]?contact[_-]?handle|contact([_-]?details)?|role|is[_-]?(verified|suspended|deactivated|admin)|suspended([_-]?(at|by))?|suspension[_-]?reason|deactivated([_-]?(at|by))?|deactivation[_-]?reason|participant[_-]?(low|high)[_-]?id|low[_-]?id|high[_-]?id|blocked([_-]?by([_-]?me|[_-]?them|[_-]?you)?)?|blocker([_-]?id)?|blocked[_-]?id|block[_-]?state|created[_-]?by)$/i;

export function isPrivateDirectMessageKey(key: string): boolean {
  return isPrivateChatKey(key) || PRIVATE_DM_KEY_PATTERN.test(key);
}

/** Recursively removes every private key (chat + direct-message specific) from a payload. */
export function scrubDirectMessageFields<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrubDirectMessageFields(item)) as T;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isPrivateDirectMessageKey(key)) continue;
    out[key] = scrubDirectMessageFields(child);
  }
  return out as T;
}

/** True when the payload still contains a private direct-message key (used by tests/contracts). */
export function directMessagePayloadHasPrivateKey(value: unknown): boolean {
  if (value === null || value === undefined || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => directMessagePayloadHasPrivateKey(v));
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => isPrivateDirectMessageKey(key) || directMessagePayloadHasPrivateKey(child)
  );
}

/** Canonical ISO-8601 UTC string (`...Z`) for a stored timestamp. */
export function toUtcIsoTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid timestamp value: ${String(value)}`);
  }
  return date.toISOString();
}

/** The other participant: public id (needed to open the thread) and display handle only. */
export interface DirectPeerView {
  id: string;
  handle: string | null;
}

export interface DirectThreadView {
  id: string;
  peer: DirectPeerView;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * #433: true when the VIEWER has blocked the other participant, so the screen can offer Unblock.
   * It only ever describes the viewer's own action. Whether the other person blocked the viewer is
   * never exposed. Present only on the single-conversation view.
   */
  youBlockedPeer?: boolean;
}

/**
 * One message. The author is shown by handle and a `fromMe` flag, not by account id, so the
 * client can align bubbles without being handed internal identifiers.
 */
export interface DirectMessageView {
  id: string;
  threadId: string;
  fromMe: boolean;
  authorHandle: string | null;
  body: string;
  createdAt: string;
}

export interface DirectInboxItemView extends DirectThreadView {
  /** Latest message, or null for an empty thread. */
  lastMessage: DirectMessageView | null;
}

export interface DirectMessagePrivacyFlags extends ChatPrivacyFlags {
  presenceIncluded: false;
  contactDetailsIncluded: false;
}

export const DIRECT_MESSAGE_PRIVACY_NOTICE =
  'Direct messages show participant handles only. Credentials, OTPs, account emails, presence, and contact details are never included.';

export function directMessagePrivacyFlags(): DirectMessagePrivacyFlags {
  return {
    ...chatPrivacyFlags(),
    presenceIncluded: false,
    contactDetailsIncluded: false,
    notice: DIRECT_MESSAGE_PRIVACY_NOTICE,
  };
}

function peerIdOf(thread: DirectMessageThread, callerId: string): string {
  const me = callerId.toLowerCase();
  return thread.participant_low_id.toLowerCase() === me ? thread.participant_high_id : thread.participant_low_id;
}

export function toDirectThreadView(
  thread: DirectMessageThread,
  callerId: string,
  peerHandle: string | null
): DirectThreadView {
  return scrubDirectMessageFields({
    id: thread.id,
    peer: { id: peerIdOf(thread, callerId), handle: peerHandle },
    lastMessageAt: thread.last_message_at ? toUtcIsoTimestamp(thread.last_message_at) : null,
    createdAt: toUtcIsoTimestamp(thread.created_at),
    updatedAt: toUtcIsoTimestamp(thread.updated_at),
  });
}

export function toDirectMessageView(
  message: DirectMessage,
  callerId: string,
  authorHandle: string | null
): DirectMessageView {
  return scrubDirectMessageFields({
    id: message.id,
    threadId: message.thread_id,
    fromMe: message.author_id.toLowerCase() === callerId.toLowerCase(),
    authorHandle,
    body: message.body,
    createdAt: toUtcIsoTimestamp(message.created_at),
  });
}

export function toDirectInboxItemView(
  thread: DirectMessageThread,
  callerId: string,
  peerHandle: string | null,
  lastMessage: { message: DirectMessage; authorHandle: string | null } | null,
  youBlockedPeer?: boolean
): DirectInboxItemView {
  return scrubDirectMessageFields({
    ...toDirectThreadView(thread, callerId, peerHandle),
    lastMessage: lastMessage ? toDirectMessageView(lastMessage.message, callerId, lastMessage.authorHandle) : null,
    ...(typeof youBlockedPeer === 'boolean' ? { youBlockedPeer } : {}),
  });
}

/** Wraps a successful DM response with the privacy flags and a final scrub. */
export function buildDirectMessageSuccessPayload<T extends Record<string, unknown>>(
  data: T
): T & { privacy: DirectMessagePrivacyFlags } {
  return {
    ...scrubDirectMessageFields(scrubPrivateChatFields(data)),
    privacy: directMessagePrivacyFlags(),
  };
}

/**
 * Safe echo of a rejected draft (NR-017). Private keys are redacted; only the message `body` and
 * `participantId` a client legitimately sends are kept as typed.
 */
export function sanitizeSubmittedDirectMessageDraft(body: unknown): unknown {
  if (body === null || body === undefined || typeof body !== 'object' || Array.isArray(body)) return body;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    out[key] = isPrivateDirectMessageKey(key) ? '[redacted]' : value;
  }
  return out;
}

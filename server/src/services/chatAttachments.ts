import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../config/index.js';
import { chatRepository } from '../db/chat.repository.js';
import { isPublicChatChannel } from '../db/chatModel.js';
import { chatAttachmentRepository, type StoredAttachment } from '../db/chatAttachment.repository.js';
import {
  ATTACHMENT_ACCESS_TTL_MS,
  ATTACHMENT_INLINE_TYPES,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_QUOTA_BYTES,
  ATTACHMENT_UPLOADS_PER_HOUR,
  detectAttachmentType,
  extensionMatchesType,
  sanitizeAttachmentDisplayName,
  type AttachmentMimeType,
  type AttachmentScope,
} from '../db/chatAttachmentModel.js';
import type { Participant } from '../db/types.js';
import { ChatServiceError } from './chat.js';
import { getAttachmentObjectStore } from './attachmentStorage.js';
import { areAttachmentsUsable, initialScanStatus, isScanStatusDownloadable } from './attachmentScanPolicy.js';
import { toAttachmentView, type ChatAttachmentView } from './chatAttachmentViews.js';
import {
  authorizeDirectMessageViewer,
  authorizePublicChannelViewer,
  authorizeTeamViewer,
} from './chatTypingAccess.js';

/**
 * US-035 / #409 — upload, download access, and storage maintenance for chat
 * attachments (#404 policy, sections 6–7).
 *
 * Route guard chains (the same ones the message routes use) authorize the caller
 * first: send access for uploads, read access for downloads. Byte content decides
 * the type; quota and the hourly limit are enforced under a database lock; bytes
 * go to private storage under an opaque key; and downloads go through a 60-second
 * server-signed token that re-checks the viewer's read access when used.
 */

export class AttachmentRateLimitError extends ChatServiceError {
  constructor(readonly retryAfterSeconds: number) {
    super(429, 'RATE_LIMITED', `You can upload at most ${ATTACHMENT_UPLOADS_PER_HOUR} files per hour.`);
    this.name = 'AttachmentRateLimitError';
  }
}

const notFound = () => new ChatServiceError(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found.');
const storageUnavailable = () =>
  new ChatServiceError(503, 'ATTACHMENT_STORAGE_UNAVAILABLE', 'File storage is not available right now. Please try again.');
const quotaExceeded = () =>
  new ChatServiceError(413, 'ATTACHMENT_QUOTA_EXCEEDED', 'You have used your 100 MB attachment storage.');

/** Where an upload or download belongs, after the route resolved and authorized it. */
export interface AttachmentConversation {
  scope: AttachmentScope;
  /** channel id (public or team channel) or DM thread id. */
  conversationId: string;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/** Cheap check before reading any bytes; the database re-checks under a lock. */
export async function precheckAttachmentUpload(participantId: string, declaredBytes: number | null): Promise<void> {
  const usage = await chatAttachmentRepository.usage(participantId);
  if (usage.uploadsLastHour >= ATTACHMENT_UPLOADS_PER_HOUR) {
    const oldest = usage.oldestUploadInWindow ? Date.parse(usage.oldestUploadInWindow) : Date.now();
    throw new AttachmentRateLimitError(Math.max(1, Math.ceil((oldest + 3_600_000 - Date.now()) / 1000)));
  }
  if (usage.storedBytes + Math.max(1, declaredBytes ?? 1) > ATTACHMENT_QUOTA_BYTES) throw quotaExceeded();
}

export async function uploadAttachment(input: {
  uploader: Participant;
  conversation: AttachmentConversation;
  rawFilename: string;
  bytes: Uint8Array;
}): Promise<ChatAttachmentView> {
  const filename = sanitizeAttachmentDisplayName(input.rawFilename);
  if (!filename) {
    throw new ChatServiceError(400, 'VALIDATION_ERROR', 'A file name is required.');
  }
  if (input.bytes.length === 0) {
    throw new ChatServiceError(400, 'VALIDATION_ERROR', 'The file is empty.');
  }
  if (input.bytes.length > ATTACHMENT_MAX_BYTES) {
    throw new ChatServiceError(413, 'ATTACHMENT_TOO_LARGE', 'Files can be at most 10 MB.');
  }
  const mimeType = detectAttachmentType(input.bytes);
  // Type comes from the bytes; the name's extension must agree with it.
  if (!mimeType || !extensionMatchesType(filename, mimeType)) {
    throw new ChatServiceError(
      415,
      'ATTACHMENT_TYPE_NOT_ALLOWED',
      'Only PNG, JPEG, GIF, WebP, PDF, and plain-text files are allowed, with a matching file extension.'
    );
  }

  const storageKey = randomUUID();
  const reservation = await chatAttachmentRepository.reserve({
    scope: input.conversation.scope,
    participantId: input.uploader.id,
    conversationId: input.conversation.conversationId,
    storageKey,
    displayName: filename,
    mimeType,
    sizeBytes: input.bytes.length,
    scanStatus: initialScanStatus(),
  });
  if (reservation.outcome === 'rate_limited') throw new AttachmentRateLimitError(reservation.retryAfterSeconds);
  if (reservation.outcome === 'quota_exceeded') throw quotaExceeded();

  const { attachmentId } = reservation;
  const discard = () =>
    chatAttachmentRepository
      .discardReservation(input.conversation.scope, attachmentId, input.uploader.id)
      .catch(() => undefined); // a stuck reservation expires after 15 minutes

  try {
    await getAttachmentObjectStore().put(storageKey, input.bytes, mimeType);
  } catch {
    await discard(); // the delete trigger queues the (possibly partial) object for removal
    throw storageUnavailable();
  }

  let completed = false;
  try {
    completed = await chatAttachmentRepository.markUploaded(input.conversation.scope, attachmentId, input.uploader.id);
  } catch {
    completed = false;
  }
  if (!completed) {
    await discard();
    throw storageUnavailable();
  }

  const stored = await chatAttachmentRepository.findById(input.conversation.scope, attachmentId);
  if (!stored) throw storageUnavailable();
  return toAttachmentView(stored);
}

// ---------------------------------------------------------------------------
// Download access (60-second server-signed token)
// ---------------------------------------------------------------------------

function accessKey(): Buffer {
  // Domain-separated from the session secret; never used for anything else.
  return createHmac('sha256', config.sessionSecret).update('hackmatch:chat-attachment-access:v1').digest();
}

function sign(payload: string): string {
  return createHmac('sha256', accessKey()).update(payload).digest('base64url');
}

interface AccessClaims {
  scope: AttachmentScope;
  attachmentId: string;
  viewerId: string;
  expiresAt: number;
}

/**
 * Called after the route's read guard passed. Only attached, downloadable files in
 * this exact conversation qualify; anything else is the same 404.
 */
export async function issueAttachmentAccess(input: {
  viewer: Participant;
  conversation: AttachmentConversation;
  attachmentId: string;
  now?: number;
}): Promise<{ url: string; expiresAt: string }> {
  const row = await chatAttachmentRepository.findInConversation(
    input.conversation.scope,
    input.attachmentId,
    input.conversation.conversationId
  );
  if (!row || row.status !== 'attached' || !row.message_id) throw notFound();
  if (!isScanStatusDownloadable(row.scan_status)) {
    throw new ChatServiceError(403, 'ATTACHMENT_NOT_DOWNLOADABLE', 'This file is not available for download.');
  }
  const expiresAt = (input.now ?? Date.now()) + ATTACHMENT_ACCESS_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ s: input.conversation.scope, a: row.id, v: input.viewer.id, e: expiresAt })
  ).toString('base64url');
  const token = `${payload}.${sign(payload)}`;
  return {
    url: `/api/chat/attachments/content?token=${encodeURIComponent(token)}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function verifyAttachmentAccessToken(token: unknown, now = Date.now()): AccessClaims | null {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (
      (claims.s !== 'channel' && claims.s !== 'directMessage') ||
      typeof claims.a !== 'string' ||
      typeof claims.v !== 'string' ||
      typeof claims.e !== 'number'
    ) {
      return null;
    }
    if (now >= claims.e) return null;
    return { scope: claims.s, attachmentId: claims.a, viewerId: claims.v, expiresAt: claims.e };
  } catch {
    return null;
  }
}

/** Re-checks, at download time, that the token's viewer can still read the conversation. */
async function viewerCanStillRead(row: StoredAttachment, scope: AttachmentScope, viewerId: string): Promise<boolean> {
  const viewer = { id: viewerId } as Participant;
  try {
    if (scope === 'directMessage') return await authorizeDirectMessageViewer(viewer, row.conversation_id).authorize();
    const channel = await chatRepository.findChannelById(row.conversation_id);
    if (!channel) return false;
    if (isPublicChatChannel(channel)) {
      return await (await authorizePublicChannelViewer(viewer, channel.id)).authorize();
    }
    if (!channel.team_id) return false;
    return await (await authorizeTeamViewer(viewer, channel.team_id)).authorize();
  } catch {
    return false;
  }
}

export interface AttachmentContent {
  bytes: Uint8Array;
  mimeType: AttachmentMimeType;
  filename: string;
  inline: boolean;
}

/** Serves bytes for a valid, unexpired token whose viewer can still read the conversation. */
export async function readAttachmentContent(token: unknown, now = Date.now()): Promise<AttachmentContent> {
  if (!areAttachmentsUsable()) throw notFound();
  const claims = verifyAttachmentAccessToken(token, now);
  if (!claims) throw notFound();
  const row = await chatAttachmentRepository.findById(claims.scope, claims.attachmentId);
  if (!row || row.status !== 'attached' || !isScanStatusDownloadable(row.scan_status)) throw notFound();
  if (!(await viewerCanStillRead(row, claims.scope, claims.viewerId))) throw notFound();
  let bytes: Uint8Array;
  try {
    bytes = await getAttachmentObjectStore().get(row.storage_key);
  } catch {
    throw storageUnavailable();
  }
  return { bytes, mimeType: row.mime_type, filename: row.display_name, inline: ATTACHMENT_INLINE_TYPES.has(row.mime_type) };
}

/** RFC 6266 / 5987 Content-Disposition with an ASCII fallback; no raw name reaches the header. */
export function contentDisposition(filename: string, inline: boolean): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%;]/g, '_').slice(0, 150) || 'attachment';
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// ---------------------------------------------------------------------------
// Maintenance: expire unsent uploads and delete queued storage objects
// ---------------------------------------------------------------------------

export interface AttachmentMaintenanceResult {
  expiredUploads: number;
  removedObjects: number;
  failedObjects: number;
}

/**
 * Bounded cleanup. Unsent uploads older than 24 h (or reservations stuck for
 * 15 min) are deleted; their delete trigger queues the storage objects, which are
 * then removed. A failed removal stays queued for the next run.
 */
export async function runAttachmentMaintenance(limit = 100): Promise<AttachmentMaintenanceResult> {
  const expiredUploads = await chatAttachmentRepository.expireStaleUploads(limit);
  const keys = await chatAttachmentRepository.listObjectDeletions(limit);
  if (keys.length === 0) return { expiredUploads, removedObjects: 0, failedObjects: 0 };
  try {
    await getAttachmentObjectStore().remove(keys);
    await chatAttachmentRepository.completeObjectDeletions(keys);
    return { expiredUploads, removedObjects: keys.length, failedObjects: 0 };
  } catch {
    await chatAttachmentRepository.noteObjectDeletionAttempt(keys).catch(() => undefined);
    return { expiredUploads, removedObjects: 0, failedObjects: keys.length };
  }
}

const MAINTENANCE_INTERVAL_MS = 5 * 60_000;
let lastMaintenanceAt = 0;

/** Opportunistic: at most once every 5 minutes per process, never blocking a request. */
export async function maybeRunAttachmentMaintenance(now = Date.now()): Promise<void> {
  if (now - lastMaintenanceAt < MAINTENANCE_INTERVAL_MS) return;
  lastMaintenanceAt = now;
  await runAttachmentMaintenance().catch(() => undefined);
}

export function _resetAttachmentMaintenanceClock(): void {
  lastMaintenanceAt = 0;
}

export { areAttachmentsUsable };

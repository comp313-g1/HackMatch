import { getSupabaseClient } from './client.js';
import type { ChatMessage } from './types.js';
import type { DirectMessage } from './directMessage.repository.js';
import {
  ATTACHMENT_MIME_TYPES,
  type AttachmentMimeType,
  type AttachmentScanStatus,
  type AttachmentScope,
  type AttachmentStatus,
} from './chatAttachmentModel.js';

/**
 * US-035 / #409 — attachment metadata through migration 0068. Quota, hourly
 * limit, and linking run inside service-role database functions so concurrent
 * requests cannot exceed them. Storage keys stay on the server.
 */

export interface StoredAttachment {
  id: string;
  uploader_id: string;
  conversation_id: string;
  message_id: string | null;
  storage_key: string;
  display_name: string;
  mime_type: AttachmentMimeType;
  size_bytes: number;
  status: AttachmentStatus;
  scan_status: AttachmentScanStatus;
  created_at: string;
  attached_at: string | null;
}

export interface AttachmentUsage {
  uploadsLastHour: number;
  oldestUploadInWindow: string | null;
  storedBytes: number;
}

export type ReservationOutcome =
  | { outcome: 'reserved'; attachmentId: string }
  | { outcome: 'rate_limited'; retryAfterSeconds: number }
  | { outcome: 'quota_exceeded' };

const TABLE: Record<AttachmentScope, string> = {
  channel: 'chat_message_attachments',
  directMessage: 'direct_message_attachments',
};
const CONVERSATION_COLUMN: Record<AttachmentScope, string> = {
  channel: 'channel_id',
  directMessage: 'thread_id',
};

function invalid(): Error {
  return new Error('Invalid chat attachment response.');
}

function toStored(scope: AttachmentScope, value: unknown): StoredAttachment {
  const row = (value ?? {}) as Record<string, unknown>;
  const conversation = row[CONVERSATION_COLUMN[scope]];
  if (
    typeof row.id !== 'string' ||
    typeof row.uploader_id !== 'string' ||
    typeof conversation !== 'string' ||
    typeof row.storage_key !== 'string' ||
    typeof row.display_name !== 'string' ||
    !(ATTACHMENT_MIME_TYPES as readonly string[]).includes(String(row.mime_type))
  ) {
    throw invalid();
  }
  return {
    id: row.id,
    uploader_id: row.uploader_id,
    conversation_id: conversation,
    message_id: typeof row.message_id === 'string' ? row.message_id : null,
    storage_key: row.storage_key,
    display_name: row.display_name,
    mime_type: row.mime_type as AttachmentMimeType,
    size_bytes: Number(row.size_bytes),
    status: row.status as AttachmentStatus,
    scan_status: row.scan_status as AttachmentScanStatus,
    created_at: String(row.created_at),
    attached_at: row.attached_at == null ? null : String(row.attached_at),
  };
}

export const chatAttachmentRepository = {
  async usage(participantId: string): Promise<AttachmentUsage> {
    const { data, error } = await getSupabaseClient().rpc('chat_attachment_usage', { p_participant: participantId });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    return {
      uploadsLastHour: Number(row?.uploads_last_hour ?? 0),
      oldestUploadInWindow: row?.oldest_upload_in_window ? String(row.oldest_upload_in_window) : null,
      storedBytes: Number(row?.stored_bytes ?? 0),
    };
  },

  async reserve(input: {
    scope: AttachmentScope;
    participantId: string;
    conversationId: string;
    storageKey: string;
    displayName: string;
    mimeType: AttachmentMimeType;
    sizeBytes: number;
    scanStatus: AttachmentScanStatus;
  }): Promise<ReservationOutcome> {
    const { data, error } = await getSupabaseClient().rpc('reserve_chat_attachment_upload', {
      p_participant: input.participantId,
      p_scope: input.scope === 'channel' ? 'channel' : 'direct_message',
      p_conversation: input.conversationId,
      p_storage_key: input.storageKey,
      p_display_name: input.displayName,
      p_mime_type: input.mimeType,
      p_size_bytes: input.sizeBytes,
      p_scan_status: input.scanStatus,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    if (row?.outcome === 'reserved' && typeof row.attachment_id === 'string') {
      return { outcome: 'reserved', attachmentId: row.attachment_id };
    }
    if (row?.outcome === 'rate_limited') {
      return { outcome: 'rate_limited', retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds) || 1) };
    }
    if (row?.outcome === 'quota_exceeded') return { outcome: 'quota_exceeded' };
    throw invalid();
  },

  /** 'uploading' → 'pending' once the object is stored. Only the uploader's own reservation. */
  async markUploaded(scope: AttachmentScope, attachmentId: string, participantId: string): Promise<boolean> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE[scope])
      .update({ status: 'pending' })
      .eq('id', attachmentId)
      .eq('uploader_id', participantId)
      .eq('status', 'uploading')
      .select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length === 1;
  },

  /** Drops a reservation whose upload failed; the delete trigger queues its object for removal. */
  async discardReservation(scope: AttachmentScope, attachmentId: string, participantId: string): Promise<void> {
    const { error } = await getSupabaseClient()
      .from(TABLE[scope])
      .delete()
      .eq('id', attachmentId)
      .eq('uploader_id', participantId)
      .eq('status', 'uploading');
    if (error) throw error;
  },

  async findInConversation(scope: AttachmentScope, attachmentId: string, conversationId: string): Promise<StoredAttachment | null> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE[scope])
      .select('*')
      .eq('id', attachmentId)
      .eq(CONVERSATION_COLUMN[scope], conversationId)
      .maybeSingle();
    if (error) throw error;
    return data ? toStored(scope, data) : null;
  },

  async findById(scope: AttachmentScope, attachmentId: string): Promise<StoredAttachment | null> {
    const { data, error } = await getSupabaseClient().from(TABLE[scope]).select('*').eq('id', attachmentId).maybeSingle();
    if (error) throw error;
    return data ? toStored(scope, data) : null;
  },

  async listAttachedForMessages(scope: AttachmentScope, messageIds: string[]): Promise<StoredAttachment[]> {
    if (messageIds.length === 0) return [];
    const { data, error } = await getSupabaseClient()
      .from(TABLE[scope])
      .select('*')
      .in('message_id', messageIds)
      .eq('status', 'attached')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row: unknown) => toStored(scope, row));
  },

  async sendChannelMessage(input: { participantId: string; channelId: string; body: string; attachmentIds: string[] }): Promise<ChatMessage> {
    const { data, error } = await getSupabaseClient().rpc('send_chat_message_with_attachments', {
      p_participant: input.participantId,
      p_channel: input.channelId,
      p_body: input.body,
      p_attachments: input.attachmentIds,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw invalid();
    return row as ChatMessage;
  },

  async sendDirectMessage(input: { participantId: string; threadId: string; body: string; attachmentIds: string[] }): Promise<DirectMessage> {
    const { data, error } = await getSupabaseClient().rpc('send_direct_message_with_attachments', {
      p_participant: input.participantId,
      p_thread: input.threadId,
      p_body: input.body,
      p_attachments: input.attachmentIds,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw invalid();
    return row as DirectMessage;
  },

  async expireStaleUploads(limit: number): Promise<number> {
    const { data, error } = await getSupabaseClient().rpc('expire_chat_attachment_uploads', { p_limit: limit });
    if (error) throw error;
    const value = Array.isArray(data) ? Object.values((data[0] ?? {}) as Record<string, unknown>)[0] : data;
    return Number(value ?? 0);
  },

  async listObjectDeletions(limit: number): Promise<string[]> {
    const { data, error } = await getSupabaseClient()
      .from('chat_attachment_object_deletions')
      .select('storage_key')
      .order('enqueued_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Array<{ storage_key: string }>).map((row) => row.storage_key);
  },

  async completeObjectDeletions(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const { error } = await getSupabaseClient().from('chat_attachment_object_deletions').delete().in('storage_key', keys);
    if (error) throw error;
  },

  async noteObjectDeletionAttempt(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const { error } = await getSupabaseClient()
      .from('chat_attachment_object_deletions')
      .update({ last_attempt_at: new Date().toISOString() })
      .in('storage_key', keys);
    if (error) throw error;
  },
};

export type ChatAttachmentRepository = typeof chatAttachmentRepository;

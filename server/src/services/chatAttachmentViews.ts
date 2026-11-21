import { chatAttachmentRepository, type StoredAttachment } from '../db/chatAttachment.repository.js';
import type { AttachmentMimeType, AttachmentScanStatus, AttachmentScope } from '../db/chatAttachmentModel.js';
import { areAttachmentsUsable, isScanStatusDownloadable } from './attachmentScanPolicy.js';

/**
 * US-035 / #409 — the safe attachment fields returned to clients, and batched
 * attachment summaries for message lists. Never includes the storage key, the
 * uploader, bucket details, or any URL; download access is a separate request.
 * Kept free of chat.ts imports so the message services can use it.
 */

export interface ChatAttachmentView {
  id: string;
  filename: string;
  mimeType: AttachmentMimeType;
  sizeBytes: number;
  /** 'not_scanned' means NOT checked for malware (#404); it never means safe. */
  scanStatus: AttachmentScanStatus;
  status: 'pending' | 'attached';
  downloadable: boolean;
}

export function toAttachmentView(row: StoredAttachment): ChatAttachmentView {
  return {
    id: row.id,
    filename: row.display_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    scanStatus: row.scan_status,
    status: row.status === 'attached' ? 'attached' : 'pending',
    downloadable: row.status === 'attached' && isScanStatusDownloadable(row.scan_status),
  };
}

/**
 * Adds `attachments` to already-authorized message views while the feature is
 * usable (one query per list). When it is not, views are returned unchanged.
 */
export async function withChatAttachmentSummaries<T extends { id: string }>(
  scope: AttachmentScope,
  views: T[]
): Promise<Array<T & { attachments?: ChatAttachmentView[] }>> {
  if (!areAttachmentsUsable() || views.length === 0) return views;
  const rows = await chatAttachmentRepository.listAttachedForMessages(
    scope,
    views.map((view) => view.id)
  );
  const byMessage = new Map<string, ChatAttachmentView[]>();
  for (const row of rows) {
    const key = (row.message_id ?? '').toLowerCase();
    byMessage.set(key, [...(byMessage.get(key) ?? []), toAttachmentView(row)]);
  }
  return views.map((view) => ({ ...view, attachments: byMessage.get(view.id.toLowerCase()) ?? [] }));
}

/** Database errors from the 0068 send functions, as safe {status, code, message} answers. */
export function describeAttachmentSendError(err: unknown): { status: number; code: string; message: string } | null {
  const text = String((err as { message?: unknown } | null)?.message ?? '');
  if (text.includes('CHAT_ATTACHMENT_LIMIT')) {
    return { status: 400, code: 'ATTACHMENT_LIMIT', message: 'A message can have at most 5 attachments.' };
  }
  if (text.includes('CHAT_ATTACHMENT_NOT_AVAILABLE')) {
    return {
      status: 400,
      code: 'ATTACHMENT_NOT_AVAILABLE',
      message: 'One or more attachments are no longer available. Upload them again.',
    };
  }
  if (text.includes('CHAT_ATTACHMENT_VALIDATION_ERROR')) {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Validation failed.' };
  }
  return null;
}

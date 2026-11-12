import { AuthRequiredError, ChatApiError } from './chatApi';
import type {
  ChatAttachmentLimits,
  ChatAttachmentMimeType,
  ChatAttachmentScanStatus,
} from './chatTypes';

const MIME_LABELS: Record<ChatAttachmentMimeType, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
  'application/pdf': 'PDF',
  'text/plain': 'TXT',
};

const MIME_BY_EXTENSION: Record<string, ChatAttachmentMimeType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
};

const BLOCKED_SCAN_MESSAGES: Record<Exclude<ChatAttachmentScanStatus, 'not_scanned' | 'clean'>, string> = {
  pending: 'Waiting for malware scan before download.',
  infected: 'Download blocked because malware was detected.',
  scan_failed: 'Download blocked because malware scanning failed.',
};

export const ATTACHMENT_ACCEPT_ATTR =
  '.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain';

/** Formats attachment size into B / KB / MB for accessible UI labels. */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Number.isInteger(kb) ? kb : Number(kb.toFixed(1))} KB`;
  }
  const mb = kb / 1024;
  return `${Number.isInteger(mb) ? mb : Number(mb.toFixed(1))} MB`;
}

export function mimeBadgeLabel(mimeType: ChatAttachmentMimeType): string {
  return MIME_LABELS[mimeType];
}

export function isRasterAttachmentMime(mimeType: ChatAttachmentMimeType): boolean {
  return (
    mimeType === 'image/png' ||
    mimeType === 'image/jpeg' ||
    mimeType === 'image/gif' ||
    mimeType === 'image/webp'
  );
}

export function isDownloadableScanStatus(scanStatus: ChatAttachmentScanStatus): boolean {
  return scanStatus === 'not_scanned' || scanStatus === 'clean';
}

export function scanBadgeLabel(scanStatus: ChatAttachmentScanStatus): string {
  switch (scanStatus) {
    case 'not_scanned':
      return 'Not scanned for malware';
    case 'pending':
      return 'Scan pending';
    case 'clean':
      return 'Scan clean';
    case 'infected':
      return 'Blocked: malware detected';
    case 'scan_failed':
      return 'Blocked: scan failed';
  }
}

export function blockedScanReason(scanStatus: ChatAttachmentScanStatus): string {
  if (scanStatus === 'pending' || scanStatus === 'infected' || scanStatus === 'scan_failed') {
    return BLOCKED_SCAN_MESSAGES[scanStatus];
  }
  return '';
}

function normalizedExtension(filename: string): string {
  const leaf = filename.trim().split(/[/\\]/).pop() ?? '';
  const dotIndex = leaf.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return leaf.slice(dotIndex).trim().toLowerCase();
}

/**
 * Client-side pre-validation matching docs/04_requirements/us035_rich_chat_policy.md
 * and server/src/db/chatAttachmentModel.ts (#409). Server byte-signature validation
 * remains authoritative.
 */
export function validateAttachmentBeforeUpload(
  file: File,
  currentPendingCount: number,
  limits: ChatAttachmentLimits
): string | null {
  if (currentPendingCount >= limits.maxPerMessage) {
    return `You can attach up to ${limits.maxPerMessage} files per message.`;
  }
  if (file.size <= 0) {
    return 'Empty files cannot be attached.';
  }
  if (file.size > limits.maxBytes) {
    return `File "${file.name}" exceeds the ${formatByteSize(limits.maxBytes)} size limit.`;
  }

  const ext = normalizedExtension(file.name);
  const expectedMime = MIME_BY_EXTENSION[ext];
  if (!expectedMime || !limits.allowedTypes.includes(expectedMime)) {
    return `File "${file.name}" is not an approved type (PNG, JPEG, GIF, WebP, PDF, or UTF-8 TXT).`;
  }

  const declaredType = (file.type || '').trim().toLowerCase();
  if (
    declaredType.length > 0 &&
    declaredType !== 'application/octet-stream' &&
    declaredType !== expectedMime
  ) {
    return `File "${file.name}" does not match its declared file type.`;
  }

  return null;
}

/** Maps #409 API errors to accessible alerts without altering any message draft. */
export function describeAttachmentError(
  error: unknown,
  markUnavailable: () => void,
  action: 'upload' | 'download'
): string | null {
  if (error instanceof AuthRequiredError) {
    return action === 'upload'
      ? 'Please sign in again to upload attachments.'
      : 'Please sign in again to download attachments.';
  }
  if (!(error instanceof ChatApiError)) {
    return action === 'upload'
      ? 'Could not upload the attachment. Your message draft is preserved.'
      : 'Could not download the attachment. Please try again.';
  }
  if (error.code === 'FEATURE_DISABLED') {
    markUnavailable();
    return null;
  }
  if (error.status === 429) {
    const seconds = error.retryAfterSeconds ?? 60;
    return `Attachment upload limit reached. Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
  }
  if (error.status === 503 || error.code === 'ATTACHMENT_STORAGE_UNAVAILABLE') {
    return action === 'upload'
      ? 'Attachment storage is currently unavailable. You can still send your text message.'
      : 'Attachment storage is currently unavailable. Please try again later.';
  }
  if (error.message && error.message !== error.code) {
    return error.message;
  }
  switch (error.code) {
    case 'ATTACHMENT_TOO_LARGE':
      return 'Files can be at most 10 MB.';
    case 'ATTACHMENT_QUOTA_EXCEEDED':
      return 'You have used your 100 MB attachment storage.';
    case 'ATTACHMENT_TYPE_NOT_ALLOWED':
      return 'Only PNG, JPEG, GIF, WebP, PDF, and plain-text files are allowed.';
    case 'ATTACHMENT_NOT_DOWNLOADABLE':
      return 'This file is not available for download.';
    case 'ATTACHMENT_NOT_FOUND':
      return 'Attachment not found or its download link has expired.';
    default:
      return action === 'upload'
        ? 'Could not upload the attachment. Your message draft is preserved.'
        : 'Could not download the attachment. Please try again.';
  }
}

/**
 * US-035 / #409 — attachment rules from the approved #404 policy (section 6).
 * The database repeats the type and size rules (migration 0068).
 */

export const ATTACHMENT_MAX_BYTES = 10_485_760; // 10 MB
export const ATTACHMENTS_PER_MESSAGE_MAX = 5;
export const ATTACHMENT_UPLOADS_PER_HOUR = 20;
export const ATTACHMENT_QUOTA_BYTES = 104_857_600; // 100 MB per participant
export const ATTACHMENT_PENDING_TTL_MS = 24 * 60 * 60 * 1000;
export const ATTACHMENT_DISPLAY_NAME_MAX = 255;
/** #404 section 6: download access expires after 60 seconds. */
export const ATTACHMENT_ACCESS_TTL_MS = 60_000;

export const ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
] as const;

export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

/** Extensions accepted for display per detected type; a mismatch is rejected. */
export const ATTACHMENT_EXTENSIONS: Readonly<Record<AttachmentMimeType, readonly string[]>> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
};

/** Raster images may render inline; PDF and text are always downloads. */
export const ATTACHMENT_INLINE_TYPES: ReadonlySet<AttachmentMimeType> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

export type AttachmentScanStatus = 'not_scanned' | 'pending' | 'clean' | 'infected' | 'scan_failed';
export type AttachmentStatus = 'uploading' | 'pending' | 'attached';
/** Which attachment table: channel (public + team) or direct messages. */
export type AttachmentScope = 'channel' | 'directMessage';

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (text: string): number[] => [...text].map((ch) => ch.charCodeAt(0));

/**
 * Decides the type from the file's own bytes (magic numbers). The browser's
 * Content-Type and the filename extension are never consulted. Returns null for
 * anything outside the approved list.
 */
export function detectAttachmentType(bytes: Uint8Array): AttachmentMimeType | null {
  if (bytes.length === 0) return null;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  if (startsWith(bytes, ascii('%PDF-'))) return 'application/pdf';
  return isPlainUtf8Text(bytes) ? 'text/plain' : null;
}

/**
 * Conservative text rule: valid UTF-8 (strict decoding), no NUL bytes, and no C0
 * control characters other than tab, line feed, form feed, and carriage return.
 * Markup is not detected here; text is always delivered as a download, never
 * rendered, so it cannot execute.
 */
export function isPlainUtf8Text(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte === 0x00) return false;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d) return false;
    if (byte === 0x7f) return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Display name only (never a storage path, never authorization). Strips any path,
 * control and bidirectional-override characters, collapses whitespace, and caps
 * the length at 255 characters while keeping the extension. Returns null when
 * nothing usable remains.
 */
export function sanitizeAttachmentDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const base = raw.normalize('NFC').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // C0/C1 controls, bidi overrides/isolates, zero-width and BOM characters.
    // eslint-disable-next-line no-control-regex -- removing control characters is the purpose
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (!cleaned) return null;
  if (cleaned.length <= ATTACHMENT_DISPLAY_NAME_MAX) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, ATTACHMENT_DISPLAY_NAME_MAX - extension.length) + extension;
}

/** True when the display name's extension is one accepted for the detected type. */
export function extensionMatchesType(displayName: string, mimeType: AttachmentMimeType): boolean {
  const lower = displayName.toLowerCase();
  return ATTACHMENT_EXTENSIONS[mimeType].some((extension) => lower.endsWith(extension));
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config/index.js';
import { chatAttachmentRepository, type StoredAttachment } from '../db/chatAttachment.repository.js';
import type { Participant } from '../db/types.js';
import { SAMPLE_FILES } from '../db/chatAttachments.testUtils.js';
import { MemoryAttachmentStore, _setAttachmentObjectStore } from './attachmentStorage.js';
import {
  AttachmentRateLimitError,
  contentDisposition,
  issueAttachmentAccess,
  precheckAttachmentUpload,
  runAttachmentMaintenance,
  uploadAttachment,
  verifyAttachmentAccessToken,
} from './chatAttachments.js';

const uploader: Participant = {
  id: '10000000-0000-4000-8000-000000000001',
  firebase_uid: 'fb-reader',
  email: 'reader@example.test',
  full_name: 'Reader',
  role: 'PART',
  is_verified: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};
const conversation = { scope: 'channel' as const, conversationId: '60000000-0000-4000-8000-000000000001' };
const attachmentId = 'a0000000-0000-4000-8000-000000000001';

function stored(overrides: Partial<StoredAttachment> = {}): StoredAttachment {
  return {
    id: attachmentId,
    uploader_id: uploader.id,
    conversation_id: conversation.conversationId,
    message_id: null,
    storage_key: 'opaque-key',
    display_name: 'photo.png',
    mime_type: 'image/png',
    size_bytes: SAMPLE_FILES.png.bytes.length,
    status: 'pending',
    scan_status: 'not_scanned',
    created_at: '2026-01-01T00:00:00.000Z',
    attached_at: null,
    ...overrides,
  };
}

describe('secure attachment upload service', () => {
  let store: MemoryAttachmentStore;

  beforeEach(() => {
    store = new MemoryAttachmentStore();
    _setAttachmentObjectStore(store);
    config.richChat.attachmentsEnabled = true;
    config.nodeEnv = 'test';
    vi.spyOn(chatAttachmentRepository, 'usage').mockResolvedValue({ uploadsLastHour: 0, oldestUploadInWindow: null, storedBytes: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _setAttachmentObjectStore(null);
    config.richChat.attachmentsEnabled = false;
  });

  it('validates bytes, reserves an opaque key, stores privately, and returns only the safe view', async () => {
    let key = '';
    vi.spyOn(chatAttachmentRepository, 'reserve').mockImplementation(async (input) => {
      key = input.storageKey;
      expect(input).toMatchObject({
        scope: 'channel', participantId: uploader.id, conversationId: conversation.conversationId,
        displayName: 'photo.png', mimeType: 'image/png', scanStatus: 'not_scanned',
      });
      expect(key).toMatch(/^[0-9a-f-]{36}$/);
      expect(key).not.toContain('photo');
      return { outcome: 'reserved', attachmentId };
    });
    vi.spyOn(chatAttachmentRepository, 'markUploaded').mockResolvedValue(true);
    vi.spyOn(chatAttachmentRepository, 'findById').mockImplementation(async () => stored({ storage_key: key }));

    const result = await uploadAttachment({ uploader, conversation, rawFilename: '../../photo.png', bytes: SAMPLE_FILES.png.bytes });

    expect(result).toEqual({
      id: attachmentId, filename: 'photo.png', mimeType: 'image/png', sizeBytes: SAMPLE_FILES.png.bytes.length,
      scanStatus: 'not_scanned', status: 'pending', downloadable: false,
    });
    expect(Object.keys(result)).not.toContain('storageKey');
    expect(store.objects.get(key)).toMatchObject({ contentType: 'image/png' });
  });

  it.each([
    ['spoofed extension', 'photo.jpg', SAMPLE_FILES.png.bytes],
    ['unsupported executable', 'run.exe', new Uint8Array([0x4d, 0x5a, 0x90, 0])],
    ['script extension', 'run.js', new TextEncoder().encode('alert(1)')],
  ])('rejects %s before reserving or storing', async (_label, rawFilename, bytes) => {
    const reserve = vi.spyOn(chatAttachmentRepository, 'reserve');
    await expect(uploadAttachment({ uploader, conversation, rawFilename, bytes })).rejects.toMatchObject({
      status: 415, code: 'ATTACHMENT_TYPE_NOT_ALLOWED',
    });
    expect(reserve).not.toHaveBeenCalled();
    expect(store.objects.size).toBe(0);
  });

  it('maps the authoritative rolling-hour and participant quota outcomes safely', async () => {
    vi.mocked(chatAttachmentRepository.usage).mockResolvedValueOnce({
      uploadsLastHour: 20, oldestUploadInWindow: new Date(Date.now() - 3_000).toISOString(), storedBytes: 0,
    });
    await expect(precheckAttachmentUpload(uploader.id, 1)).rejects.toBeInstanceOf(AttachmentRateLimitError);
    vi.mocked(chatAttachmentRepository.usage).mockResolvedValueOnce({ uploadsLastHour: 0, oldestUploadInWindow: null, storedBytes: 104_857_600 });
    await expect(precheckAttachmentUpload(uploader.id, 1)).rejects.toMatchObject({ code: 'ATTACHMENT_QUOTA_EXCEEDED' });
  });

  it('discards the database reservation when private storage fails', async () => {
    vi.spyOn(chatAttachmentRepository, 'reserve').mockResolvedValue({ outcome: 'reserved', attachmentId });
    const discard = vi.spyOn(chatAttachmentRepository, 'discardReservation').mockResolvedValue();
    store.failNext.put = true;
    await expect(uploadAttachment({ uploader, conversation, rawFilename: 'photo.png', bytes: SAMPLE_FILES.png.bytes })).rejects.toMatchObject({
      code: 'ATTACHMENT_STORAGE_UNAVAILABLE',
    });
    expect(discard).toHaveBeenCalledWith('channel', attachmentId, uploader.id);
  });

  it('discards an inaccessible reservation if the post-storage metadata transition fails', async () => {
    vi.spyOn(chatAttachmentRepository, 'reserve').mockResolvedValue({ outcome: 'reserved', attachmentId });
    vi.spyOn(chatAttachmentRepository, 'markUploaded').mockResolvedValue(false);
    const discard = vi.spyOn(chatAttachmentRepository, 'discardReservation').mockResolvedValue();
    await expect(uploadAttachment({ uploader, conversation, rawFilename: 'photo.png', bytes: SAMPLE_FILES.png.bytes })).rejects.toMatchObject({
      code: 'ATTACHMENT_STORAGE_UNAVAILABLE',
    });
    expect(discard).toHaveBeenCalledOnce();
    expect(store.objects.size).toBe(1); // private orphan; DB delete trigger queues it for bounded cleanup
  });
});

describe('short-lived access and object cleanup', () => {
  beforeEach(() => {
    config.richChat.attachmentsEnabled = true;
    config.nodeEnv = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _setAttachmentObjectStore(null);
    config.richChat.attachmentsEnabled = false;
  });

  it('issues an application-proxied link for exactly 60 seconds without a storage key or permanent URL', async () => {
    vi.spyOn(chatAttachmentRepository, 'findInConversation').mockResolvedValue(stored({
      status: 'attached', message_id: 'b0000000-0000-4000-8000-000000000001', attached_at: '2026-01-01T00:00:00.000Z',
    }));
    const now = Date.parse('2026-02-01T00:00:00.000Z');
    const access = await issueAttachmentAccess({ viewer: uploader, conversation, attachmentId, now });
    expect(access.expiresAt).toBe('2026-02-01T00:01:00.000Z');
    expect(access.url).toMatch(/^\/api\/chat\/attachments\/content\?token=/);
    expect(access.url).not.toContain('opaque-key');
    const token = decodeURIComponent(access.url.split('token=')[1]!);
    expect(verifyAttachmentAccessToken(token, now + 59_999)).toMatchObject({ attachmentId, viewerId: uploader.id });
    expect(verifyAttachmentAccessToken(token, now + 60_000)).toBeNull();
    expect(verifyAttachmentAccessToken(`${token}x`, now)).toBeNull();
  });

  it('keeps failed external deletes queued for a later maintenance retry', async () => {
    const store = new MemoryAttachmentStore();
    _setAttachmentObjectStore(store);
    store.failNext.remove = true;
    vi.spyOn(chatAttachmentRepository, 'expireStaleUploads').mockResolvedValue(2);
    vi.spyOn(chatAttachmentRepository, 'listObjectDeletions').mockResolvedValue(['one', 'two']);
    const complete = vi.spyOn(chatAttachmentRepository, 'completeObjectDeletions').mockResolvedValue();
    const attempted = vi.spyOn(chatAttachmentRepository, 'noteObjectDeletionAttempt').mockResolvedValue();
    await expect(runAttachmentMaintenance()).resolves.toEqual({ expiredUploads: 2, removedObjects: 0, failedObjects: 2 });
    expect(complete).not.toHaveBeenCalled();
    expect(attempted).toHaveBeenCalledWith(['one', 'two']);
  });

  it('builds a safe Content-Disposition header from an untrusted display name', () => {
    const header = contentDisposition('résumé "final".pdf\r\nX-Evil: yes', false);
    expect(header).toMatch(/^attachment; filename=/);
    expect(header).not.toContain('\r');
    expect(header).not.toContain('\n');
    expect(header).toContain("filename*=UTF-8''");
  });
});

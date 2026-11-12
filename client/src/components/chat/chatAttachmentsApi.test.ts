/**
 * US-035 / #411 — attachment client API unit tests: capability normalization,
 * attachment view sanitization, conversation upload routes, and 60s access URLs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChatApiError,
  fetchAttachmentContentBlob,
  fetchChatCapabilities,
  normalizeAttachmentViews,
  requestChatAttachmentAccess,
  uploadChatAttachment,
} from './chatApi';
import { CHAT_ATTACHMENT_MIME_TYPES, CHAT_REACTION_CODES } from './chatTypes';

const mockAuthFetch = vi.fn();
vi.mock('../../config/authFetch', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
  AuthRequiredError: class AuthRequiredError extends Error {},
}));

const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const THREAD_ID = '44444444-4444-4444-8444-444444444444';
const ATTACHMENT_ID = '77777777-7777-4777-8777-777777777777';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

beforeEach(() => {
  mockAuthFetch.mockReset();
});

describe('fetchChatCapabilities (attachments)', () => {
  it('parses server-authoritative attachment limits and keeps voiceVideo disabled', async () => {
    mockAuthFetch.mockResolvedValue(
      json(200, {
        status: 'ok',
        capabilities: {
          reactions: { enabled: true, allowedReactions: [...CHAT_REACTION_CODES] },
          typing: { enabled: true },
          attachments: {
            enabled: true,
            maxBytes: 10_485_760,
            maxPerMessage: 5,
            allowedTypes: [...CHAT_ATTACHMENT_MIME_TYPES, 'application/x-msdownload'],
            malwareScanning: 'not_available',
          },
          voiceVideo: true,
        },
      })
    );

    const caps = await fetchChatCapabilities();
    expect(caps.voiceVideo).toBe(false);
    expect(caps.attachments.enabled).toBe(true);
    expect(caps.attachments.limits).toEqual({
      maxBytes: 10_485_760,
      maxPerMessage: 5,
      allowedTypes: [...CHAT_ATTACHMENT_MIME_TYPES],
      malwareScanning: 'not_available',
    });
  });

  it('defaults attachments to disabled unless the server sends an explicit boolean true', async () => {
    mockAuthFetch.mockResolvedValue(
      json(200, {
        status: 'ok',
        capabilities: {
          reactions: { enabled: false },
          typing: { enabled: false },
          attachments: { enabled: 'true' },
          voiceVideo: false,
        },
      })
    );

    const caps = await fetchChatCapabilities();
    expect(caps.attachments).toEqual({ enabled: false });
    expect(caps.voiceVideo).toBe(false);
  });
});

describe('normalizeAttachmentViews', () => {
  it('strips unexpected server/private fields and enforces downloadable scan gating', () => {
    const normalized = normalizeAttachmentViews([
      {
        id: 'att-1',
        filename: 'photo.png',
        mimeType: 'image/png',
        sizeBytes: 2048,
        scanStatus: 'not_scanned',
        status: 'attached',
        downloadable: true,
        storageKey: 'secret-uuid-key',
        url: 'https://supabase.local/storage/secret',
        uploaderId: 'user-secret',
      },
      {
        id: 'att-2',
        filename: 'suspect.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4096,
        scanStatus: 'infected',
        status: 'attached',
        downloadable: true,
      },
      {
        id: 'att-3',
        filename: 'pending.txt',
        mimeType: 'text/plain',
        sizeBytes: 128,
        scanStatus: 'not_scanned',
        status: 'pending',
        downloadable: true,
      },
    ]);

    expect(normalized).toEqual([
      {
        id: 'att-1',
        filename: 'photo.png',
        mimeType: 'image/png',
        sizeBytes: 2048,
        scanStatus: 'not_scanned',
        status: 'attached',
        downloadable: true,
      },
      {
        id: 'att-2',
        filename: 'suspect.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4096,
        scanStatus: 'infected',
        status: 'attached',
        downloadable: false,
      },
      {
        id: 'att-3',
        filename: 'pending.txt',
        mimeType: 'text/plain',
        sizeBytes: 128,
        scanStatus: 'not_scanned',
        status: 'pending',
        downloadable: false,
      },
    ]);
    expect(JSON.stringify(normalized)).not.toMatch(/storageKey|uploaderId|supabase\.local/);

    expect(() =>
      normalizeAttachmentViews([
        {
          id: 'att-bad-mime',
          filename: 'payload.exe',
          mimeType: 'application/x-msdownload',
          sizeBytes: 1024,
          scanStatus: 'not_scanned',
          status: 'attached',
          downloadable: true,
        },
      ])
    ).toThrow(ChatApiError);

    expect(() =>
      normalizeAttachmentViews([
        {
          id: 'att-1',
          filename: 'one.png',
          mimeType: 'image/png',
          sizeBytes: 100,
          scanStatus: 'clean',
          status: 'attached',
          downloadable: true,
        },
        {
          id: 'att-1',
          filename: 'duplicate.png',
          mimeType: 'image/png',
          sizeBytes: 100,
          scanStatus: 'clean',
          status: 'attached',
          downloadable: true,
        },
      ])
    ).toThrow(ChatApiError);
  });
});

describe('uploadChatAttachment', () => {
  it('routes uploads to the matching conversation endpoint with FormData file field', async () => {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'photo.png', { type: 'image/png' });
    const attachmentRow = {
      id: ATTACHMENT_ID,
      filename: 'photo.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      scanStatus: 'not_scanned',
      status: 'pending',
      downloadable: false,
    };

    const cases = [
      [{ kind: 'channel', channelId: CHANNEL_ID }, `/api/chat/channels/${CHANNEL_ID}/attachments`],
      [{ kind: 'team', teamId: TEAM_ID }, `/api/teams/${TEAM_ID}/chat/attachments`],
      [{ kind: 'directMessage', threadId: THREAD_ID }, `/api/direct-messages/threads/${THREAD_ID}/attachments`],
    ] as const;

    for (const [target, expectedPath] of cases) {
      mockAuthFetch.mockResolvedValueOnce(json(201, { status: 'ok', attachment: attachmentRow }));
      const result = await uploadChatAttachment(target, file);
      expect(result).toEqual(attachmentRow);

      const [url, init] = mockAuthFetch.mock.calls.at(-1)!;
      expect(url).toBe(expectedPath);
      expect(init.method).toBe('POST');
      expect(init.headers).toBeUndefined();
      expect(init.body).toBeInstanceOf(FormData);
      const uploadedFile = (init.body as FormData).get('file');
      expect(uploadedFile).toBeInstanceOf(File);
      expect((uploadedFile as File).name).toBe('photo.png');
    }
  });

  it('propagates 413, 415, 429 Retry-After, 503 storage unavailable, 404 disabled, and network errors', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const target = { kind: 'channel', channelId: CHANNEL_ID } as const;

    mockAuthFetch.mockResolvedValueOnce(json(413, { code: 'ATTACHMENT_QUOTA_EXCEEDED', error: 'Quota full' }));
    await expect(uploadChatAttachment(target, file)).rejects.toMatchObject({
      status: 413,
      code: 'ATTACHMENT_QUOTA_EXCEEDED',
    });

    mockAuthFetch.mockResolvedValueOnce(json(415, { code: 'ATTACHMENT_TYPE_NOT_ALLOWED', error: 'Unsupported' }));
    await expect(uploadChatAttachment(target, file)).rejects.toMatchObject({
      status: 415,
      code: 'ATTACHMENT_TYPE_NOT_ALLOWED',
    });

    mockAuthFetch.mockResolvedValueOnce(
      json(429, { code: 'RATE_LIMITED', error: 'Too many uploads' }, { 'Retry-After': '45' })
    );
    await expect(uploadChatAttachment(target, file)).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 45,
    });

    mockAuthFetch.mockResolvedValueOnce(json(503, { code: 'ATTACHMENT_STORAGE_UNAVAILABLE', error: 'Storage down' }));
    await expect(uploadChatAttachment(target, file)).rejects.toMatchObject({
      status: 503,
      code: 'ATTACHMENT_STORAGE_UNAVAILABLE',
    });

    mockAuthFetch.mockResolvedValueOnce(json(404, { code: 'FEATURE_DISABLED', error: 'Off' }));
    await expect(uploadChatAttachment(target, file)).rejects.toMatchObject({
      status: 404,
      code: 'FEATURE_DISABLED',
    });

    mockAuthFetch.mockRejectedValueOnce(new Error('offline'));
    await expect(uploadChatAttachment(target, file)).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
  });
});

describe('requestChatAttachmentAccess and fetchAttachmentContentBlob', () => {
  it('requests a 60s content URL and refuses non-proxy URLs', async () => {
    const target = { kind: 'directMessage', threadId: THREAD_ID } as const;
    mockAuthFetch.mockResolvedValueOnce(
      json(200, {
        status: 'ok',
        access: {
          url: '/api/chat/attachments/content?token=signed-jwt-like-token',
          expiresAt: '2026-11-12T12:01:00.000Z',
        },
      })
    );

    const access = await requestChatAttachmentAccess(target, ATTACHMENT_ID);
    expect(mockAuthFetch).toHaveBeenCalledWith(
      `/api/direct-messages/threads/${THREAD_ID}/attachments/${encodeURIComponent(ATTACHMENT_ID)}/access`,
      { method: 'GET' }
    );
    expect(access.url).toBe('/api/chat/attachments/content?token=signed-jwt-like-token');

    mockAuthFetch.mockResolvedValueOnce(
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      })
    );
    const fetched = await fetchAttachmentContentBlob(access.url);
    expect(mockAuthFetch).toHaveBeenLastCalledWith(access.url, { method: 'GET' });
    expect(fetched.size).toBe(4);

    mockAuthFetch.mockResolvedValueOnce(
      json(200, {
        status: 'ok',
        access: { url: 'https://evil.example/storage/raw', expiresAt: '2026-11-12T12:01:00.000Z' },
      })
    );
    await expect(requestChatAttachmentAccess(target, ATTACHMENT_ID)).rejects.toThrow();

    const callCountBefore = mockAuthFetch.mock.calls.length;
    await expect(fetchAttachmentContentBlob('https://evil.example/storage/raw')).rejects.toThrow();
    expect(mockAuthFetch).toHaveBeenCalledTimes(callCountBefore);
  });

  it('propagates 404 expired-token and 503 unavailable-storage failures when reading content blobs', async () => {
    mockAuthFetch.mockResolvedValueOnce(json(404, { code: 'ATTACHMENT_NOT_FOUND', error: 'Expired' }));
    await expect(fetchAttachmentContentBlob('/api/chat/attachments/content?token=expired')).rejects.toMatchObject({
      status: 404,
      code: 'ATTACHMENT_NOT_FOUND',
    });

    mockAuthFetch.mockResolvedValueOnce(json(503, { code: 'ATTACHMENT_STORAGE_UNAVAILABLE', error: 'Down' }));
    await expect(fetchAttachmentContentBlob('/api/chat/attachments/content?token=valid')).rejects.toMatchObject({
      status: 503,
      code: 'ATTACHMENT_STORAGE_UNAVAILABLE',
    });
  });
});

import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTACHMENT_MAX_BYTES } from '../db/chatAttachmentModel.js';
import { ChatServiceError } from '../services/chat.js';
import { AttachmentRateLimitError } from '../services/chatAttachments.js';
import { requestLoggerMiddleware } from './requestLogger.js';

const mocks = vi.hoisted(() => ({
  precheck: vi.fn(),
}));

vi.mock('../services/chatAttachments.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/chatAttachments.js')>();
  return { ...original, precheckAttachmentUpload: mocks.precheck };
});

const { precheckAttachmentRequest, readAttachmentBody } = await import('./richChatAttachments.js');

function testApp(withLogger = false) {
  const app = express();
  if (withLogger) app.use(requestLoggerMiddleware);
  app.post(
    '/upload',
    (req, _res, next) => {
      req.participant = { id: '10000000-0000-4000-8000-000000000001' } as Request['participant'];
      next();
    },
    precheckAttachmentRequest,
    readAttachmentBody,
    (req: Request, res: Response) => {
      res.status(201).json({
        filename: res.locals.attachmentFilename,
        bytes: Array.from(res.locals.attachmentBytes as Uint8Array),
        requestBodyHasFile: !!(req.body as Record<string, unknown> | undefined)?.file,
      });
    }
  );
  return app;
}

describe('streamed attachment multipart parsing', () => {
  beforeEach(() => mocks.precheck.mockResolvedValue(undefined));
  afterEach(() => vi.clearAllMocks());

  it('accepts exactly one file field and keeps bytes/filename out of req.body', async () => {
    const response = await request(testApp()).post('/upload').attach('file', Buffer.from([1, 2, 3]), {
      filename: 'private-name.png', contentType: 'image/png',
    });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ filename: 'private-name.png', bytes: [1, 2, 3], requestBodyHasFile: false });
    expect(mocks.precheck).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000001', null);
  });

  it('rejects octet-stream, missing files, wrong fields, and additional parts safely', async () => {
    const octet = await request(testApp()).post('/upload').type('application/octet-stream').send(Buffer.from([1]));
    expect(octet.status).toBe(400);
    expect(octet.body).toMatchObject({ code: 'VALIDATION_ERROR' });

    const missing = await request(testApp()).post('/upload').field('note', 'not a file');
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ code: 'VALIDATION_ERROR' });

    const wrong = await request(testApp()).post('/upload').attach('upload', Buffer.from([1]), 'x.png');
    expect(wrong.status).toBe(400);
    expect(wrong.body).toMatchObject({ code: 'VALIDATION_ERROR' });

    const extra = await request(testApp())
      .post('/upload')
      .attach('file', Buffer.from([1]), 'one.png')
      .attach('file', Buffer.from([2]), 'two.png');
    expect(extra.status).toBe(400);
    expect(extra.body).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('allows the exact 10 MB boundary and rejects the first excess byte', async () => {
    const exact = await request(testApp()).post('/upload').attach('file', Buffer.alloc(ATTACHMENT_MAX_BYTES), 'exact.png');
    expect(exact.status).toBe(201);
    expect(exact.body.bytes).toHaveLength(ATTACHMENT_MAX_BYTES);

    const over = await request(testApp()).post('/upload').attach('file', Buffer.alloc(ATTACHMENT_MAX_BYTES + 1), 'over.png');
    expect(over.status).toBe(413);
    expect(over.body).toEqual({ error: 'Files can be at most 10 MB.', code: 'ATTACHMENT_TOO_LARGE' });
  }, 20_000);

  it('returns safe rate/quota failures without reading the upload body', async () => {
    mocks.precheck.mockRejectedValueOnce(new ChatServiceError(413, 'ATTACHMENT_QUOTA_EXCEEDED', 'You have used your 100 MB attachment storage.'));
    const response = await request(testApp()).post('/upload').attach('file', Buffer.from('private bytes'), 'private-name.txt');
    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: 'You have used your 100 MB attachment storage.', code: 'ATTACHMENT_QUOTA_EXCEEDED',
    });
    expect(JSON.stringify(response.body)).not.toContain('private-name');
    expect(JSON.stringify(response.body)).not.toContain('private bytes');
  });

  it('returns the database-backed rolling-hour retry interval as safe 429 metadata', async () => {
    mocks.precheck.mockRejectedValueOnce(new AttachmentRateLimitError(37));
    const response = await request(testApp()).post('/upload').attach('file', Buffer.from('private bytes'), 'private.txt');
    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('37');
    expect(response.body).toEqual({
      error: 'You can upload at most 20 files per hour.',
      code: 'RATE_LIMITED',
      retryAfterSeconds: 37,
    });
  });

  it('does not place multipart bytes or the original filename in structured request logs', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const response = await request(testApp(true))
      .post('/upload')
      .attach('file', Buffer.from('highly private file bytes'), 'private-original-name.txt');
    expect(response.status).toBe(201);
    await vi.waitFor(() => expect(logged).toHaveBeenCalled());
    const output = logged.mock.calls.flat().join(' ');
    expect(output).not.toContain('highly private file bytes');
    expect(output).not.toContain('private-original-name');
    vi.unstubAllEnvs();
  });
});

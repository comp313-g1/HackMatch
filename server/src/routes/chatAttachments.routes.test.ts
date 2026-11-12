import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { PGlite } from '@electric-sql/pglite';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { config } from '../config/index.js';
import { createPgliteSupabaseClient } from '../db/pgliteSupabase.testUtils.js';
import { createChatAttachmentDb, SAMPLE_FILES } from '../db/chatAttachments.testUtils.js';
import { reactionIds as ids, suspendParticipant, unsuspendParticipant } from '../db/chatReactions.testUtils.js';
import { participantBlockRepository } from '../db/participantBlock.repository.js';
import { MemoryAttachmentStore, _setAttachmentObjectStore } from '../services/attachmentStorage.js';
import { _resetAttachmentMaintenanceClock } from '../services/chatAttachments.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';

/**
 * US-035 / #409 — full HTTP attachment paths backed by the real 0068 SQL in
 * PGlite. Firebase verification and Supabase Storage are the only mocked
 * external boundaries; object bytes use the deterministic private-memory store.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../db/client.js', () => ({
  getSupabaseClient: () => holder.client,
  supabaseClient: new Proxy({}, { get: (_target, prop) => (holder.client as Record<string | symbol, unknown>)[prop] }),
}));

const mockVerifyIdToken = vi.fn();
vi.mock('../config/firebase.js', () => {
  const authMock = { verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) };
  return {
    firebaseAuth: authMock,
    auth: authMock,
    getFirebaseAdminAuth: vi.fn(),
    verifyEmailActionCode: vi.fn(),
    sendVerificationEmail: vi.fn(),
    _resetFirebaseInstances: vi.fn(),
  };
});

const { app } = await import('../app.js');

type Who = 'reader' | 'peer' | 'outsider' | 'admin';
let db: PGlite;
let store: MemoryAttachmentStore;
const authTime = Math.floor(Date.now() / 1000) - 30;
const as = (who: Who) => ({ Authorization: `Bearer token-${who}` });
const publicUpload = `/api/chat/channels/${ids.publicChannel}/attachments`;
const teamUpload = `/api/teams/${ids.team}/chat/attachments`;
const dmUpload = `/api/direct-messages/threads/${ids.dm}/attachments`;

async function upload(path: string, who: Who = 'reader', file: { readonly name: string; readonly bytes: Uint8Array } = SAMPLE_FILES.png) {
  return request(app).post(path).set(as(who)).attach('file', Buffer.from(file.bytes), {
    filename: file.name,
    contentType: 'application/octet-stream', // deliberately ignored; bytes are authoritative
  });
}

beforeAll(async () => {
  db = await createChatAttachmentDb();
  holder.client = createPgliteSupabaseClient(db);
});

afterAll(async () => {
  _setAttachmentObjectStore(null);
  await db?.close();
});

beforeEach(async () => {
  config.nodeEnv = 'test';
  config.richChat.attachmentsEnabled = true;
  config.richChat.reactionsEnabled = false;
  config.richChat.typingEnabled = false;
  store = new MemoryAttachmentStore();
  _setAttachmentObjectStore(store);
  _resetAttachmentMaintenanceClock();
  await db.exec(`
    DELETE FROM chat_attachment_object_deletions;
    DELETE FROM chat_message_attachments;
    DELETE FROM direct_message_attachments;
    DELETE FROM participant_blocks;
    DELETE FROM chat_messages WHERE channel_id = '${ids.publicChannel}' AND body LIKE 'attachment test:%';
    DELETE FROM direct_messages WHERE body LIKE 'attachment test:%';
    UPDATE teams SET recruitment_status = 'Open';
    UPDATE team_memberships SET status = 'Confirmed'
      WHERE team_id = '${ids.team}' AND participant_id IN ('${ids.reader}', '${ids.peer}');
  `);
  await unsuspendParticipant(db, ids.peer);

  mockVerifyIdToken.mockImplementation(async (token: string) => {
    const who = token.replace(/^token-/, '');
    return {
      uid: `fb-${who}`,
      role: who === 'admin' ? 'ADMIN' : 'PART',
      auth_time: authTime,
      [MFA_CLAIM]: authTime,
    } as unknown as DecodedIdToken;
  });
  vi.spyOn(participantBlockRepository, 'findBlockState').mockImplementation(async (a: string, b: string) => {
    const { rows } = await db.query<{ blocker_id: string; blocked_id: string }>(
      `SELECT blocker_id, blocked_id FROM participant_blocks
       WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
      [a, b]
    );
    return {
      blockedByMe: rows.some((row) => row.blocker_id === a && row.blocked_id === b),
      blockedByThem: rows.some((row) => row.blocker_id === b && row.blocked_id === a),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  config.richChat.attachmentsEnabled = false;
});

describe('attachment feature availability and account authorization', () => {
  it('defaults safely through the runtime gate and reports actual capabilities without changing text/reactions/typing', async () => {
    const enabled = await request(app).get('/api/chat/capabilities').set(as('reader'));
    expect(enabled.status).toBe(200);
    expect(enabled.body.capabilities).toMatchObject({
      reactions: { enabled: false }, typing: { enabled: false },
      attachments: { enabled: true, maxBytes: 10_485_760, maxPerMessage: 5, malwareScanning: 'not_available' },
      voiceVideo: false,
    });

    config.richChat.attachmentsEnabled = false;
    const disabled = await upload(publicUpload);
    expect(disabled.status).toBe(404);
    expect(disabled.body).toEqual({ error: 'This chat feature is not available.', code: 'FEATURE_DISABLED' });
    expect((await request(app).get('/api/chat/capabilities').set(as('reader'))).body.capabilities.attachments).toEqual({ enabled: false });
    const text = await request(app)
      .post(`/api/chat/channels/${ids.publicChannel}/messages`)
      .set(as('reader'))
      .send({ body: 'attachment test: plain text remains available' });
    expect(text.status).toBe(201);
  });

  it('denies visitors and ADMIN accounts without accepting or persisting a file', async () => {
    const visitor = await request(app).post(publicUpload).attach('file', Buffer.from(SAMPLE_FILES.png.bytes), SAMPLE_FILES.png.name);
    const admin = await upload(publicUpload, 'admin');
    expect(visitor.status).toBe(401);
    expect(admin.status).toBe(403);
    expect(store.objects.size).toBe(0);
    expect((await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM chat_message_attachments')).rows[0]!.n).toBe(0);
  });
});

describe('current send authorization for uploads', () => {
  it('uploads for a public forum using authenticated ownership and a safe response', async () => {
    const response = await upload(publicUpload);
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.attachment).toMatchObject({
      filename: 'photo.png', mimeType: 'image/png', sizeBytes: SAMPLE_FILES.png.bytes.length,
      scanStatus: 'not_scanned', status: 'pending', downloadable: false,
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toMatch(/storage|bucket|uploader|https?:\/\//);
    const { rows } = await db.query<{ uploader_id: string; storage_key: string }>('SELECT uploader_id, storage_key FROM chat_message_attachments');
    expect(rows[0]!.uploader_id).toBe(ids.reader);
    expect(rows[0]!.storage_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0]!.storage_key).not.toContain('photo');
  });

  it('requires confirmed live-team membership and preserves disbanded read-only behavior', async () => {
    expect((await upload(teamUpload)).status).toBe(201);
    const outsider = await upload(teamUpload, 'outsider');
    expect(outsider.status).toBe(403);
    expect(outsider.body.code).toBe('FORBIDDEN_NOT_TEAM_MEMBER');
    await db.query("UPDATE teams SET recruitment_status = 'Disbanded' WHERE id = $1", [ids.team]);
    const readOnly = await upload(teamUpload);
    expect(readOnly.status).toBe(403);
    expect(readOnly.body.code).toBe('TEAM_CHANNEL_READ_ONLY');
  });

  it('requires DM participation, eligible peers, and no block in either direction', async () => {
    expect((await upload(dmUpload)).status).toBe(201);
    const outsider = await upload(dmUpload, 'outsider');
    expect(outsider.status).toBe(403);
    expect(outsider.body.code).toBe('FORBIDDEN_NOT_THREAD_PARTICIPANT');
    await db.query('INSERT INTO participant_blocks (blocker_id, blocked_id) VALUES ($1, $2)', [ids.peer, ids.reader]);
    const blocked = await upload(dmUpload);
    expect(blocked.status).toBe(403);
    // Existing US-032 privacy contract deliberately does not reveal whether the
    // peer is blocked or otherwise unavailable.
    expect(blocked.body.code).toBe('DM_PEER_UNAVAILABLE');
  });
});

describe('association and current-read download authorization', () => {
  it('atomically associates an owned upload with a text message and proxies bytes through a 60-second token', async () => {
    const uploaded = await upload(publicUpload);
    const attachmentId = uploaded.body.attachment.id as string;
    const sent = await request(app)
      .post(`/api/chat/channels/${ids.publicChannel}/messages`)
      .set(as('reader'))
      .send({ body: 'attachment test: associated', attachmentIds: [attachmentId] });
    expect(sent.status).toBe(201);
    expect(sent.body.message.attachments).toEqual([
      expect.objectContaining({ id: attachmentId, status: 'attached', scanStatus: 'not_scanned', downloadable: true }),
    ]);

    const access = await request(app)
      .get(`/api/chat/channels/${ids.publicChannel}/attachments/${attachmentId}/access`)
      .set(as('peer'));
    expect(access.status).toBe(200);
    expect(access.body.access.url).toMatch(/^\/api\/chat\/attachments\/content\?token=/);
    expect(Date.parse(access.body.access.expiresAt) - Date.now()).toBeGreaterThan(58_000);
    expect(Date.parse(access.body.access.expiresAt) - Date.now()).toBeLessThanOrEqual(60_000);

    const content = await request(app).get(access.body.access.url);
    expect(content.status).toBe(200);
    expect(content.headers['cache-control']).toContain('no-store');
    expect(content.headers['x-content-type-options']).toBe('nosniff');
    expect(content.headers['content-disposition']).toContain('photo.png');
    expect(content.body).toEqual(Buffer.from(SAMPLE_FILES.png.bytes));
  });

  it('keeps text mandatory and hides foreign/cross-conversation attachment existence', async () => {
    const uploaded = await upload(publicUpload);
    const attachmentId = uploaded.body.attachment.id as string;
    const empty = await request(app)
      .post(`/api/chat/channels/${ids.publicChannel}/messages`)
      .set(as('reader'))
      .send({ body: '   ', attachmentIds: [attachmentId] });
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('VALIDATION_ERROR');

    const foreign = await request(app)
      .post(`/api/chat/channels/${ids.publicChannel}/messages`)
      .set(as('peer'))
      .send({ body: 'attachment test: cannot steal', attachmentIds: [attachmentId] });
    expect(foreign.status).toBe(400);
    expect(foreign.body.code).toBe('ATTACHMENT_NOT_AVAILABLE');

    const crossConversation = await request(app)
      .get(`/api/teams/${ids.team}/chat/attachments/${attachmentId}/access`)
      .set(as('reader'));
    expect(crossConversation.status).toBe(404);
    expect(crossConversation.body.code).toBe('ATTACHMENT_NOT_FOUND');
  });

  it('re-checks team membership before issuing access and keeps blocked DM history readable', async () => {
    const teamFile = await upload(teamUpload);
    const teamAttachment = teamFile.body.attachment.id as string;
    await request(app)
      .post(`/api/teams/${ids.team}/chat/messages`)
      .set(as('reader'))
      .send({ body: 'attachment test: team', attachmentIds: [teamAttachment] });
    await db.query("UPDATE team_memberships SET status = 'Removed' WHERE team_id = $1 AND participant_id = $2", [ids.team, ids.reader]);
    const lost = await request(app)
      .get(`/api/teams/${ids.team}/chat/attachments/${teamAttachment}/access`)
      .set(as('reader'));
    expect(lost.status).toBe(403);

    const dmFile = await upload(dmUpload, 'peer');
    const dmAttachment = dmFile.body.attachment.id as string;
    await request(app)
      .post(`/api/direct-messages/threads/${ids.dm}/messages`)
      .set(as('peer'))
      .send({ body: 'attachment test: dm history', attachmentIds: [dmAttachment] });
    await db.query('INSERT INTO participant_blocks (blocker_id, blocked_id) VALUES ($1, $2)', [ids.peer, ids.reader]);
    const historical = await request(app)
      .get(`/api/direct-messages/threads/${ids.dm}/attachments/${dmAttachment}/access`)
      .set(as('reader'));
    expect(historical.status).toBe(200);
  });
});

describe('US-035 / #411 attachment HTTP gaps: degradation, expiry, scan-gating, disposition, and log privacy', () => {
  it('returns 503 ATTACHMENT_STORAGE_UNAVAILABLE on storage failure while plain-text chat keeps working', async () => {
    store.failNext.put = true;
    const failedUpload = await upload(publicUpload);
    expect(failedUpload.status).toBe(503);
    expect(failedUpload.body.code).toBe('ATTACHMENT_STORAGE_UNAVAILABLE');
    expect((await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM chat_message_attachments')).rows[0]!.n).toBe(0);

    const plainText = await request(app)
      .post(`/api/chat/channels/${ids.publicChannel}/messages`)
      .set(as('reader'))
      .send({ body: 'attachment test: plain text succeeds while storage down' });
    expect(plainText.status).toBe(201);

    const uploaded = await upload(publicUpload);
    expect(uploaded.status).toBe(201);
    const attachmentId = uploaded.body.attachment.id as string;
    const attached = await request(app)
      .post(`/api/chat/channels/${ids.publicChannel}/messages`)
      .set(as('reader'))
      .send({ body: 'attachment test: attached for read failure', attachmentIds: [attachmentId] });
    expect(attached.status).toBe(201);

    const access = await request(app)
      .get(`/api/chat/channels/${ids.publicChannel}/attachments/${attachmentId}/access`)
      .set(as('peer'));
    expect(access.status).toBe(200);

    store.failNext.get = true;
    const failedRead = await request(app).get(access.body.access.url as string);
    expect(failedRead.status).toBe(503);
    expect(failedRead.body.code).toBe('ATTACHMENT_STORAGE_UNAVAILABLE');
  });

  it('expires signed content URLs after 60 seconds and rejects tampered tokens with 404', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const baseTime = new Date('2026-11-12T12:00:00.000Z');
      vi.setSystemTime(baseTime);
      const authNow = Math.floor(baseTime.getTime() / 1000) - 30;
      mockVerifyIdToken.mockImplementation(async (token: string) => {
        const who = token.replace(/^token-/, '');
        return {
          uid: `fb-${who}`,
          role: who === 'admin' ? 'ADMIN' : 'PART',
          auth_time: authNow,
          [MFA_CLAIM]: authNow,
        } as unknown as DecodedIdToken;
      });

      const uploaded = await upload(publicUpload);
      const attachmentId = uploaded.body.attachment.id as string;
      await request(app)
        .post(`/api/chat/channels/${ids.publicChannel}/messages`)
        .set(as('reader'))
        .send({ body: 'attachment test: expiry check', attachmentIds: [attachmentId] });

      const access = await request(app)
        .get(`/api/chat/channels/${ids.publicChannel}/attachments/${attachmentId}/access`)
        .set(as('peer'));
      expect(access.status).toBe(200);
      const contentUrl = access.body.access.url as string;

      expect((await request(app).get(`${contentUrl}tampered`)).status).toBe(404);

      vi.setSystemTime(new Date(baseTime.getTime() + 61_000));
      const expired = await request(app).get(contentUrl);
      expect(expired.status).toBe(404);
      expect(expired.body.code).toBe('ATTACHMENT_NOT_FOUND');
    } finally {
      vi.useRealTimers();
    }
  });

  it('forces Content-Disposition attachment on PDFs, blocks non-downloadable scan states, and rejects suspended accounts', async () => {
    const pdfUpload = await upload(publicUpload, 'reader', SAMPLE_FILES.pdf);
    expect(pdfUpload.status).toBe(201);
    const pdfId = pdfUpload.body.attachment.id as string;
    await request(app)
      .post(`/api/chat/channels/${ids.publicChannel}/messages`)
      .set(as('reader'))
      .send({ body: 'attachment test: pdf', attachmentIds: [pdfId] });

    const pdfAccess = await request(app)
      .get(`/api/chat/channels/${ids.publicChannel}/attachments/${pdfId}/access`)
      .set(as('peer'));
    expect(pdfAccess.status).toBe(200);
    const pdfContent = await request(app).get(pdfAccess.body.access.url as string);
    expect(pdfContent.status).toBe(200);
    expect(pdfContent.headers['content-disposition']).toMatch(/^attachment;/);
    expect(pdfContent.headers['content-disposition']).toContain('brief.pdf');

    for (const scanStatus of ['pending', 'infected', 'scan_failed'] as const) {
      await db.query('UPDATE chat_message_attachments SET scan_status = $1 WHERE id = $2', [scanStatus, pdfId]);
      const listed = await request(app).get(`/api/chat/channels/${ids.publicChannel}/messages`).set(as('peer'));
      const msg = (listed.body.messages as Array<{ attachments?: Array<{ id: string; downloadable: boolean; scanStatus: string }> }>).find(
        (m) => m.attachments?.some((a) => a.id === pdfId)
      );
      expect(msg?.attachments?.[0]).toMatchObject({ id: pdfId, scanStatus, downloadable: false });

      const blockedAccess = await request(app)
        .get(`/api/chat/channels/${ids.publicChannel}/attachments/${pdfId}/access`)
        .set(as('peer'));
      expect(blockedAccess.status).toBe(403);
      expect(blockedAccess.body.code).toBe('ATTACHMENT_NOT_DOWNLOADABLE');

      const blockedContent = await request(app).get(pdfAccess.body.access.url as string);
      expect(blockedContent.status).toBe(404);
    }

    await suspendParticipant(db, ids.peer);
    const suspendedUpload = await upload(publicUpload, 'peer');
    expect(suspendedUpload.status).toBe(403);
    const suspendedAccess = await request(app)
      .get(`/api/chat/channels/${ids.publicChannel}/attachments/${pdfId}/access`)
      .set(as('peer'));
    expect(suspendedAccess.status).toBe(403);
  });

  it('never logs signed tokens, raw filenames, storage keys, or signed URLs via requestLogger', async () => {
    const lines: string[] = [];
    const spies = (['log', 'info', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      })
    );
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const secretNameFile = { name: 'secret-roster-leak-check.png', bytes: SAMPLE_FILES.png.bytes };
      const uploaded = await upload(publicUpload, 'reader', secretNameFile);
      expect(uploaded.status).toBe(201);
      const attachmentId = uploaded.body.attachment.id as string;
      const { rows } = await db.query<{ storage_key: string }>('SELECT storage_key FROM chat_message_attachments WHERE id = $1', [
        attachmentId,
      ]);
      const storageKey = rows[0]!.storage_key;

      await request(app)
        .post(`/api/chat/channels/${ids.publicChannel}/messages`)
        .set(as('reader'))
        .send({ body: 'attachment test: log check', attachmentIds: [attachmentId] });

      const access = await request(app)
        .get(`/api/chat/channels/${ids.publicChannel}/attachments/${attachmentId}/access`)
        .set(as('peer'));
      expect(access.status).toBe(200);
      const accessUrl = access.body.access.url as string;
      const rawToken = decodeURIComponent(accessUrl.split('token=')[1] ?? '');
      expect(rawToken.length).toBeGreaterThan(20);

      expect((await request(app).get(accessUrl)).status).toBe(200);

      const combinedLogs = lines.join('\n');
      expect(combinedLogs).toContain('/api/chat/attachments/content');
      expect(combinedLogs).not.toContain('secret-roster-leak-check.png');
      expect(combinedLogs).not.toContain(storageKey);
      expect(combinedLogs).not.toContain(rawToken);
      expect(combinedLogs).not.toContain(encodeURIComponent(rawToken));
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      spies.forEach((s) => s.mockRestore());
    }
  });
});

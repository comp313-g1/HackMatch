import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { createPgliteSupabaseClient } from '../db/pgliteSupabase.testUtils.js';
import { createChatReactionDb, reactionIds as ids, suspendParticipant, unsuspendParticipant } from '../db/chatReactions.testUtils.js';
import { participantBlockRepository } from '../db/participantBlock.repository.js';
import { notificationsRepository } from '../db/notifications.repository.js';
import { notificationHub } from '../services/notificationHub.js';
import { typingHub } from '../services/chatTyping.js';
import { _resetTypingRateLimiter } from '../middleware/richChatTyping.js';
import { _resetReactionRateLimiter } from '../services/reactionRateLimiter.js';
import { config } from '../config/index.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';

/**
 * US-035 / #407 — typing signals and typing SSE streams through the real HTTP stack.
 *
 * A real listening server (so SSE is read the way the browser client reads it:
 * fetch streaming with a bearer token) → Express auth chain → conversation guards →
 * typing access checks → in-memory hub → REAL repositories → PostgreSQL (PGlite)
 * with the chat, DM, block, presence, and reaction migrations.
 *
 * Mocked boundaries: Firebase token verification; the Supabase client is the PGlite
 * PostgREST adapter; participantBlockRepository.findBlockState runs the same query
 * directly because the adapter has no `.or()` filter.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESENCE_MIGRATION = path.resolve(__dirname, '../../../supabase/migrations/0042_add_participant_presence_status.sql');
const SECOND_PUBLIC = '60000000-0000-4000-8000-000000000002';

type Who = 'reader' | 'peer' | 'outsider' | 'admin' | 'lurker';
let db: PGlite;
let server: Server;
let base = '';
const authTime = Math.floor(Date.now() / 1000) - 30;
const openControllers: AbortController[] = [];

const auth = (who: Who) => ({ Authorization: `Bearer token-${who}` });

async function post(urlPath: string, who: Who | null, body: unknown = { typing: true }) {
  const response = await fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(who ? auth(who) : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
}

interface SseFrame {
  event: string;
  data: unknown;
  raw: string;
}

interface OpenedStream {
  status: number;
  body?: unknown;
  frames: SseFrame[];
  typing: () => SseFrame[];
  close: () => void;
}

async function openStream(urlPath: string, who: Who | null): Promise<OpenedStream> {
  const controller = new AbortController();
  openControllers.push(controller);
  const response = await fetch(`${base}${urlPath}`, { headers: who ? auth(who) : {}, signal: controller.signal });
  const frames: SseFrame[] = [];
  const result: OpenedStream = {
    status: response.status,
    frames,
    typing: () => frames.filter((f) => f.event === 'typing'),
    close: () => controller.abort(),
  };
  if (response.status !== 200) {
    result.body = await response.json().catch(() => null);
    return result;
  }
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const event = /^event: (.+)$/m.exec(raw)?.[1];
          const data = /^data: (.+)$/m.exec(raw)?.[1];
          if (event) frames.push({ event, data: data ? JSON.parse(data) : undefined, raw });
        }
      }
    } catch {
      // aborted
    }
  })();
  await vi.waitFor(() => expect(frames.some((f) => f.event === 'ready')).toBe(true));
  return result;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 75));

const paths = {
  publicSignal: (channel: string = ids.publicChannel) => `/api/chat/channels/${channel}/typing`,
  publicStream: (channel: string = ids.publicChannel) => `/api/chat/channels/${channel}/typing/stream`,
  teamSignal: (team: string = ids.team) => `/api/teams/${team}/chat/typing`,
  teamStream: (team: string = ids.team) => `/api/teams/${team}/chat/typing/stream`,
  dmSignal: (thread: string = ids.dm) => `/api/direct-messages/threads/${thread}/typing`,
  dmStream: (thread: string = ids.dm) => `/api/direct-messages/threads/${thread}/typing/stream`,
};

async function setPresence(who: string, status: 'Online' | 'Invisible'): Promise<void> {
  await db.query('UPDATE participants SET presence_status = $2 WHERE id = $1', [who, status]);
}

beforeAll(async () => {
  db = await createChatReactionDb();
  await db.exec(fs.readFileSync(PRESENCE_MIGRATION, 'utf8'));
  await db.query(
    "INSERT INTO chat_channels (id, title, description, created_by, channel_type) VALUES ($1, 'Second', 'Another public forum', $2, 'public')",
    [SECOND_PUBLIC, ids.peer]
  );
  holder.client = createPgliteSupabaseClient(db);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await db?.close();
});

beforeEach(async () => {
  config.richChat.typingEnabled = true;
  config.richChat.reactionsEnabled = false;
  typingHub._reset();
  _resetTypingRateLimiter();
  _resetReactionRateLimiter();
  await db.exec("DELETE FROM participant_blocks; UPDATE teams SET recruitment_status = 'Open';");
  for (const id of [ids.reader, ids.peer, ids.outsider, ids.lurker]) await setPresence(id, 'Online');
  await unsuspendParticipant(db, ids.peer);

  mockVerifyIdToken.mockImplementation(async (token: string) => {
    const who = token.replace(/^token-/, '');
    return { uid: `fb-${who}`, auth_time: authTime, [MFA_CLAIM]: authTime } as unknown as DecodedIdToken;
  });
  vi.spyOn(participantBlockRepository, 'findBlockState').mockImplementation(async (a: string, b: string) => {
    const { rows } = await db.query<{ blocker_id: string; blocked_id: string }>(
      `SELECT blocker_id, blocked_id FROM participant_blocks
       WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
      [a, b]
    );
    return {
      blockedByMe: rows.some((r) => r.blocker_id === a && r.blocked_id === b),
      blockedByThem: rows.some((r) => r.blocker_id === b && r.blocked_id === a),
    };
  });
});

afterEach(async () => {
  for (const controller of openControllers.splice(0)) controller.abort();
  await settle();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  typingHub._reset();
  config.richChat.typingEnabled = false;
});

describe('feature flag RICH_CHAT_TYPING_ENABLED and capabilities', () => {
  it('defaults to off unless the variable is exactly "true"', async () => {
    for (const value of ['', 'false', 'TRUE', '1']) {
      vi.stubEnv('RICH_CHAT_TYPING_ENABLED', value);
      vi.resetModules();
      expect((await import('../config/index.js')).config.richChat.typingEnabled, value).toBe(false);
    }
    vi.stubEnv('RICH_CHAT_TYPING_ENABLED', 'true');
    vi.resetModules();
    expect((await import('../config/index.js')).config.richChat.typingEnabled).toBe(true);
  });

  it('when off: signals and streams answer 404 FEATURE_DISABLED, and text chat still works', async () => {
    config.richChat.typingEnabled = false;
    for (const urlPath of [paths.publicSignal(), paths.teamSignal(), paths.dmSignal()]) {
      const response = await post(urlPath, 'reader');
      expect(response.status, urlPath).toBe(404);
      expect(response.body).toEqual({ error: 'This chat feature is not available.', code: 'FEATURE_DISABLED' });
    }
    for (const urlPath of [paths.publicStream(), paths.teamStream(), paths.dmStream()]) {
      expect((await openStream(urlPath, 'reader')).status, urlPath).toBe(404);
    }
    const sent = await post(`/api/chat/channels/${ids.publicChannel}/messages`, 'reader', { body: 'plain text still works' });
    expect(sent.status).toBe(201);
    await db.query('DELETE FROM chat_messages WHERE id = $1', [(sent.body as { message: { id: string } }).message.id]);
  });

  it('reports typing from the server flag; attachments and voice/video stay off', async () => {
    const on = await fetch(`${base}/api/chat/capabilities`, { headers: auth('reader') }).then((r) => r.json());
    expect(on.capabilities).toMatchObject({ typing: { enabled: true }, attachments: { enabled: false }, voiceVideo: false });
    config.richChat.typingEnabled = false;
    const off = await fetch(`${base}/api/chat/capabilities`, { headers: auth('reader') }).then((r) => r.json());
    expect(off.capabilities.typing).toEqual({ enabled: false });
  });
});

describe('who may signal and who may watch', () => {
  it('rejects visitors (401) and ADMIN accounts (403) for signals and streams', async () => {
    for (const urlPath of [paths.publicSignal(), paths.teamSignal(), paths.dmSignal()]) {
      expect((await post(urlPath, null)).status).toBe(401);
      expect((await post(urlPath, 'admin')).status).toBe(403);
    }
    for (const urlPath of [paths.publicStream(), paths.teamStream(), paths.dmStream()]) {
      expect((await openStream(urlPath, null)).status).toBe(401);
      expect((await openStream(urlPath, 'admin')).status).toBe(403);
    }
  });

  it('public: a private team channel id looks exactly like a missing channel', async () => {
    const hidden = await post(paths.publicSignal(ids.teamChannel), 'reader');
    const missing = await post(paths.publicSignal(ids.missing), 'reader');
    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual({ error: 'Chat channel not found.', code: 'CHANNEL_NOT_FOUND' });
    expect(missing.body).toEqual(hidden.body);
    expect((await openStream(paths.publicStream(ids.teamChannel), 'reader')).body).toEqual(hidden.body);
  });

  it('team: removed members and missing teams get the existing member-gate answer', async () => {
    const removed = await post(paths.teamSignal(), 'outsider');
    const missing = await post(paths.teamSignal(ids.missing), 'reader');
    expect(removed.status).toBe(403);
    expect(removed.body).toMatchObject({ code: 'FORBIDDEN_NOT_TEAM_MEMBER' });
    expect(missing.body).toEqual(removed.body);
    expect((await openStream(paths.teamStream(), 'outsider')).status).toBe(403);
  });

  it('team: a disbanded team is read-only for typing, but its history can still be watched', async () => {
    await db.query("UPDATE teams SET recruitment_status = 'Disbanded' WHERE id = $1", [ids.team]);
    const response = await post(paths.teamSignal(), 'reader');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'TEAM_CHANNEL_READ_ONLY' });
    expect((await openStream(paths.teamStream(), 'peer')).status).toBe(200);
  });

  it('DM: a foreign thread looks exactly like a missing one', async () => {
    const foreign = await post(paths.dmSignal(ids.otherDm), 'reader');
    const missing = await post(paths.dmSignal(ids.missing), 'reader');
    expect(foreign.status).toBe(403);
    expect(foreign.body).toMatchObject({ code: 'FORBIDDEN_NOT_THREAD_PARTICIPANT' });
    expect(missing.body).toEqual(foreign.body);
    expect((await openStream(paths.dmStream(ids.otherDm), 'reader')).status).toBe(403);
  });

  it('DM: a block in either direction stops typing signals and leaks nothing', async () => {
    const watcher = await openStream(paths.dmStream(), 'peer');
    await db.query('INSERT INTO participant_blocks (blocker_id, blocked_id) VALUES ($1, $2)', [ids.reader, ids.peer]);
    const blocker = await post(paths.dmSignal(), 'reader');
    const blocked = await post(paths.dmSignal(), 'peer');
    expect(blocker.status).toBe(403);
    expect(blocker.body).toMatchObject({ code: 'DM_BLOCKED_BY_YOU' });
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({ code: 'DM_PEER_UNAVAILABLE' });
    await settle();
    expect(watcher.typing()).toEqual([]);
  });

  it('refuses a suspended peer like sending does', async () => {
    await suspendParticipant(db, ids.peer);
    const response = await post(paths.dmSignal(), 'reader');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'DM_PEER_UNAVAILABLE' });
  });
});

describe('payload and identity', () => {
  it('accepts only { typing: boolean }: no draft, message, or identity fields', async () => {
    for (const body of [
      { typing: true, draft: 'secret plan' },
      { typing: true, message: 'x' },
      { typing: true, participantId: ids.peer },
      { typing: true, handle: 'peer_1' },
      { typing: 'yes' },
      {},
    ]) {
      const response = await post(paths.publicSignal(), 'reader', body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(JSON.stringify(response.body)).not.toMatch(/secret plan|peer_1/);
    }
  });

  it('never writes rejected draft text to the request log', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await post(paths.publicSignal(), 'reader', { typing: true, draft: 'TOP SECRET DRAFT' });
    await post(paths.publicSignal(), 'reader', { typing: true });
    await settle();
    const logged = log.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).toContain('/typing');
    expect(logged).not.toContain('TOP SECRET DRAFT');
  });

  it('derives the typist from the session and sends only the safe event fields', async () => {
    const watcher = await openStream(paths.publicStream(), 'peer');
    const before = Date.now();
    expect(await post(paths.publicSignal(), 'reader')).toMatchObject({ status: 200, body: { status: 'ok' } });
    await vi.waitFor(() => expect(watcher.typing()).toHaveLength(1));
    const event = watcher.typing()[0]!.data as Record<string, unknown>;
    expect(Object.keys(event).sort()).toEqual(['conversationId', 'conversationType', 'expiresAt', 'typing', 'typist']);
    expect(event).toMatchObject({
      conversationType: 'channel',
      conversationId: ids.publicChannel,
      typist: { handle: 'reader_1' },
      typing: true,
    });
    const expiresAt = Date.parse(event.expiresAt as string);
    expect(expiresAt - before).toBeGreaterThanOrEqual(5_900);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(6_000);
    expect(watcher.typing()[0]!.raw).not.toMatch(/reader@example|Full reader|fb-reader|10000000-0000/);
  });

  it('stops immediately on typing:false', async () => {
    const watcher = await openStream(paths.dmStream(), 'peer');
    await post(paths.dmSignal(), 'reader', { typing: true });
    await post(paths.dmSignal(), 'reader', { typing: false });
    await vi.waitFor(() => expect(watcher.typing().map((f) => (f.data as { typing: boolean }).typing)).toEqual([true, false]));
  });
});

describe('server-side recipient scoping (multi-subscriber security)', () => {
  it('delivers a team typing event only to authorized viewers of that one conversation', async () => {
    const teammate = await openStream(paths.teamStream(), 'peer');
    const senderOwnTab = await openStream(paths.teamStream(), 'reader');
    const otherTeam = await openStream(paths.teamStream(ids.otherTeam), 'outsider');
    const publicViewer = await openStream(paths.publicStream(), 'lurker');
    const dmViewer = await openStream(paths.dmStream(), 'peer');
    const notificationStream = await openStream('/api/notifications/stream', 'peer');
    const adminAttempts = await Promise.all([
      openStream(paths.teamStream(), 'admin'),
      openStream(paths.publicStream(), 'admin'),
      openStream(paths.dmStream(), 'admin'),
    ]);
    expect(adminAttempts.map((s) => s.status)).toEqual([403, 403, 403]);

    expect((await post(paths.teamSignal(), 'reader')).status).toBe(200);
    await vi.waitFor(() => expect(teammate.typing()).toHaveLength(1));
    await settle();

    expect(teammate.typing()[0]!.data).toMatchObject({
      conversationType: 'team',
      conversationId: ids.team,
      typist: { handle: 'reader_1' },
    });
    expect(senderOwnTab.typing()).toEqual([]);
    expect(otherTeam.typing()).toEqual([]);
    expect(publicViewer.typing()).toEqual([]);
    expect(dmViewer.typing()).toEqual([]);
    expect(notificationStream.frames.map((f) => f.event)).toEqual(['ready']);
  });

  it('stops delivering the very next event once a viewer loses access, with no grace window', async () => {
    const teamViewer = await openStream(paths.teamStream(), 'peer');
    const publicViewer = await openStream(paths.publicStream(), 'lurker');
    const dmViewer = await openStream(paths.dmStream(), 'peer');
    const publicControl = await openStream(paths.publicStream(), 'outsider');

    // Each viewer receives one event first, so any authorization result is as fresh as possible.
    await post(paths.teamSignal(), 'reader');
    await post(paths.publicSignal(), 'reader');
    await post(paths.dmSignal(), 'reader');
    await vi.waitFor(() => expect(teamViewer.typing()).toHaveLength(1));
    await vi.waitFor(() => expect(publicViewer.typing()).toHaveLength(1));
    await vi.waitFor(() => expect(dmViewer.typing()).toHaveLength(1));

    // Revoke read access immediately before the next event (well inside any 5 s window).
    await db.query("UPDATE team_memberships SET status = 'Removed' WHERE team_id = $1 AND participant_id = $2", [
      ids.team,
      ids.peer,
    ]);
    await suspendParticipant(db, ids.lurker);
    try {
      await post(paths.teamSignal(), 'reader');
      await post(paths.publicSignal(), 'reader');
      await vi.waitFor(() => expect(publicControl.typing()).toHaveLength(2)); // still-authorized viewer gets it
      await settle();
      expect(teamViewer.typing()).toHaveLength(1);
      expect(publicViewer.typing()).toHaveLength(1);
      expect(typingHub.subscriberCount({ conversationType: 'team', conversationId: ids.team })).toBe(0);

      // DM: when the viewer (the peer) loses read access, the sender also loses send access,
      // so no new event can be produced; the expiry stop is re-checked too (chatTyping.test.ts).
      await suspendParticipant(db, ids.peer);
      await unsuspendParticipant(db, ids.lurker);
      expect((await post(paths.dmSignal(), 'reader')).status).toBe(403);
      await settle();
      expect(dmViewer.typing()).toHaveLength(1);
    } finally {
      await db.query("UPDATE team_memberships SET status = 'Confirmed' WHERE team_id = $1 AND participant_id = $2", [
        ids.team,
        ids.peer,
      ]);
      await unsuspendParticipant(db, ids.lurker);
      await unsuspendParticipant(db, ids.peer);
    }
  });

  it('isolates public channels from each other and DM threads from each other', async () => {
    const first = await openStream(paths.publicStream(), 'peer');
    const second = await openStream(paths.publicStream(SECOND_PUBLIC), 'outsider');
    const dm = await openStream(paths.dmStream(), 'peer');
    const otherDm = await openStream(paths.dmStream(ids.otherDm), 'outsider');

    await post(paths.publicSignal(), 'reader');
    await post(paths.dmSignal(), 'reader');
    await vi.waitFor(() => expect(first.typing()).toHaveLength(1));
    await vi.waitFor(() => expect(dm.typing()).toHaveLength(1));
    await settle();
    expect(second.typing()).toEqual([]);
    expect(otherDm.typing()).toEqual([]);
  });

  it('keeps several typists independent and does not duplicate a repeated pulse', async () => {
    const watcher = await openStream(paths.publicStream(), 'outsider');
    await post(paths.publicSignal(), 'reader');
    await post(paths.publicSignal(), 'peer');
    await post(paths.publicSignal(), 'reader');
    await vi.waitFor(() => expect(watcher.typing()).toHaveLength(3));
    const active = typingHub.activeTypists({ conversationType: 'channel', conversationId: ids.publicChannel });
    expect(active.map((t) => t.participantId).sort()).toEqual([ids.reader, ids.peer].sort());
  });
});

describe('Invisible presence', () => {
  it('accepts an Invisible participant’s signal as a no-op and publishes nothing', async () => {
    const watcher = await openStream(paths.publicStream(), 'peer');
    await setPresence(ids.reader, 'Invisible');
    expect(await post(paths.publicSignal(), 'reader')).toMatchObject({ status: 200, body: { status: 'ok' } });
    await settle();
    expect(watcher.typing()).toEqual([]);
    expect(typingHub.activeTypists({ conversationType: 'channel', conversationId: ids.publicChannel })).toEqual([]);

    // Positive control: the same participant is published once visible again.
    await setPresence(ids.reader, 'Online');
    await post(paths.publicSignal(), 'reader');
    await vi.waitFor(() => expect(watcher.typing()).toHaveLength(1));
  });

  it('clears an active indicator when the participant turns Invisible', async () => {
    const watcher = await openStream(paths.publicStream(), 'peer');
    await post(paths.publicSignal(), 'reader');
    await setPresence(ids.reader, 'Invisible');
    await post(paths.publicSignal(), 'reader');
    await vi.waitFor(() => expect(watcher.typing().map((f) => (f.data as { typing: boolean }).typing)).toEqual([true, false]));
  });
});

describe('streams: disconnect and reconnect', () => {
  it('cleans up on disconnect and never replays earlier typing to a new stream', async () => {
    const first = await openStream(paths.publicStream(), 'peer');
    await post(paths.publicSignal(), 'reader');
    await vi.waitFor(() => expect(first.typing()).toHaveLength(1));
    first.close();
    await vi.waitFor(() => expect(typingHub.streamCount(ids.peer)).toBe(0));

    const second = await openStream(paths.publicStream(), 'peer');
    await settle();
    expect(second.typing()).toEqual([]);
    expect(second.frames.map((f) => f.raw).join('\n')).not.toMatch(/^id:/m);
  });
});

describe('rate limit: 40 typing signals per participant per rolling minute', () => {
  it('shares one bucket across conversation types and spares other users, text chat, and reactions', async () => {
    const signals = [paths.publicSignal(), paths.teamSignal(), paths.dmSignal()];
    for (let i = 0; i < 40; i += 1) {
      const response = await post(signals[i % 3]!, 'reader', { typing: i % 5 !== 4 });
      expect(response.status, `signal ${i + 1}`).toBe(200);
    }
    for (const urlPath of signals) {
      const limited = await post(urlPath, 'reader');
      expect(limited.status).toBe(429);
      expect(limited.body).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: expect.any(Number) });
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    }

    expect((await post(paths.publicSignal(), 'peer')).status).toBe(200);
    const text = await post(`/api/chat/channels/${ids.publicChannel}/messages`, 'reader', { body: 'text is not limited' });
    expect(text.status).toBe(201);
    await db.query('DELETE FROM chat_messages WHERE id = $1', [(text.body as { message: { id: string } }).message.id]);

    config.richChat.reactionsEnabled = true;
    const reaction = await fetch(`${base}/api/chat/channels/${ids.publicChannel}/messages/${ids.pub1}/reactions/heart`, {
      method: 'PUT',
      headers: auth('reader'),
    });
    expect(reaction.status).toBe(200);
    await db.exec('DELETE FROM chat_message_reactions');
  });

  it('does not charge requests rejected before the limiter (validation or flag off)', async () => {
    for (let i = 0; i < 45; i += 1) expect((await post(paths.publicSignal(), 'reader', { draft: 'x' })).status).toBe(400);
    expect((await post(paths.publicSignal(), 'reader')).status).toBe(200);
  });
});

describe('no persistence and no notification side effects', () => {
  it('writes nothing to any table and creates no notifications', async () => {
    const tables = (
      await db.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
      )
    ).rows.map((r) => r.table_name);
    const snapshot = async () => {
      const counts: Record<string, number> = {};
      for (const table of tables) {
        counts[table] = Number((await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0]!.n);
      }
      return counts;
    };
    const create = vi.spyOn(notificationsRepository, 'create');
    const publish = vi.spyOn(notificationHub, 'publish');
    const before = await snapshot();
    const watcher = await openStream(paths.teamStream(), 'peer');

    await post(paths.publicSignal(), 'reader');
    await post(paths.teamSignal(), 'reader');
    await post(paths.dmSignal(), 'reader');
    await post(paths.dmSignal(), 'reader', { typing: false });
    await vi.waitFor(() => expect(watcher.typing()).toHaveLength(1));

    expect(await snapshot()).toEqual(before);
    expect(create).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

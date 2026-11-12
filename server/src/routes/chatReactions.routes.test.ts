import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { PGlite } from '@electric-sql/pglite';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { createPgliteSupabaseClient } from '../db/pgliteSupabase.testUtils.js';
import {
  createChatReactionDb,
  reactionIds as ids,
  suspendParticipant,
  unsuspendParticipant,
} from '../db/chatReactions.testUtils.js';
import { CHAT_REACTIONS } from '../db/chatReactionModel.js';
import { participantBlockRepository } from '../db/participantBlock.repository.js';
import { notificationsRepository } from '../db/notifications.repository.js';
import { notificationHub } from '../services/notificationHub.js';
import { _resetReactionRateLimiter } from '../services/reactionRateLimiter.js';
import { config } from '../config/index.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';

/**
 * US-035 / #405 — message reactions through the real HTTP stack.
 *
 * HTTP (supertest) → Express auth chain (Firebase, MFA, active, PART, verified)
 * → conversation guards (public / confirmed team member / DM send access) →
 * reaction service → REAL repository code → PostgreSQL (PGlite) with the real
 * chat, DM, block, cursor, unread, mention, and 0067 reaction migrations.
 *
 * Mocked boundaries: Firebase token verification; the Supabase client is the
 * PGlite PostgREST adapter; participantBlockRepository.findBlockState runs the
 * same query directly because the adapter has no `.or()` filter.
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

let db: PGlite;
const authTime = Math.floor(Date.now() / 1000) - 30;
const as = (who: 'reader' | 'peer' | 'outsider' | 'admin' | 'lurker') => ({
  Authorization: `Bearer token-${who}`,
});

const publicPath = (message: string = ids.pub1, reaction: string = 'heart', channel: string = ids.publicChannel) =>
  `/api/chat/channels/${channel}/messages/${message}/reactions/${reaction}`;
const teamPath = (message: string = ids.team1, reaction: string = 'heart', team: string = ids.team) =>
  `/api/teams/${team}/chat/messages/${message}/reactions/${reaction}`;
const dmPath = (message: string = ids.dm1, reaction: string = 'heart', thread: string = ids.dm) =>
  `/api/direct-messages/threads/${thread}/messages/${message}/reactions/${reaction}`;

const reactionRowCount = async (): Promise<number> => {
  const channel = (await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM chat_message_reactions')).rows[0]!.n;
  const direct = (await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM direct_message_reactions')).rows[0]!.n;
  return Number(channel) + Number(direct);
};

beforeAll(async () => {
  db = await createChatReactionDb();
  holder.client = createPgliteSupabaseClient(db);
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  config.richChat.reactionsEnabled = true;
  _resetReactionRateLimiter();
  await db.exec('DELETE FROM chat_message_reactions; DELETE FROM direct_message_reactions; DELETE FROM participant_blocks;');
  await db.exec("UPDATE teams SET recruitment_status = 'Open'");
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  config.richChat.reactionsEnabled = false;
});

describe('feature flag RICH_CHAT_REACTIONS_ENABLED (server-authoritative)', () => {
  it('defaults to off when the variable is not exactly "true"', async () => {
    vi.resetModules();
    for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
      if (value === undefined) vi.stubEnv('RICH_CHAT_REACTIONS_ENABLED', undefined as unknown as string);
      else vi.stubEnv('RICH_CHAT_REACTIONS_ENABLED', value);
      vi.resetModules();
      const fresh = await import('../config/index.js');
      expect(fresh.config.richChat.reactionsEnabled, String(value)).toBe(false);
    }
    vi.stubEnv('RICH_CHAT_REACTIONS_ENABLED', 'true');
    vi.resetModules();
    expect((await import('../config/index.js')).config.richChat.reactionsEnabled).toBe(true);
    vi.unstubAllEnvs();
  });

  it('when off: every reaction route answers 404 FEATURE_DISABLED and writes nothing', async () => {
    config.richChat.reactionsEnabled = false;
    for (const [method, path] of [
      ['put', publicPath()],
      ['delete', publicPath()],
      ['put', teamPath()],
      ['delete', teamPath()],
      ['put', dmPath()],
      ['delete', dmPath()],
    ] as const) {
      const response = await request(app)[method](path).set(as('reader'));
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(response.body).toEqual({ error: 'This chat feature is not available.', code: 'FEATURE_DISABLED' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(await reactionRowCount()).toBe(0);
  });

  it('when off: text chat is unchanged and responses carry no reactions field', async () => {
    config.richChat.reactionsEnabled = false;
    await db.query("INSERT INTO chat_message_reactions (message_id, participant_id, reaction) VALUES ($1, $2, 'heart')", [
      ids.pub1,
      ids.peer,
    ]);

    const list = await request(app).get(`/api/chat/channels/${ids.publicChannel}/messages`).set(as('reader'));
    expect(list.status).toBe(200);
    expect(list.body.messages.length).toBeGreaterThan(0);
    for (const message of list.body.messages) expect(message).not.toHaveProperty('reactions');

    const team = await request(app).get(`/api/teams/${ids.team}/chat/messages`).set(as('reader'));
    expect(team.status).toBe(200);
    for (const message of team.body.messages) expect(message).not.toHaveProperty('reactions');

    const dm = await request(app).get(`/api/direct-messages/threads/${ids.dm}`).set(as('reader'));
    expect(dm.status).toBe(200);
    for (const message of dm.body.messages) expect(message).not.toHaveProperty('reactions');

    const sent = await request(app)
      .post(`/api/chat/channels/${ids.publicChannel}/messages`)
      .set(as('reader'))
      .send({ body: 'still plain text' });
    expect(sent.status).toBe(201);
    expect(sent.body.message).not.toHaveProperty('reactions');
  });
});

describe('GET /api/chat/capabilities', () => {
  it('reports reactions from the server flag and every unimplemented feature as off', async () => {
    const on = await request(app).get('/api/chat/capabilities').set(as('reader'));
    expect(on.status).toBe(200);
    expect(on.headers['cache-control']).toBe('no-store');
    expect(on.body.capabilities).toEqual({
      reactions: { enabled: true, allowedReactions: [...CHAT_REACTIONS] },
      typing: { enabled: false },
      attachments: { enabled: false },
      voiceVideo: false,
    });

    config.richChat.reactionsEnabled = false;
    const off = await request(app).get('/api/chat/capabilities').set(as('reader'));
    expect(off.body.capabilities).toEqual({
      reactions: { enabled: false },
      typing: { enabled: false },
      attachments: { enabled: false },
      voiceVideo: false,
    });
  });

  it('is only for chat-eligible accounts', async () => {
    expect((await request(app).get('/api/chat/capabilities')).status).toBe(401);
    expect((await request(app).get('/api/chat/capabilities').set(as('admin'))).status).toBe(403);
  });
});

describe('the approved reaction set at the API boundary', () => {
  it('accepts each of the eight approved codes', async () => {
    for (const code of CHAT_REACTIONS) {
      const response = await request(app).put(publicPath(ids.pub1, code)).set(as('reader'));
      expect(response.status, code).toBe(200);
    }
    const final = await request(app).put(publicPath(ids.pub1, 'heart')).set(as('reader'));
    expect(final.body.reactions.map((entry: { reaction: string }) => entry.reaction)).toEqual([...CHAT_REACTIONS]);
  });

  it('rejects anything else with the normal validation response', async () => {
    for (const bad of ['smile', 'THUMBS_UP', 'thumbs-up', encodeURIComponent('👍'), 'custom%3Aparrot']) {
      const response = await request(app).put(publicPath(ids.pub1, bad)).set(as('reader'));
      expect(response.status, bad).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.errors).toHaveProperty('reaction');
    }
    const badMessage = await request(app).put(publicPath('not-a-uuid')).set(as('reader'));
    expect(badMessage.status).toBe(400);
    expect(badMessage.body.errors).toHaveProperty('messageId');

    const badChannel = await request(app).put(publicPath(ids.pub1, 'heart', 'nope')).set(as('reader'));
    expect(badChannel.status).toBe(400);
    expect(await reactionRowCount()).toBe(0);
  });

  it('ignores any participant id the client tries to supply', async () => {
    const response = await request(app)
      .put(publicPath())
      .set(as('reader'))
      .send({ participantId: ids.peer, participant_id: ids.peer, reaction: 'sad' });
    expect(response.status).toBe(200);
    const stored = await db.query<{ participant_id: string; reaction: string }>(
      'SELECT participant_id, reaction FROM chat_message_reactions'
    );
    expect(stored.rows).toEqual([{ participant_id: ids.reader, reaction: 'heart' }]);
  });
});

describe('who may react', () => {
  it('rejects visitors (401) and ADMIN accounts (403) with no write', async () => {
    for (const path of [publicPath(), teamPath(), dmPath()]) {
      expect((await request(app).put(path)).status).toBe(401);
      expect((await request(app).put(path).set(as('admin'))).status).toBe(403);
      expect((await request(app).delete(path).set(as('admin'))).status).toBe(403);
    }
    expect(await reactionRowCount()).toBe(0);
  });
});

describe('public channel reactions', () => {
  it('adds and removes idempotently, returning the stored final state each time', async () => {
    const first = await request(app).put(publicPath()).set(as('reader'));
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body).toMatchObject({
      status: 'ok',
      messageId: ids.pub1,
      reaction: 'heart',
      reactedByMe: true,
      changed: true,
      reactions: [{ reaction: 'heart', count: 1, reactedByMe: true }],
    });

    const retry = await request(app).put(publicPath()).set(as('reader'));
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ reactedByMe: true, changed: false, reactions: first.body.reactions });

    const removed = await request(app).delete(publicPath()).set(as('reader'));
    expect(removed.body).toMatchObject({ reactedByMe: false, changed: true, reactions: [] });

    const removeAgain = await request(app).delete(publicPath()).set(as('reader'));
    expect(removeAgain.status).toBe(200);
    expect(removeAgain.body).toMatchObject({ reactedByMe: false, changed: false, reactions: [] });
  });

  it('settles concurrent identical adds on one stored reaction', async () => {
    const responses = await Promise.all([
      request(app).put(publicPath()).set(as('reader')),
      request(app).put(publicPath()).set(as('reader')),
      request(app).put(publicPath()).set(as('reader')),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(responses.filter((r) => r.body.changed === true)).toHaveLength(1);
    for (const r of responses) expect(r.body.reactedByMe).toBe(true);
    expect(await reactionRowCount()).toBe(1);

    const removes = await Promise.all([
      request(app).delete(publicPath()).set(as('reader')),
      request(app).delete(publicPath()).set(as('reader')),
    ]);
    expect(removes.filter((r) => r.body.changed === true)).toHaveLength(1);
    expect(await reactionRowCount()).toBe(0);
  });

  it('aggregates several participants, reports each viewer’s own state, and names no reactor', async () => {
    await request(app).put(publicPath(ids.pub1, 'eyes')).set(as('reader'));
    await request(app).put(publicPath(ids.pub1, 'heart')).set(as('reader'));
    await request(app).put(publicPath(ids.pub1, 'heart')).set(as('peer'));
    await request(app).put(publicPath(ids.pub1, 'heart')).set(as('lurker'));

    const readerView = await request(app).get(`/api/chat/channels/${ids.publicChannel}/messages`).set(as('reader'));
    const pub1 = readerView.body.messages.find((m: { id: string }) => m.id === ids.pub1);
    const pub2 = readerView.body.messages.find((m: { id: string }) => m.id === ids.pub2);
    // Approved order (heart before eyes), not insertion order.
    expect(pub1.reactions).toEqual([
      { reaction: 'heart', count: 3, reactedByMe: true },
      { reaction: 'eyes', count: 1, reactedByMe: true },
    ]);
    expect(pub2.reactions).toEqual([]);

    const peerView = await request(app).get(`/api/chat/channels/${ids.publicChannel}/messages`).set(as('peer'));
    expect(peerView.body.messages.find((m: { id: string }) => m.id === ids.pub1).reactions).toEqual([
      { reaction: 'heart', count: 3, reactedByMe: true },
      { reaction: 'eyes', count: 1, reactedByMe: false },
    ]);

    // The lurker authored nothing, so their id or handle could only leak through reactions.
    const text = JSON.stringify(peerView.body);
    expect(text).not.toContain(ids.lurker);
    expect(text).not.toContain('lurker_1');
    expect(text).not.toMatch(/lurker@example\.test|Full lurker/);
  });

  it('includes an explicit empty reaction list on a newly sent message', async () => {
    const sent = await request(app)
      .post(`/api/chat/channels/${ids.publicChannel}/messages`)
      .set(as('reader'))
      .send({ body: 'fresh message' });
    expect(sent.status).toBe(201);
    expect(sent.body.message.reactions).toEqual([]);
    await db.query('DELETE FROM chat_messages WHERE id = $1', [sent.body.message.id]);
  });

  it('gives a random id and a team message the same not-found answer', async () => {
    const random = await request(app).put(publicPath(ids.missing)).set(as('reader'));
    const teamMessage = await request(app).put(publicPath(ids.team1)).set(as('reader'));
    const otherTeamMessage = await request(app).put(publicPath(ids.other1)).set(as('reader'));
    expect(random.status).toBe(404);
    expect(random.body).toEqual({ error: 'Chat message not found.', code: 'MESSAGE_NOT_FOUND' });
    expect(teamMessage.body).toEqual(random.body);
    expect(otherTeamMessage.body).toEqual(random.body);
  });

  it('treats a private team channel id like a missing channel, as the message routes do', async () => {
    const hidden = await request(app).put(publicPath(ids.team1, 'heart', ids.teamChannel)).set(as('reader'));
    const missing = await request(app).put(publicPath(ids.pub1, 'heart', ids.missing)).set(as('reader'));
    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual({ error: 'Chat channel not found.', code: 'CHANNEL_NOT_FOUND' });
    expect(missing.body).toEqual(hidden.body);
    expect(await reactionRowCount()).toBe(0);
  });
});

describe('team channel reactions', () => {
  it('lets confirmed members react and shows the aggregate in the team message list', async () => {
    const added = await request(app).put(teamPath(ids.team1, 'check')).set(as('reader'));
    expect(added.status).toBe(200);
    expect(added.body.reactions).toEqual([{ reaction: 'check', count: 1, reactedByMe: true }]);

    const list = await request(app).get(`/api/teams/${ids.team}/chat/messages`).set(as('peer'));
    expect(list.status).toBe(200);
    expect(list.body.messages.find((m: { id: string }) => m.id === ids.team1).reactions).toEqual([
      { reaction: 'check', count: 1, reactedByMe: false },
    ]);
  });

  it('gives removed members, outsiders, and missing teams the existing member-gate answer', async () => {
    const removedMember = await request(app).put(teamPath()).set(as('outsider'));
    const missingTeam = await request(app).put(teamPath(ids.team1, 'heart', ids.missing)).set(as('reader'));
    expect(removedMember.status).toBe(403);
    expect(removedMember.body.code).toBe('FORBIDDEN_NOT_TEAM_MEMBER');
    expect(missingTeam.body).toEqual(removedMember.body);
    expect(await reactionRowCount()).toBe(0);
  });

  it('does not accept another team’s message under the caller’s own team', async () => {
    const foreign = await request(app).put(teamPath(ids.other1)).set(as('reader'));
    const publicMessage = await request(app).put(teamPath(ids.pub1)).set(as('reader'));
    const random = await request(app).put(teamPath(ids.missing)).set(as('reader'));
    expect(random.status).toBe(404);
    expect(foreign.body).toEqual(random.body);
    expect(publicMessage.body).toEqual(random.body);
    expect(await reactionRowCount()).toBe(0);
  });

  it('keeps a disbanded team’s channel read-only for reactions, as for messages', async () => {
    await db.query("UPDATE teams SET recruitment_status = 'Disbanded' WHERE id = $1", [ids.team]);
    for (const method of ['put', 'delete'] as const) {
      const response = await request(app)[method](teamPath()).set(as('reader'));
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('TEAM_CHANNEL_READ_ONLY');
    }
  });
});

describe('direct message reactions', () => {
  it('lets thread participants react and shows the aggregate in the thread', async () => {
    const added = await request(app).put(dmPath(ids.dm1, 'laugh')).set(as('reader'));
    expect(added.status).toBe(200);
    expect(added.body.reactions).toEqual([{ reaction: 'laugh', count: 1, reactedByMe: true }]);
    expect(added.body.privacy).toMatchObject({ presenceIncluded: false, contactDetailsIncluded: false });

    const thread = await request(app).get(`/api/direct-messages/threads/${ids.dm}`).set(as('peer'));
    expect(thread.body.messages[0].reactions).toEqual([{ reaction: 'laugh', count: 1, reactedByMe: false }]);
  });

  it('gives a foreign thread and a missing thread the same existing answer', async () => {
    const foreign = await request(app).put(dmPath(ids.otherDm1, 'heart', ids.otherDm)).set(as('reader'));
    const missing = await request(app).put(dmPath(ids.dm1, 'heart', ids.missing)).set(as('reader'));
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe('FORBIDDEN_NOT_THREAD_PARTICIPANT');
    expect(missing.body).toEqual(foreign.body);
  });

  it('does not accept another thread’s message under the caller’s own thread', async () => {
    const foreign = await request(app).put(dmPath(ids.otherDm1)).set(as('peer'));
    const random = await request(app).put(dmPath(ids.missing)).set(as('peer'));
    expect(random.status).toBe(404);
    expect(foreign.body).toEqual(random.body);
    expect(await reactionRowCount()).toBe(0);
  });

  it('blocks reaction changes in both directions with the existing send-denial codes', async () => {
    await request(app).put(dmPath()).set(as('reader'));
    await db.query('INSERT INTO participant_blocks (blocker_id, blocked_id) VALUES ($1, $2)', [ids.reader, ids.peer]);

    for (const method of ['put', 'delete'] as const) {
      const blocker = await request(app)[method](dmPath()).set(as('reader'));
      expect(blocker.status).toBe(403);
      expect(blocker.body.code).toBe('DM_BLOCKED_BY_YOU');
      const blocked = await request(app)[method](dmPath(ids.dm1, 'sad')).set(as('peer'));
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('DM_PEER_UNAVAILABLE');
    }
    // The existing reaction is untouched, and reading the conversation still works.
    expect(await reactionRowCount()).toBe(1);
    const thread = await request(app).get(`/api/direct-messages/threads/${ids.dm}`).set(as('peer'));
    expect(thread.status).toBe(200);
    expect(thread.body.messages[0].reactions).toEqual([{ reaction: 'heart', count: 1, reactedByMe: false }]);
  });

  it('refuses reactions when the peer is no longer eligible, like sending', async () => {
    await suspendParticipant(db, ids.peer);
    const response = await request(app).put(dmPath()).set(as('reader'));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('DM_PEER_UNAVAILABLE');
  });
});

describe('rate limit: 30 reaction mutations per participant per rolling minute', () => {
  it('shares one bucket across conversation types, counts no-op retries, and spares other callers and text chat', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-12T12:00:00Z') });
    const mutations = [
      () => request(app).put(publicPath()).set(as('reader')),
      () => request(app).put(publicPath()).set(as('reader')), // no-op retry still counts
      () => request(app).delete(publicPath()).set(as('reader')),
      () => request(app).put(teamPath()).set(as('reader')),
      () => request(app).delete(teamPath()).set(as('reader')),
      () => request(app).put(dmPath()).set(as('reader')),
    ];
    for (let i = 0; i < 30; i += 1) {
      const response = await mutations[i % mutations.length]!();
      expect(response.status, `request ${i + 1}`).toBe(200);
    }

    for (const path of [publicPath(), teamPath(), dmPath()]) {
      const limited = await request(app).put(path).set(as('reader'));
      expect(limited.status).toBe(429);
      expect(limited.body).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: expect.any(Number) });
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    }

    // Another participant has their own bucket; text chat is not limited by reactions.
    expect((await request(app).put(publicPath()).set(as('peer'))).status).toBe(200);
    const text = await request(app)
      .post(`/api/chat/channels/${ids.publicChannel}/messages`)
      .set(as('reader'))
      .send({ body: 'text still works' });
    expect(text.status).toBe(201);
    await db.query('DELETE FROM chat_messages WHERE id = $1', [text.body.message.id]);

    vi.setSystemTime(new Date('2026-11-12T12:01:01Z'));
    expect((await request(app).put(publicPath()).set(as('reader'))).status).toBe(200);
  });

  it('does not charge requests rejected before the limiter (validation, disabled flag)', async () => {
    for (let i = 0; i < 40; i += 1) {
      expect((await request(app).put(publicPath(ids.pub1, 'smile')).set(as('reader'))).status).toBe(400);
    }
    config.richChat.reactionsEnabled = false;
    for (let i = 0; i < 5; i += 1) await request(app).put(publicPath()).set(as('reader'));
    config.richChat.reactionsEnabled = true;
    expect((await request(app).put(publicPath()).set(as('reader'))).status).toBe(200);
  });
});

describe('no notification or unread side effects', () => {
  it('creates no notifications and leaves unread counts unchanged', async () => {
    const create = vi.spyOn(notificationsRepository, 'create');
    const publish = vi.spyOn(notificationHub, 'publish');
    const before = await request(app).get('/api/chat/unread-counts').set(as('peer'));
    expect(before.status).toBe(200);

    await request(app).put(publicPath(ids.pub1, 'party')).set(as('reader'));
    await request(app).put(teamPath(ids.team1, 'party')).set(as('reader'));
    await request(app).put(dmPath(ids.dm1, 'party')).set(as('reader'));
    await request(app).delete(dmPath(ids.dm1, 'party')).set(as('reader'));

    expect(create).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    const after = await request(app).get('/api/chat/unread-counts').set(as('peer'));
    expect(after.body).toEqual(before.body);
  });
});

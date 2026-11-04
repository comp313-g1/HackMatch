/**
 * US-021 / #204 — cross-layer integration: notification CREATION and READING.
 *
 * Wires the real service, hub, SSE stream, Realtime bridge, Express routes and
 * Firebase-auth middleware together. Only the database is replaced by a stateful
 * in-memory stand-in that mirrors the SQL semantics (owner-scoped RPCs, derived
 * category, newest-first keyset order). The SQL itself is covered by
 * migration.test.ts and the gated notifications*.db.integration.test.ts suites.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import {
  notificationsRepository,
  type INotificationFeedRepository,
  type INotificationsRepository,
} from '../db/notifications.repository.js';
import { notificationCategoryForType } from '../db/notificationModel.js';
import { notificationHub } from '../services/notificationHub.js';
import {
  notify,
  notifyEventVerificationOutcome,
  resetDeliveryMemory,
  NotificationServiceError,
} from '../services/notifications.js';
import { startNotificationRealtimeBridge } from '../services/notificationRealtime.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { Participant, ParticipantNotification } from '../db/types.js';

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

// ---------------------------------------------------------------------------
// Participants and auth
// ---------------------------------------------------------------------------
const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;

function makeParticipant(name: string, id: string): Participant {
  return {
    id,
    firebase_uid: `fb-${name}`,
    email: `${name}@example.com`,
    full_name: name,
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-21T00:00:00.000Z',
    updated_at: '2026-10-21T00:00:00.000Z',
  };
}

const ALICE = makeParticipant('alice', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const BOB = makeParticipant('bob', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const BY_UID: Record<string, Participant> = { [ALICE.firebase_uid]: ALICE, [BOB.firebase_uid]: BOB };
const A = 'Bearer alice';
const B = 'Bearer bob';

// ---------------------------------------------------------------------------
// Stateful in-memory stand-in for participant_notifications + its RPCs
// ---------------------------------------------------------------------------
function createMemoryDb(options: { fixedCreatedAt?: string } = {}) {
  const rows: ParticipantNotification[] = [];
  let tick = 0;

  const byNewest = (a: ParticipantNotification, b: ParticipantNotification) =>
    a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1;

  const unread = (pid: string) => rows.filter((r) => r.participant_id === pid && !r.read_at).length;

  const repo: INotificationsRepository & INotificationFeedRepository = {
    async create(dto) {
      const row: ParticipantNotification = {
        id: crypto.randomUUID(),
        participant_id: dto.participant_id,
        team_id: dto.team_id ?? null,
        event_id: dto.event_id ?? null,
        request_id: dto.request_id ?? null,
        submission_id: dto.submission_id ?? null,
        type: dto.type,
        // SQL trigger trigger_participant_notifications_category derives this.
        category: notificationCategoryForType(dto.type),
        message: dto.message,
        created_at:
          options.fixedCreatedAt ??
          new Date(Date.UTC(2026, 10, 3, 10, 0, 0) + tick++ * 1000).toISOString(),
        read_at: null,
      };
      rows.push(row);
      return row;
    },
    async countUnread(pid) {
      return unread(pid);
    },
    async listForParticipant(pid, o) {
      let out = rows.filter((r) => r.participant_id === pid);
      if (o.unreadOnly) out = out.filter((r) => !r.read_at);
      if (o.category) out = out.filter((r) => r.category === o.category);
      out = [...out].sort(byNewest);
      if (o.cursor) {
        const { createdAt, id } = o.cursor;
        out = out.filter(
          (r) => r.created_at < createdAt || (r.created_at === createdAt && r.id < id)
        );
      }
      return out.slice(0, o.limit);
    },
    async markRead(pid, id) {
      const row = rows.find((r) => r.id === id && r.participant_id === pid);
      if (!row) throw { message: 'NOTIFICATION_NOT_FOUND', code: 'P0001' };
      const alreadyRead = row.read_at != null;
      if (!alreadyRead) row.read_at = new Date().toISOString();
      return { notification: { ...row }, alreadyRead, unreadCount: unread(pid) };
    },
    async markAllRead(pid) {
      let markedCount = 0;
      for (const r of rows) {
        if (r.participant_id === pid && !r.read_at) {
          r.read_at = new Date().toISOString();
          markedCount += 1;
        }
      }
      return { markedCount, unreadCount: unread(pid) };
    },
  };
  return { rows, repo };
}

function installDb(db: ReturnType<typeof createMemoryDb>) {
  for (const method of ['create', 'countUnread', 'listForParticipant', 'markRead', 'markAllRead'] as const) {
    vi.spyOn(notificationsRepository, method).mockImplementation(
      ((...args: unknown[]) =>
        (db.repo[method] as (...a: unknown[]) => unknown)(...args)) as never
    );
  }
}

// ---------------------------------------------------------------------------
// Live SSE client over a real HTTP connection
// ---------------------------------------------------------------------------
interface LiveStream {
  text: () => string;
  events: () => Array<{ notification: { id: string; type: string; category: string }; unreadCount: number }>;
  close: () => void;
  status: number;
}

describe('Notification creation + reading, end to end (US-021 / #204)', () => {
  let server: Server;
  let port: number;
  let db: ReturnType<typeof createMemoryDb>;
  const openStreams: LiveStream[] = [];

  beforeAll(() => {
    server = app.listen(0);
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  });

  function openStream(auth: string): Promise<LiveStream> {
    return new Promise((resolve, reject) => {
      const chunks: string[] = [];
      const req = http.get(
        { port, path: '/api/notifications/stream', headers: { Authorization: auth } },
        (res) => {
          res.setEncoding('utf8');
          res.on('data', (c: string) => chunks.push(c));
          const stream: LiveStream = {
            status: res.statusCode ?? 0,
            text: () => chunks.join(''),
            events: () =>
              [...chunks.join('').matchAll(/event: notification\ndata: (.*)\n\n/g)].map((m) =>
                JSON.parse(m[1])
              ),
            close: () => req.destroy(),
          };
          openStreams.push(stream);
          if (res.statusCode === 200) {
            void vi.waitFor(() => expect(stream.text()).toContain('event: ready')).then(() => resolve(stream));
          } else {
            resolve(stream);
          }
        }
      );
      req.on('error', reject);
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    resetDeliveryMemory();
    db = createMemoryDb();
    installDb(db);

    mockVerifyIdToken.mockImplementation(async (token: string) => {
      const who = token === 'alice' ? ALICE : token === 'bob' ? BOB : null;
      if (!who) throw { code: 'auth/argument-error' };
      return {
        uid: who.firebase_uid,
        email: who.email,
        role: 'PART',
        auth_time: AUTH_TIME,
        [MFA_CLAIM]: AUTH_TIME,
      } as unknown as DecodedIdToken;
    });
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockImplementation(
      async (uid: string) => BY_UID[uid] ?? null
    );
    vi.spyOn(participantsRepository, 'findById').mockImplementation(
      async (id: string) => Object.values(BY_UID).find((p) => p.id === id) ?? null
    );
  });

  afterEach(async () => {
    openStreams.splice(0).forEach((s) => s.close());
    await vi.waitFor(() => {
      expect(notificationHub.subscriberCount(ALICE.id)).toBe(0);
      expect(notificationHub.subscriberCount(BOB.id)).toBe(0);
    });
  });

  const list = (auth: string, qs = '') => request(app).get(`/api/notifications${qs}`).set('Authorization', auth);

  // -------------------------------------------------------------------------
  describe('happy path: create -> see it -> read it', () => {
    it('an event-verification alert created by the service appears in the recipient\'s feed, unread', async () => {
      const created = await notifyEventVerificationOutcome({
        participantId: ALICE.id,
        submissionId: '99999999-9999-4999-8999-999999999999',
        eventId: '88888888-8888-4888-8888-888888888888',
        outcome: 'approved',
        eventTitle: 'HackFest',
      });

      const res = await list(A);
      expect(res.status).toBe(200);
      expect(res.body.unreadCount).toBe(1);
      expect(res.body.notifications).toHaveLength(1);
      expect(res.body.notifications[0]).toMatchObject({
        id: created.id,
        type: 'event_verification_approved',
        category: 'event_verification',
        submissionId: '99999999-9999-4999-8999-999999999999',
        eventId: '88888888-8888-4888-8888-888888888888',
        readAt: null,
      });
      expect(res.body.notifications[0].message).toContain('HackFest');
    });

    it('reading: mark one read, then mark all read, counts stay accurate at every step', async () => {
      const ids: string[] = [];
      for (const type of ['team_invitation', 'team_application_approved', 'TEAM_ROSTER_LOCKED']) {
        ids.push((await notify({ participantId: ALICE.id, type, message: `msg ${type}` })).id);
      }
      expect((await list(A)).body.unreadCount).toBe(3);

      const one = await request(app).patch(`/api/notifications/${ids[0]}/read`).set('Authorization', A);
      expect(one.body).toMatchObject({ alreadyRead: false, unreadCount: 2 });

      const unreadOnly = await list(A, '?unread=true');
      expect(unreadOnly.body.notifications.map((n: { id: string }) => n.id)).not.toContain(ids[0]);
      expect(unreadOnly.body.notifications).toHaveLength(2);

      const all = await request(app).post('/api/notifications/read-all').set('Authorization', A);
      expect(all.body).toEqual({ status: 'ok', markedCount: 2, unreadCount: 0 });

      const after = await list(A);
      expect(after.body.unreadCount).toBe(0);
      expect(after.body.notifications.every((n: { readAt: string | null }) => n.readAt)).toBe(true);

      // A new alert after everything was read is unread again.
      await notify({ participantId: ALICE.id, type: 'team_invitation', message: 'again' });
      expect((await list(A)).body.unreadCount).toBe(1);
    });

    it('the feed groups categories correctly for every story alert type', async () => {
      const types = [
        'team_invitation',
        'team_application_submitted',
        'team_application_approved',
        'team_application_declined',
        'TEAM_ROSTER_LOCKED',
        'event_verification_approved',
      ];
      for (const type of types) await notify({ participantId: ALICE.id, type, message: type });
      const res = await list(A, '?limit=50');
      const byType = Object.fromEntries(
        res.body.notifications.map((n: { type: string; category: string }) => [n.type, n.category])
      );
      expect(byType).toEqual({
        team_invitation: 'invitation',
        team_application_submitted: 'application',
        team_application_approved: 'decision',
        team_application_declined: 'decision',
        TEAM_ROSTER_LOCKED: 'roster',
        event_verification_approved: 'event_verification',
      });
      const roster = await list(A, '?category=roster');
      expect(roster.body.notifications.map((n: { type: string }) => n.type)).toEqual(['TEAM_ROSTER_LOCKED']);
    });
  });

  // -------------------------------------------------------------------------
  describe('live delivery matches what is stored', () => {
    it('pushes a created alert to the recipient\'s open stream only, with the real unread count', async () => {
      const alice = await openStream(A);
      const bob = await openStream(B);
      await notify({ participantId: ALICE.id, type: 'team_invitation', message: 'for alice' });
      await notify({ participantId: ALICE.id, type: 'team_application_approved', message: 'second' });

      await vi.waitFor(() => expect(alice.events()).toHaveLength(2));
      expect(alice.events().map((e) => e.unreadCount)).toEqual([1, 2]);
      expect(bob.events()).toHaveLength(0);

      const feed = await list(A);
      const pushedIds = alice.events().map((e) => e.notification.id).sort();
      expect(feed.body.notifications.map((n: { id: string }) => n.id).sort()).toEqual(pushedIds);
    });

    it('delivers rows written by a SQL lifecycle function through the Realtime bridge', async () => {
      let onInsert: ((p: { new: unknown }) => void) | undefined;
      const channel = {
        on: vi.fn((_t: string, _f: unknown, cb: (p: { new: unknown }) => void) => {
          onInsert = cb;
          return channel;
        }),
        subscribe: vi.fn(() => channel),
      };
      const client = { channel: vi.fn(() => channel), removeChannel: vi.fn() } as unknown as SupabaseClient;
      const bridge = startNotificationRealtimeBridge({ client });

      const alice = await openStream(A);
      // A SQL function inserts the row directly (Node never calls notify()).
      const row = await db.repo.create({
        participant_id: ALICE.id,
        type: 'team_application_submitted',
        message: 'New application from SQL',
      });
      onInsert?.({ new: row });

      await vi.waitFor(() => expect(alice.events()).toHaveLength(1));
      expect(alice.events()[0]).toMatchObject({
        notification: { id: row.id, category: 'application' },
        unreadCount: 1,
      });
      // Delivered once even if the bridge replays the same insert.
      onInsert?.({ new: row });
      await new Promise((r) => setTimeout(r, 30));
      expect(alice.events()).toHaveLength(1);
      expect((await list(A)).body.notifications[0].id).toBe(row.id);
      await bridge.stop();
    });

    it('a read made over REST is reflected in the next pushed unread count', async () => {
      const alice = await openStream(A);
      const first = await notify({ participantId: ALICE.id, type: 'team_invitation', message: 'one' });
      await vi.waitFor(() => expect(alice.events()).toHaveLength(1));

      await request(app).patch(`/api/notifications/${first.id}/read`).set('Authorization', A);
      await notify({ participantId: ALICE.id, type: 'team_invitation', message: 'two' });

      await vi.waitFor(() => expect(alice.events()).toHaveLength(2));
      expect(alice.events()[1].unreadCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('unauthorized access and isolation', () => {
    it('another participant cannot see, mark, or bulk-mark someone else\'s alerts', async () => {
      const mine = await notify({ participantId: ALICE.id, type: 'team_invitation', message: 'private' });

      expect((await list(B)).body).toMatchObject({ notifications: [], unreadCount: 0 });
      const intruder = await request(app).patch(`/api/notifications/${mine.id}/read`).set('Authorization', B);
      expect(intruder.status).toBe(404);
      const bulk = await request(app).post('/api/notifications/read-all').set('Authorization', B);
      expect(bulk.body).toEqual({ status: 'ok', markedCount: 0, unreadCount: 0 });

      const feed = await list(A);
      expect(feed.body.unreadCount).toBe(1);
      expect(feed.body.notifications[0].readAt).toBeNull();
    });

    it('rejects unauthenticated and bad-token callers on every route without exposing content', async () => {
      const mine = await notify({ participantId: ALICE.id, type: 'team_invitation', message: 'secret text' });
      const calls = [
        request(app).get('/api/notifications'),
        request(app).patch(`/api/notifications/${mine.id}/read`),
        request(app).post('/api/notifications/read-all'),
        request(app).get('/api/notifications').set('Authorization', 'Bearer forged'),
      ];
      for (const call of calls) {
        const res = await call;
        expect(res.status).toBe(401);
        expect(JSON.stringify(res.body)).not.toContain('secret text');
      }
      const stream = await openStream('Bearer forged');
      expect(stream.status).toBe(401);
      expect((await list(A)).body.notifications[0].readAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('boundary conditions', () => {
    it('pages through 45 alerts with identical timestamps without gaps or duplicates', async () => {
      db = createMemoryDb({ fixedCreatedAt: '2026-11-03T10:00:00.000000+00:00' });
      installDb(db);
      for (let i = 0; i < 45; i++) {
        await notify({ participantId: ALICE.id, type: 'team_invitation', message: `n${i}` });
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res = await list(A, `?limit=20${cursor ? `&cursor=${cursor}` : ''}`);
        expect(res.status).toBe(200);
        seen.push(...res.body.notifications.map((n: { id: string }) => n.id));
        cursor = res.body.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);

      expect(pages).toBe(3);
      expect(seen).toHaveLength(45);
      expect(new Set(seen).size).toBe(45);
      expect(seen).toEqual([...seen].sort().reverse()); // id tiebreak keeps a stable order
    });

    it('accepts a 500-character message and a 50-character type; rejects one more', async () => {
      const ok = await notify({
        participantId: ALICE.id,
        type: 'x'.repeat(50),
        message: 'm'.repeat(500),
      });
      expect((await list(A)).body.notifications[0]).toMatchObject({ id: ok.id });
      expect((await list(A)).body.notifications[0].message).toHaveLength(500);

      await expect(
        notify({ participantId: ALICE.id, type: 't', message: 'm'.repeat(501) })
      ).rejects.toBeInstanceOf(NotificationServiceError);
      await expect(
        notify({ participantId: ALICE.id, type: 'x'.repeat(51), message: 'm' })
      ).rejects.toBeInstanceOf(NotificationServiceError);
      expect(db.rows).toHaveLength(1);
    });

    it('trims message whitespace and refuses whitespace-only input', async () => {
      const created = await notify({ participantId: ALICE.id, type: 'team_invitation', message: '  hi  ' });
      expect(created.message).toBe('hi');
      await expect(
        notify({ participantId: ALICE.id, type: 'team_invitation', message: '   ' })
      ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    });
  });

  // -------------------------------------------------------------------------
  describe('invalid input and failure handling', () => {
    it('invalid creation input stores nothing and pushes nothing', async () => {
      const alice = await openStream(A);
      await expect(
        notify({ participantId: '', type: '', message: '' })
      ).rejects.toMatchObject({
        status: 400,
        fieldErrors: { participantId: expect.any(String), type: expect.any(String), message: expect.any(String) },
      });
      expect(db.rows).toHaveLength(0);
      await new Promise((r) => setTimeout(r, 30));
      expect(alice.events()).toHaveLength(0);
    });

    it('a failed insert leaves the feed and the live stream untouched, and a retry works', async () => {
      const alice = await openStream(A);
      vi.spyOn(notificationsRepository, 'create').mockRejectedValueOnce(new Error('db down'));

      await expect(
        notify({ participantId: ALICE.id, type: 'team_invitation', message: 'lost' })
      ).rejects.toThrow('db down');
      expect((await list(A)).body).toMatchObject({ notifications: [], unreadCount: 0 });
      expect(alice.events()).toHaveLength(0);

      installDb(db);
      await notify({ participantId: ALICE.id, type: 'team_invitation', message: 'retry' });
      await vi.waitFor(() => expect(alice.events()).toHaveLength(1));
      expect((await list(A)).body.notifications).toHaveLength(1);
    });

    it('a live-delivery failure never fails or loses a committed notification', async () => {
      await openStream(A);
      vi.spyOn(notificationsRepository, 'countUnread').mockRejectedValueOnce(new Error('count failed'));

      const created = await notify({ participantId: ALICE.id, type: 'team_invitation', message: 'kept' });
      expect(created.message).toBe('kept');

      installDb(db); // restore the working count
      expect((await list(A)).body.notifications.map((n: { id: string }) => n.id)).toEqual([created.id]);
    });

    it('a failed mark-read changes nothing and can be retried', async () => {
      const row = await notify({ participantId: ALICE.id, type: 'team_invitation', message: 'x' });
      vi.spyOn(notificationsRepository, 'markRead').mockRejectedValueOnce(new Error('rpc timeout'));

      const failed = await request(app).patch(`/api/notifications/${row.id}/read`).set('Authorization', A);
      expect(failed.status).toBe(500);
      expect((await list(A)).body.unreadCount).toBe(1);

      installDb(db);
      const retried = await request(app).patch(`/api/notifications/${row.id}/read`).set('Authorization', A);
      expect(retried.body).toMatchObject({ alreadyRead: false, unreadCount: 0 });
    });
  });
});

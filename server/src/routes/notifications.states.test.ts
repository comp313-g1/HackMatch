/**
 * US-021 / #203 — empty, read, and permission states for the notification API.
 *
 * Repeatable evidence matrix (run with `npm run test:us021` or this file alone):
 *   1. Permission states  — every route x every denied caller, and no data is touched.
 *   2. Empty states       — nothing to list / nothing unread / nothing to mark.
 *   3. Read states        — unread -> read, idempotency, mixed feeds, mark-all.
 *   4. Invalid input      — query, cursor, id, and body validation (no data touched).
 *   5. Boundary conditions— limits, cursor size, id format edges.
 *   6. Failure handling   — database/RPC failures are explicit and never leak details.
 */
import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import {
  notificationsRepository,
  type INotificationFeedRepository,
  type INotificationsRepository,
} from '../db/notifications.repository.js';
import { encodeNotificationCursor } from '../services/notifications.js';
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

const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;
const OWN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOTIFICATION_ID = '11111111-1111-4111-8111-111111111111';
const AUTH = 'Bearer valid-mfa-token';
const CREATED = '2026-11-03T10:00:00.123456+00:00';

function row(overrides: Partial<ParticipantNotification> = {}): ParticipantNotification {
  return {
    id: NOTIFICATION_ID,
    participant_id: OWN_ID,
    team_id: null,
    event_id: null,
    request_id: null,
    submission_id: null,
    type: 'team_invitation',
    category: 'invitation',
    message: 'You received an invitation.',
    created_at: CREATED,
    read_at: null,
    ...overrides,
  };
}

const participant: Participant = {
  id: OWN_ID,
  firebase_uid: 'fb-verified-1',
  email: 'part@example.com',
  full_name: 'Verified Participant',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  created_at: '2026-10-21T00:00:00.000Z',
  updated_at: '2026-10-21T00:00:00.000Z',
};

const decoded = (extra: Record<string, unknown> = {}) =>
  ({
    uid: 'fb-verified-1',
    email: 'part@example.com',
    role: 'PART',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
    ...extra,
  }) as unknown as DecodedIdToken;

/** Every notification route, so each denial scenario is proven on all of them. */
const ROUTES: Array<{ name: string; call: (auth?: string) => request.Test }> = [
  {
    name: 'GET /api/notifications',
    call: (a) => withAuth(request(app).get('/api/notifications'), a),
  },
  {
    name: 'GET /api/notifications/stream',
    call: (a) => withAuth(request(app).get('/api/notifications/stream'), a),
  },
  {
    name: 'PATCH /api/notifications/:id/read',
    call: (a) => withAuth(request(app).patch(`/api/notifications/${NOTIFICATION_ID}/read`), a),
  },
  {
    name: 'POST /api/notifications/read-all',
    call: (a) => withAuth(request(app).post('/api/notifications/read-all'), a),
  },
];

function withAuth(req: request.Test, auth?: string): request.Test {
  return auth ? req.set('Authorization', auth) : req;
}

describe('Notification API states (US-021 / #203)', () => {
  let list: MockInstance<INotificationFeedRepository['listForParticipant']>;
  let count: MockInstance<INotificationsRepository['countUnread']>;
  let markRead: MockInstance<INotificationFeedRepository['markRead']>;
  let markAll: MockInstance<INotificationFeedRepository['markAllRead']>;

  const expectNoDataAccess = () => {
    expect(list).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();
    expect(markAll).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockVerifyIdToken.mockResolvedValue(decoded());
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(participant);
    list = vi.spyOn(notificationsRepository, 'listForParticipant').mockResolvedValue([]);
    count = vi.spyOn(notificationsRepository, 'countUnread').mockResolvedValue(0);
    markRead = vi.spyOn(notificationsRepository, 'markRead').mockResolvedValue({
      notification: row({ read_at: '2026-11-03T12:00:00+00:00' }),
      alreadyRead: false,
      unreadCount: 0,
    });
    markAll = vi
      .spyOn(notificationsRepository, 'markAllRead')
      .mockResolvedValue({ markedCount: 0, unreadCount: 0 });
  });

  // ---------------------------------------------------------------------------
  describe('1. Permission states (every route, no data touched)', () => {
    describe.each(ROUTES)('$name', ({ call }) => {
      it('401 UNAUTHORIZED without credentials', async () => {
        const res = await call();
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('UNAUTHORIZED');
        expectNoDataAccess();
      });

      it('401 UNAUTHORIZED for a malformed Authorization header', async () => {
        for (const header of ['Bearer', 'Basic abc123', 'bearer', 'Token xyz']) {
          const res = await call(header);
          expect(res.status).toBe(401);
        }
        expectNoDataAccess();
      });

      it('401 INVALID_TOKEN for a token Firebase rejects', async () => {
        mockVerifyIdToken.mockRejectedValue({ code: 'auth/argument-error' });
        const res = await call(AUTH);
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('INVALID_TOKEN');
        expectNoDataAccess();
      });

      it('401 TOKEN_EXPIRED for an expired token', async () => {
        mockVerifyIdToken.mockRejectedValue({ code: 'auth/id-token-expired' });
        const res = await call(AUTH);
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('TOKEN_EXPIRED');
        expectNoDataAccess();
      });

      it('401 TOKEN_REVOKED for a revoked token', async () => {
        mockVerifyIdToken.mockRejectedValue({ code: 'auth/id-token-revoked' });
        const res = await call(AUTH);
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('TOKEN_REVOKED');
        expectNoDataAccess();
      });

      it('403 MFA_REQUIRED when the email code step is not completed', async () => {
        mockVerifyIdToken.mockResolvedValue(
          decoded({ [MFA_CLAIM]: undefined })
        );
        const res = await call(AUTH);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('MFA_REQUIRED');
        expectNoDataAccess();
      });

      it('403 MFA_REQUIRED when the MFA claim belongs to an older sign-in', async () => {
        mockVerifyIdToken.mockResolvedValue(decoded({ [MFA_CLAIM]: AUTH_TIME - 500 }));
        const res = await call(AUTH);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('MFA_REQUIRED');
        expectNoDataAccess();
      });

      it('403 ACCOUNT_SUSPENDED for a suspended account', async () => {
        vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
          ...participant,
          is_suspended: true,
        });
        const res = await call(AUTH);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
        expectNoDataAccess();
      });

      it('403 EMAIL_NOT_VERIFIED for an unverified account', async () => {
        vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
          ...participant,
          is_verified: false,
        });
        const res = await call(AUTH);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
        expectNoDataAccess();
      });

      it('403 for an ADMIN account (admins have no participant notifications)', async () => {
        mockVerifyIdToken.mockResolvedValue(decoded({ role: 'ADMIN' }));
        vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
          ...participant,
          role: 'ADMIN',
        });
        const res = await call(AUTH);
        expect(res.status).toBe(403);
        expectNoDataAccess();
      });

      it('403 when the role claim is missing or not a participant role', async () => {
        mockVerifyIdToken.mockResolvedValue(decoded({ role: undefined }));
        vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
          ...participant,
          role: 'ADMIN',
        });
        const res = await call(AUTH);
        expect(res.status).toBe(403);
        expectNoDataAccess();
      });

      it('denials never leak notification content', async () => {
        const res = await call();
        expect(JSON.stringify(res.body)).not.toMatch(/invitation|notifications"|unreadCount/i);
      });
    });

    it('uses the session participant and ignores any participant id sent by the client', async () => {
      list.mockResolvedValue([row()]);
      await request(app)
        .get('/api/notifications?participantId=other')
        .set('Authorization', AUTH);
      expect(list).not.toHaveBeenCalled(); // rejected as an unknown parameter

      await request(app)
        .get('/api/notifications')
        .set('Authorization', AUTH)
        .set('X-Participant-Id', 'someone-else');
      expect(list.mock.calls[0][0]).toBe(OWN_ID);

      await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', AUTH)
        .set('X-Participant-Id', 'someone-else');
      expect(markAll).toHaveBeenCalledWith(OWN_ID);
    });

    it('answers 404 (not 403) for another account\'s notification so existence never leaks', async () => {
      markRead.mockRejectedValue({ message: 'NOTIFICATION_NOT_FOUND', code: 'P0001' });
      const other = await request(app)
        .patch(`/api/notifications/${NOTIFICATION_ID}/read`)
        .set('Authorization', AUTH);
      const missing = await request(app)
        .patch('/api/notifications/99999999-9999-4999-8999-999999999999/read')
        .set('Authorization', AUTH);

      expect(other.status).toBe(404);
      expect(other.body).toEqual({ error: 'Notification not found.', code: 'NOTIFICATION_NOT_FOUND' });
      expect(missing.body).toEqual(other.body);
    });
  });

  // ---------------------------------------------------------------------------
  describe('2. Empty states', () => {
    it('GET returns an explicit empty feed', async () => {
      const res = await request(app).get('/api/notifications').set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', notifications: [], unreadCount: 0, nextCursor: null });
    });

    it('GET unread=true returns an empty feed while read items exist', async () => {
      count.mockResolvedValue(0);
      const res = await request(app)
        .get('/api/notifications?unread=true')
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body.notifications).toEqual([]);
      expect(res.body.unreadCount).toBe(0);
      expect(list.mock.calls[0][1]).toMatchObject({ unreadOnly: true });
    });

    it('GET with a category that has no rows is empty but still reports the real unread total', async () => {
      count.mockResolvedValue(4);
      const res = await request(app)
        .get('/api/notifications?category=roster')
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body.notifications).toEqual([]);
      expect(res.body.unreadCount).toBe(4);
    });

    it('GET past the last page is empty with no cursor', async () => {
      const cursor = encodeNotificationCursor({ createdAt: CREATED, id: NOTIFICATION_ID });
      const res = await request(app)
        .get(`/api/notifications?cursor=${cursor}`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ notifications: [], nextCursor: null });
    });

    it('read-all with nothing unread succeeds with markedCount 0', async () => {
      const res = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', markedCount: 0, unreadCount: 0 });
    });
  });

  // ---------------------------------------------------------------------------
  describe('3. Read states', () => {
    it('marks an unread notification read (alreadyRead=false) and reports the new unread total', async () => {
      markRead.mockResolvedValue({
        notification: row({ read_at: '2026-11-03T12:00:00+00:00' }),
        alreadyRead: false,
        unreadCount: 2,
      });
      const res = await request(app)
        .patch(`/api/notifications/${NOTIFICATION_ID}/read`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        alreadyRead: false,
        unreadCount: 2,
        notification: { id: NOTIFICATION_ID, readAt: '2026-11-03T12:00:00+00:00' },
      });
    });

    it('is idempotent: marking an already-read notification reports alreadyRead=true and keeps readAt', async () => {
      markRead.mockResolvedValue({
        notification: row({ read_at: '2026-11-03T12:00:00+00:00' }),
        alreadyRead: true,
        unreadCount: 2,
      });
      const res = await request(app)
        .patch(`/api/notifications/${NOTIFICATION_ID}/read`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body.alreadyRead).toBe(true);
      expect(res.body.notification.readAt).toBe('2026-11-03T12:00:00+00:00');
    });

    it('exposes read and unread items distinctly in one feed', async () => {
      list.mockResolvedValue([
        row({ id: 'u', read_at: null }),
        row({ id: 'r', read_at: '2026-11-03T11:00:00+00:00' }),
      ]);
      count.mockResolvedValue(1);
      const res = await request(app).get('/api/notifications').set('Authorization', AUTH);
      expect(res.body.notifications.map((n: { id: string; readAt: string | null }) => [n.id, n.readAt])).toEqual([
        ['u', null],
        ['r', '2026-11-03T11:00:00+00:00'],
      ]);
      expect(res.body.unreadCount).toBe(1);
    });

    it('mark-all reports how many changed and leaves zero unread', async () => {
      markAll.mockResolvedValue({ markedCount: 5, unreadCount: 0 });
      const res = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', AUTH);
      expect(res.body).toEqual({ status: 'ok', markedCount: 5, unreadCount: 0 });
    });

    it('mark-all repeated is a no-op success', async () => {
      markAll
        .mockResolvedValueOnce({ markedCount: 3, unreadCount: 0 })
        .mockResolvedValueOnce({ markedCount: 0, unreadCount: 0 });
      const first = await request(app).post('/api/notifications/read-all').set('Authorization', AUTH);
      const second = await request(app).post('/api/notifications/read-all').set('Authorization', AUTH);
      expect([first.body.markedCount, second.body.markedCount]).toEqual([3, 0]);
    });

    it('mark-all reports a concurrent arrival honestly (unreadCount may be non-zero)', async () => {
      markAll.mockResolvedValue({ markedCount: 2, unreadCount: 1 });
      const res = await request(app).post('/api/notifications/read-all').set('Authorization', AUTH);
      expect(res.body).toEqual({ status: 'ok', markedCount: 2, unreadCount: 1 });
    });
  });

  // ---------------------------------------------------------------------------
  describe('4. Invalid input (rejected before any data access)', () => {
    it.each([
      ['limit=0', 'limit'],
      ['limit=-1', 'limit'],
      ['limit=51', 'limit'],
      ['limit=1.5', 'limit'],
      ['limit=', 'limit'],
      ['limit=%205', 'limit'],
      ['limit=5abc', 'limit'],
      ['limit=0x10', 'limit'],
      ['limit=1e1', 'limit'],
      ['limit=1&limit=2', 'limit'],
      ['unread=1', 'unread'],
      ['unread=TRUE', 'unread'],
      ['unread=true&unread=false', 'unread'],
      ['category=Invitation', 'category'],
      ['category=', 'category'],
      ['category=invitation&category=roster', 'category'],
      ['cursor=', 'cursor'],
      ['cursor=!!!', 'cursor'],
      ['sort=asc', 'sort'],
      ['offset=5', 'offset'],
    ])('GET ?%s -> 400 on "%s"', async (qs, field) => {
      const res = await request(app).get(`/api/notifications?${qs}`).set('Authorization', AUTH);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.fieldErrors[field]).toBeTruthy();
      expectNoDataAccess();
    });

    it.each([
      ['not json', 'bm90LWpzb24'],
      ['wrong shape', Buffer.from(JSON.stringify({ a: 1 })).toString('base64url')],
      ['bad timestamp', Buffer.from(JSON.stringify(['yesterday', NOTIFICATION_ID])).toString('base64url')],
      ['bad id', Buffer.from(JSON.stringify([CREATED, 'nope'])).toString('base64url')],
      ['extra element', Buffer.from(JSON.stringify([CREATED, NOTIFICATION_ID, 'x'])).toString('base64url')],
      [
        'filter injection',
        Buffer.from(JSON.stringify([`${CREATED}",id.gt.0,x.eq."`, NOTIFICATION_ID])).toString('base64url'),
      ],
    ])('rejects a %s cursor', async (_label, cursor) => {
      const res = await request(app)
        .get(`/api/notifications?cursor=${cursor}`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors.cursor).toBeTruthy();
      expectNoDataAccess();
    });

    it.each([
      'not-a-uuid',
      '11111111-1111-4111-8111-11111111111', // one char short
      '11111111-1111-4111-8111-1111111111111', // one char long
      '11111111-1111-0111-8111-111111111111', // invalid version nibble
      '11111111-1111-4111-c111-111111111111', // invalid variant nibble
      '00000000-0000-0000-0000-000000000000', // nil uuid
      '%20',
    ])('PATCH /%s/read -> 400 and no data access', async (id) => {
      const res = await request(app)
        .patch(`/api/notifications/${id}/read`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors.id).toBeTruthy();
      expectNoDataAccess();
    });

    it.each([
      ['an object', { message: 'tampered' }],
      ['a read_at override', { read_at: '2000-01-01T00:00:00Z' }],
      ['a participant id', { participant_id: 'x' }],
      ['an array', [1, 2]],
      ['a string', 'hello'],
    ])('PATCH and POST reject a body carrying %s', async (_label, body) => {
      const patch = await request(app)
        .patch(`/api/notifications/${NOTIFICATION_ID}/read`)
        .set('Authorization', AUTH)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(body));
      const post = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', AUTH)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(body));
      expect(patch.status).toBe(400);
      expect(post.status).toBe(400);
      expectNoDataAccess();
    });

    it('rejects malformed JSON with an explicit 400', async () => {
      const res = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', AUTH)
        .set('Content-Type', 'application/json')
        .send('{"broken":');
      expect(res.status).toBe(400);
      expectNoDataAccess();
    });

    it('accepts an empty JSON object body', async () => {
      const res = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', AUTH)
        .send({});
      expect(res.status).toBe(200);
    });

    it('answers 404 for unsupported routes and methods', async () => {
      for (const [method, path] of [
        ['delete', `/api/notifications/${NOTIFICATION_ID}`],
        ['put', `/api/notifications/${NOTIFICATION_ID}/read`],
        ['patch', `/api/notifications/${NOTIFICATION_ID}`],
        ['get', `/api/notifications/${NOTIFICATION_ID}/read`],
        ['post', '/api/notifications'],
        ['get', '/api/notifications/unknown/route/here'],
      ] as const) {
        const res = await request(app)[method](path).set('Authorization', AUTH);
        expect(res.status, `${method.toUpperCase()} ${path}`).toBe(404);
      }
      expectNoDataAccess();
    });

    it('rejection echoes the offending input so the client can show it', async () => {
      const res = await request(app).get('/api/notifications?limit=999').set('Authorization', AUTH);
      expect(res.body.submitted).toEqual({ limit: '999' });
    });
  });

  // ---------------------------------------------------------------------------
  describe('5. Boundary conditions', () => {
    it.each([
      ['1', 2],
      ['50', 51],
      ['20', 21],
    ])('limit=%s is accepted and fetches one extra row to detect another page (%i)', async (limit, fetched) => {
      const res = await request(app)
        .get(`/api/notifications?limit=${limit}`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(list.mock.calls[0][1].limit).toBe(fetched);
    });

    it('nextCursor is null exactly at the page boundary and set one row beyond it', async () => {
      list.mockResolvedValueOnce([row({ id: 'a' }), row({ id: 'b' })]); // limit 2 -> fetched 3
      const exact = await request(app).get('/api/notifications?limit=2').set('Authorization', AUTH);
      expect(exact.body.nextCursor).toBeNull();
      expect(exact.body.notifications).toHaveLength(2);

      list.mockResolvedValueOnce([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]);
      const more = await request(app).get('/api/notifications?limit=2').set('Authorization', AUTH);
      expect(more.body.notifications.map((n: { id: string }) => n.id)).toEqual(['a', 'b']);
      expect(more.body.nextCursor).toBe(encodeNotificationCursor({ createdAt: CREATED, id: 'b' }));
    });

    it('accepts a cursor with microsecond precision and any valid UTC offset', async () => {
      for (const createdAt of [
        '2026-11-03T10:00:00.123456+00:00',
        '2026-11-03T10:00:00Z',
        '2026-11-03T10:00:00.1-05:30',
      ]) {
        const cursor = encodeNotificationCursor({ createdAt, id: NOTIFICATION_ID });
        const res = await request(app)
          .get(`/api/notifications?cursor=${cursor}`)
          .set('Authorization', AUTH);
        expect(res.status, createdAt).toBe(200);
      }
    });

    it('rejects an oversized cursor instead of decoding it', async () => {
      const huge = Buffer.from(JSON.stringify([CREATED, NOTIFICATION_ID, 'x'.repeat(5000)])).toString('base64url');
      const res = await request(app)
        .get(`/api/notifications?cursor=${huge}`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors.cursor).toBeTruthy();
      expectNoDataAccess();
    });

    it('accepts an uppercase UUID in the path', async () => {
      const res = await request(app)
        .patch(`/api/notifications/${NOTIFICATION_ID.toUpperCase()}/read`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
    });

    it('reports very large unread counts unchanged', async () => {
      count.mockResolvedValue(1_000_000);
      const res = await request(app).get('/api/notifications').set('Authorization', AUTH);
      expect(res.body.unreadCount).toBe(1_000_000);
    });
  });

  // ---------------------------------------------------------------------------
  describe('6. Failure handling (explicit, no leaks)', () => {
    const SECRET = 'postgres://user:hunter2@db.internal:5432/prod';

    const expectSafe500 = (res: request.Response) => {
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal Server Error');
      expect(JSON.stringify(res.body)).not.toContain('hunter2');
      expect(JSON.stringify(res.body)).not.toContain('db.internal');
      expect(JSON.stringify(res.body)).not.toMatch(/stack/i);
    };

    it('list: a database failure is a safe 500', async () => {
      list.mockRejectedValue(new Error(SECRET));
      expectSafe500(await request(app).get('/api/notifications').set('Authorization', AUTH));
    });

    it('list: an unread-count failure is a safe 500 (no partial feed)', async () => {
      list.mockResolvedValue([row()]);
      count.mockRejectedValue(new Error(SECRET));
      const res = await request(app).get('/api/notifications').set('Authorization', AUTH);
      expectSafe500(res);
      expect(res.body.notifications).toBeUndefined();
    });

    it('mark-read: an unexpected RPC failure is a safe 500', async () => {
      markRead.mockRejectedValue({ message: SECRET, code: '57014' });
      expectSafe500(
        await request(app).patch(`/api/notifications/${NOTIFICATION_ID}/read`).set('Authorization', AUTH)
      );
    });

    it('mark-all: an unexpected RPC failure is a safe 500', async () => {
      markAll.mockRejectedValue(new Error(SECRET));
      expectSafe500(await request(app).post('/api/notifications/read-all').set('Authorization', AUTH));
    });

    it('maps an RPC VALIDATION_ERROR to an explicit 400', async () => {
      markAll.mockRejectedValue({ message: 'VALIDATION_ERROR', code: 'P0001' });
      const res = await request(app).post('/api/notifications/read-all').set('Authorization', AUTH);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('fails closed when the participant lookup itself fails', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockRejectedValue(new Error(SECRET));
      const res = await request(app).get('/api/notifications').set('Authorization', AUTH);
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(res.body)).not.toContain('hunter2');
      expectNoDataAccess();
    });

    it('a failed mark-read changes nothing: repeating it succeeds once the database recovers', async () => {
      markRead.mockRejectedValueOnce(new Error(SECRET));
      const failed = await request(app)
        .patch(`/api/notifications/${NOTIFICATION_ID}/read`)
        .set('Authorization', AUTH);
      expect(failed.status).toBe(500);

      const retried = await request(app)
        .patch(`/api/notifications/${NOTIFICATION_ID}/read`)
        .set('Authorization', AUTH);
      expect(retried.status).toBe(200);
      expect(markRead).toHaveBeenCalledTimes(2);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { notificationsRepository } from '../db/notifications.repository.js';
import { encodeNotificationCursor } from '../services/notifications.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { Participant, ParticipantNotification } from '../db/types.js';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  };
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

function row(overrides: Partial<ParticipantNotification> = {}): ParticipantNotification {
  return {
    id: NOTIFICATION_ID,
    participant_id: OWN_ID,
    team_id: '22222222-2222-4222-8222-222222222222',
    event_id: '33333333-3333-4333-8333-333333333333',
    request_id: '44444444-4444-4444-8444-444444444444',
    submission_id: null,
    type: 'team_invitation',
    category: 'invitation',
    message: 'You received an invitation.',
    created_at: '2026-11-03T10:00:00.123456+00:00',
    read_at: null,
    ...overrides,
  };
}

describe('Express Notification Endpoints (US-021 / #199 / FR-063, FR-065)', () => {
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

  const decodedToken = {
    uid: 'fb-verified-1',
    email: 'part@example.com',
    role: 'PART',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;

  const auth = 'Bearer valid-mfa-token';

  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(decodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(participant);
  });

  describe('Access control', () => {
    it('denies Visitors with 401 on every route', async () => {
      expect((await request(app).get('/api/notifications')).status).toBe(401);
      expect((await request(app).post('/api/notifications/read-all')).status).toBe(401);
      expect(
        (await request(app).patch(`/api/notifications/${NOTIFICATION_ID}/read`)).status
      ).toBe(401);
    });

    it('denies unverified accounts with 403 and never touches data', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        ...participant,
        is_verified: false,
      });
      const list = vi.spyOn(notificationsRepository, 'listForParticipant');
      const res = await request(app).get('/api/notifications').set('Authorization', auth);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
      expect(list).not.toHaveBeenCalled();
    });

    it('denies suspended accounts with 403', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        ...participant,
        is_suspended: true,
      });
      const res = await request(app).post('/api/notifications/read-all').set('Authorization', auth);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/notifications', () => {
    it('lists the caller\'s notifications with unread count and safe fields only', async () => {
      const list = vi
        .spyOn(notificationsRepository, 'listForParticipant')
        .mockResolvedValue([row(), row({ id: 'x', read_at: '2026-11-03T11:00:00+00:00' })]);
      vi.spyOn(notificationsRepository, 'countUnread').mockResolvedValue(1);

      const res = await request(app).get('/api/notifications').set('Authorization', auth);

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(list).toHaveBeenCalledWith(OWN_ID, {
        limit: 21,
        cursor: null,
        unreadOnly: false,
        category: null,
      });
      expect(res.body.unreadCount).toBe(1);
      expect(res.body.nextCursor).toBeNull();
      expect(res.body.notifications).toHaveLength(2);
      expect(res.body.notifications[0]).toEqual({
        id: NOTIFICATION_ID,
        type: 'team_invitation',
        category: 'invitation',
        message: 'You received an invitation.',
        teamId: '22222222-2222-4222-8222-222222222222',
        eventId: '33333333-3333-4333-8333-333333333333',
        requestId: '44444444-4444-4444-8444-444444444444',
        submissionId: null,
        readAt: null,
        createdAt: '2026-11-03T10:00:00.123456+00:00',
      });
      expect(res.body.notifications[1].readAt).toBe('2026-11-03T11:00:00+00:00');
      expect(JSON.stringify(res.body)).not.toMatch(/participant_id|participantId|email/);
    });

    it('returns an empty feed with zero unread when there are none', async () => {
      vi.spyOn(notificationsRepository, 'listForParticipant').mockResolvedValue([]);
      vi.spyOn(notificationsRepository, 'countUnread').mockResolvedValue(0);
      const res = await request(app).get('/api/notifications').set('Authorization', auth);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ notifications: [], unreadCount: 0, nextCursor: null });
    });

    it('applies unread/category/limit filters and pages with a keyset cursor', async () => {
      const rows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: NOTIFICATION_ID })];
      const list = vi.spyOn(notificationsRepository, 'listForParticipant').mockResolvedValue(rows);
      vi.spyOn(notificationsRepository, 'countUnread').mockResolvedValue(3);

      const res = await request(app)
        .get('/api/notifications?limit=2&unread=true&category=invitation')
        .set('Authorization', auth);

      expect(res.status).toBe(200);
      expect(list).toHaveBeenCalledWith(OWN_ID, {
        limit: 3,
        cursor: null,
        unreadOnly: true,
        category: 'invitation',
      });
      expect(res.body.notifications).toHaveLength(2);
      expect(res.body.nextCursor).toBe(
        encodeNotificationCursor({ createdAt: rows[1].created_at, id: 'b' })
      );
    });

    it('accepts a cursor produced by a previous page', async () => {
      const list = vi.spyOn(notificationsRepository, 'listForParticipant').mockResolvedValue([]);
      vi.spyOn(notificationsRepository, 'countUnread').mockResolvedValue(0);
      const cursor = encodeNotificationCursor({
        createdAt: '2026-11-03T10:00:00.123456+00:00',
        id: NOTIFICATION_ID,
      });
      const res = await request(app)
        .get(`/api/notifications?cursor=${cursor}`)
        .set('Authorization', auth);
      expect(res.status).toBe(200);
      expect(list.mock.calls[0][1].cursor).toEqual({
        createdAt: '2026-11-03T10:00:00.123456+00:00',
        id: NOTIFICATION_ID,
      });
    });

    it.each([
      ['limit=0', 'limit'],
      ['limit=51', 'limit'],
      ['limit=abc', 'limit'],
      ['unread=yes', 'unread'],
      ['category=bogus', 'category'],
      ['cursor=not-a-cursor', 'cursor'],
      ['participantId=other', 'participantId'],
    ])('rejects %s with 400 VALIDATION_ERROR', async (qs, field) => {
      const list = vi.spyOn(notificationsRepository, 'listForParticipant');
      const res = await request(app).get(`/api/notifications?${qs}`).set('Authorization', auth);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.fieldErrors[field]).toBeTruthy();
      expect(list).not.toHaveBeenCalled();
    });

    it('does not rely on any client-supplied participant id', async () => {
      const list = vi.spyOn(notificationsRepository, 'listForParticipant').mockResolvedValue([]);
      vi.spyOn(notificationsRepository, 'countUnread').mockResolvedValue(0);
      await request(app).get('/api/notifications').set('Authorization', auth);
      expect(list.mock.calls[0][0]).toBe(OWN_ID);
    });

    it('passes unexpected repository failures to the error handler (500)', async () => {
      vi.spyOn(notificationsRepository, 'listForParticipant').mockRejectedValue(new Error('db down'));
      vi.spyOn(notificationsRepository, 'countUnread').mockResolvedValue(0);
      const res = await request(app).get('/api/notifications').set('Authorization', auth);
      expect(res.status).toBe(500);
    });
  });

  describe('PATCH /api/notifications/:id/read', () => {
    it('marks the caller\'s notification read and returns the new unread count', async () => {
      const mark = vi.spyOn(notificationsRepository, 'markRead').mockResolvedValue({
        notification: row({ read_at: '2026-11-03T12:00:00+00:00' }),
        alreadyRead: false,
        unreadCount: 4,
      });
      const res = await request(app)
        .patch(`/api/notifications/${NOTIFICATION_ID}/read`)
        .set('Authorization', auth);
      expect(res.status).toBe(200);
      expect(mark).toHaveBeenCalledWith(OWN_ID, NOTIFICATION_ID);
      expect(res.body).toMatchObject({
        status: 'ok',
        alreadyRead: false,
        unreadCount: 4,
        notification: { id: NOTIFICATION_ID, readAt: '2026-11-03T12:00:00+00:00' },
      });
    });

    it('is idempotent for an already-read notification', async () => {
      vi.spyOn(notificationsRepository, 'markRead').mockResolvedValue({
        notification: row({ read_at: '2026-11-03T12:00:00+00:00' }),
        alreadyRead: true,
        unreadCount: 4,
      });
      const res = await request(app)
        .patch(`/api/notifications/${NOTIFICATION_ID}/read`)
        .set('Authorization', auth);
      expect(res.status).toBe(200);
      expect(res.body.alreadyRead).toBe(true);
    });

    it('returns 404 NOTIFICATION_NOT_FOUND for missing or another account\'s id', async () => {
      vi.spyOn(notificationsRepository, 'markRead').mockRejectedValue({
        message: 'NOTIFICATION_NOT_FOUND',
        code: 'P0001',
      });
      const res = await request(app)
        .patch(`/api/notifications/${NOTIFICATION_ID}/read`)
        .set('Authorization', auth);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Notification not found.', code: 'NOTIFICATION_NOT_FOUND' });
    });

    it('rejects a malformed id with 400 without calling the database', async () => {
      const mark = vi.spyOn(notificationsRepository, 'markRead');
      const res = await request(app)
        .patch('/api/notifications/not-a-uuid/read')
        .set('Authorization', auth);
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors.id).toBeTruthy();
      expect(mark).not.toHaveBeenCalled();
    });

    it('rejects a non-empty body so no field can be smuggled in', async () => {
      const mark = vi.spyOn(notificationsRepository, 'markRead');
      const res = await request(app)
        .patch(`/api/notifications/${NOTIFICATION_ID}/read`)
        .set('Authorization', auth)
        .send({ message: 'tampered', participant_id: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(mark).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/notifications/read-all', () => {
    it('marks all of the caller\'s notifications read', async () => {
      const markAll = vi
        .spyOn(notificationsRepository, 'markAllRead')
        .mockResolvedValue({ markedCount: 5, unreadCount: 0 });
      const res = await request(app).post('/api/notifications/read-all').set('Authorization', auth);
      expect(res.status).toBe(200);
      expect(markAll).toHaveBeenCalledWith(OWN_ID);
      expect(res.body).toEqual({ status: 'ok', markedCount: 5, unreadCount: 0 });
    });

    it('succeeds with markedCount 0 when everything is already read', async () => {
      vi.spyOn(notificationsRepository, 'markAllRead').mockResolvedValue({
        markedCount: 0,
        unreadCount: 0,
      });
      const res = await request(app).post('/api/notifications/read-all').set('Authorization', auth);
      expect(res.status).toBe(200);
      expect(res.body.markedCount).toBe(0);
    });

    it('rejects a non-empty body without changing any data', async () => {
      const markAll = vi.spyOn(notificationsRepository, 'markAllRead');
      const res = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', auth)
        .send({ participantId: 'someone-else' });
      expect(res.status).toBe(400);
      expect(markAll).not.toHaveBeenCalled();
    });

    it('is not shadowed by the :id route', async () => {
      const mark = vi.spyOn(notificationsRepository, 'markRead');
      vi.spyOn(notificationsRepository, 'markAllRead').mockResolvedValue({
        markedCount: 1,
        unreadCount: 0,
      });
      await request(app).post('/api/notifications/read-all').set('Authorization', auth);
      expect(mark).not.toHaveBeenCalled();
    });
  });
});

/**
 * US-030 / #347 — Chat happy path, auth, validation, and privacy integration suite
 *
 * Exercises the full Express pipeline (Firebase → MFA → active → PART → verified)
 * for presence, channel create/list, and message send/list — offline with mocks.
 *
 * Maps to acceptance tests:
 *   US-030-T1 Verified PART sets presence to Online → Status stored and returned
 *   US-030-T2 PART creates a forum with title and description → Channel appears in list
 *   US-030-T3 PART sends a text message → Author handle, time, and content returned
 *   US-030-T4 Visitor or unverified user opens Chat → Access denied / gated
 *   US-030-T5 Blank title or blank message → Validation error; draft kept
 *   US-030-T6 Chat API response inspected → No password, OTP, or email fields
 *
 * Also covers suspended denial, MFA gate, invalid channel id, and FR-089 scrubbing
 * of leaked join fields with repeatable offline evidence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { chatRepository } from '../db/chat.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import { publicPayloadHasPrivateChatKey } from '../services/chatPrivacy.js';
import type { Participant } from '../db/types.js';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    getUser: vi.fn(),
    setCustomUserClaims: vi.fn(),
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
const AUTH = 'Bearer valid-mfa-token';
const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';

const verifiedPart: Participant = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  firebase_uid: 'fb-verified-1',
  email: 'part@example.com',
  full_name: 'Verified Hacker',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  presence_status: 'Invisible',
  created_at: '2026-10-21T00:00:00.000Z',
  updated_at: '2026-10-21T00:00:00.000Z',
};

const unverifiedPart: Participant = {
  ...verifiedPart,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  firebase_uid: 'fb-unverified-2',
  email: 'unverified@example.com',
  is_verified: false,
};

const suspendedPart: Participant = {
  ...verifiedPart,
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  firebase_uid: 'fb-suspended-3',
  email: 'suspended@example.com',
  is_suspended: true,
};

const validToken = {
  uid: 'fb-verified-1',
  email: 'part@example.com',
  role: 'PART',
  auth_time: AUTH_TIME,
  [MFA_CLAIM]: AUTH_TIME,
} as unknown as DecodedIdToken;

const CHAT_ENDPOINTS = [
  { method: 'get' as const, path: '/api/presence/me', label: 'GET presence' },
  { method: 'put' as const, path: '/api/presence/me', label: 'PUT presence', body: { presenceStatus: 'Online' } },
  { method: 'get' as const, path: '/api/chat/channels', label: 'GET channels' },
  {
    method: 'post' as const,
    path: '/api/chat/channels',
    label: 'POST channel',
    body: { title: 'General', description: 'Forum' },
  },
  {
    method: 'get' as const,
    path: `/api/chat/channels/${CHANNEL_ID}/messages`,
    label: 'GET messages',
  },
  {
    method: 'post' as const,
    path: `/api/chat/channels/${CHANNEL_ID}/messages`,
    label: 'POST message',
    body: { body: 'Hello' },
  },
];

describe('US-030 / #347 chat integration (happy path, auth, validation, privacy)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(verifiedPart);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(verifiedPart);
  });

  describe('US-030-T1 presence happy path', () => {
    it('verified PART sets presence to Online and reads it back', async () => {
      vi.spyOn(participantsRepository, 'updatePresenceStatus').mockResolvedValue({
        ...verifiedPart,
        presence_status: 'Online',
        updated_at: '2026-10-21T12:00:00.000Z',
      });

      const putRes = await request(app)
        .put('/api/presence/me')
        .set('Authorization', AUTH)
        .send({ presenceStatus: 'Online' });

      expect(putRes.status).toBe(200);
      expect(putRes.body.presence.presenceStatus).toBe('Online');
      expect(putRes.body.presence).not.toHaveProperty('email');
      expect(participantsRepository.updatePresenceStatus).toHaveBeenCalledWith(
        verifiedPart.id,
        'Online'
      );

      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        ...verifiedPart,
        presence_status: 'Online',
      });

      const getRes = await request(app)
        .get('/api/presence/me')
        .set('Authorization', AUTH);

      expect(getRes.status).toBe(200);
      expect(getRes.body.presence.presenceStatus).toBe('Online');
      expect(JSON.stringify(getRes.body)).not.toMatch(/part@example\.com/);
    });
  });

  describe('US-030-T2 channel create + list happy path', () => {
    it('PART creates a forum and it appears in the newest-first list', async () => {
      const channel = {
        id: CHANNEL_ID,
        title: 'General',
        description: 'Open forum for verified participants',
        created_by: verifiedPart.id,
        created_at: '2026-10-21T12:00:00.000Z',
        updated_at: '2026-10-21T12:00:00.000Z',
      };

      vi.spyOn(chatRepository, 'createChannel').mockResolvedValue(channel);
      vi.spyOn(chatRepository, 'listChannelsNewestFirst').mockResolvedValue([channel]);

      const createRes = await request(app)
        .post('/api/chat/channels')
        .set('Authorization', AUTH)
        .send({ title: 'General', description: 'Open forum for verified participants' });

      expect(createRes.status).toBe(201);
      expect(createRes.body.channel).toMatchObject({
        id: CHANNEL_ID,
        title: 'General',
        description: 'Open forum for verified participants',
        createdBy: verifiedPart.id,
      });
      expect(createRes.body.privacy.emailsIncluded).toBe(false);

      const listRes = await request(app)
        .get('/api/chat/channels')
        .set('Authorization', AUTH);

      expect(listRes.status).toBe(200);
      expect(listRes.body.channels).toHaveLength(1);
      expect(listRes.body.channels[0].title).toBe('General');
      expect(publicPayloadHasPrivateChatKey(listRes.body)).toBe(false);
    });
  });

  describe('US-030-T3 message send + list happy path', () => {
    it('PART sends a text message showing author handle, time, and content', async () => {
      vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue({
        id: CHANNEL_ID,
        title: 'General',
        description: 'Forum',
        created_by: verifiedPart.id,
        created_at: '2026-10-21T12:00:00.000Z',
        updated_at: '2026-10-21T12:00:00.000Z',
      });
      vi.spyOn(chatRepository, 'createMessage').mockResolvedValue({
        id: MESSAGE_ID,
        channel_id: CHANNEL_ID,
        author_id: verifiedPart.id,
        body: 'Hello team',
        created_at: '2026-10-21T12:05:00.000Z',
      });
      vi.spyOn(chatRepository, 'listMessagesByChannel').mockResolvedValue([
        {
          id: MESSAGE_ID,
          channel_id: CHANNEL_ID,
          author_id: verifiedPart.id,
          body: 'Hello team',
          created_at: '2026-10-21T12:05:00.000Z',
        },
      ]);
      vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
        participant_id: verifiedPart.id,
        handle: 'hacker1',
      } as never);

      const sendRes = await request(app)
        .post(`/api/chat/channels/${CHANNEL_ID}/messages`)
        .set('Authorization', AUTH)
        .send({ body: 'Hello team' });

      expect(sendRes.status).toBe(201);
      expect(sendRes.body.message).toMatchObject({
        body: 'Hello team',
        authorHandle: 'hacker1',
        createdAt: '2026-10-21T12:05:00.000Z',
      });
      expect(sendRes.body.message).not.toHaveProperty('email');

      const listRes = await request(app)
        .get(`/api/chat/channels/${CHANNEL_ID}/messages`)
        .set('Authorization', AUTH);

      expect(listRes.status).toBe(200);
      expect(listRes.body.messages[0]).toMatchObject({
        authorHandle: 'hacker1',
        body: 'Hello team',
        createdAt: '2026-10-21T12:05:00.000Z',
      });
      expect(publicPayloadHasPrivateChatKey(listRes.body)).toBe(false);
    });
  });

  describe('US-030-T4 unauthorized access', () => {
    it('denies Visitors (no Authorization) with 401 on every chat endpoint', async () => {
      for (const endpoint of CHAT_ENDPOINTS) {
        const req = request(app)[endpoint.method](endpoint.path);
        const res = endpoint.body ? await req.send(endpoint.body) : await req;
        expect(res.status, endpoint.label).toBe(401);
        expect(res.body.code, endpoint.label).toBe('UNAUTHORIZED');
      }
    });

    it('denies unverified PART with 403 EMAIL_NOT_VERIFIED', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(unverifiedPart);

      const channelRes = await request(app)
        .post('/api/chat/channels')
        .set('Authorization', AUTH)
        .send({ title: 'General', description: 'Forum' });
      expect(channelRes.status).toBe(403);
      expect(channelRes.body.code).toBe('EMAIL_NOT_VERIFIED');

      const presenceRes = await request(app)
        .put('/api/presence/me')
        .set('Authorization', AUTH)
        .send({ presenceStatus: 'Online' });
      expect(presenceRes.status).toBe(403);
      expect(presenceRes.body.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('denies suspended PART with 403 ACCOUNT_SUSPENDED', async () => {
      mockVerifyIdToken.mockResolvedValue({
        ...validToken,
        uid: 'fb-suspended-3',
      });
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(suspendedPart);

      const res = await request(app)
        .get('/api/chat/channels')
        .set('Authorization', AUTH);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('denies missing MFA claim with 403 MFA_REQUIRED', async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: 'fb-verified-1',
        email: 'part@example.com',
        role: 'PART',
        auth_time: AUTH_TIME,
      });

      const res = await request(app)
        .get('/api/chat/channels')
        .set('Authorization', AUTH);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
    });
  });

  describe('US-030-T5 blank title / blank message validation (NR-017 drafts)', () => {
    it('rejects blank title and description and echoes submitted draft', async () => {
      const createSpy = vi.spyOn(chatRepository, 'createChannel');
      const body = { title: '   ', description: '' };
      const res = await request(app)
        .post('/api/chat/channels')
        .set('Authorization', AUTH)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.title).toMatch(/required/i);
      expect(res.body.errors.description).toMatch(/required/i);
      expect(res.body.submitted).toEqual(body);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('rejects blank message body and echoes submitted draft', async () => {
      const body = { body: '   ' };
      const res = await request(app)
        .post(`/api/chat/channels/${CHANNEL_ID}/messages`)
        .set('Authorization', AUTH)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.body).toMatch(/required/i);
      expect(res.body.submitted).toEqual(body);
    });

    it('rejects invalid channel UUID with 400 and submitted echo', async () => {
      const res = await request(app)
        .get('/api/chat/channels/not-a-uuid/messages')
        .set('Authorization', AUTH);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.channelId).toBeTruthy();
      expect(res.body.submitted).toEqual({ channelId: 'not-a-uuid' });
    });
  });

  describe('US-030-T6 privacy scrubbing (FR-089)', () => {
    it('scrubs email, password, and otp_hash from message payloads', async () => {
      vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue({
        id: CHANNEL_ID,
        title: 'General',
        description: 'Forum',
        created_by: verifiedPart.id,
        created_at: '2026-10-21T12:00:00.000Z',
        updated_at: '2026-10-21T12:00:00.000Z',
      });
      vi.spyOn(chatRepository, 'listMessagesByChannel').mockResolvedValue([
        {
          id: MESSAGE_ID,
          channel_id: CHANNEL_ID,
          author_id: verifiedPart.id,
          body: 'Hello team',
          created_at: '2026-10-21T12:05:00.000Z',
          email: 'part@example.com',
          password: 'Password123!',
          otp_hash: 'deadbeef',
          firebase_uid: 'fb-verified-1',
        } as never,
      ]);
      vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
        participant_id: verifiedPart.id,
        handle: 'hacker1',
      } as never);

      const res = await request(app)
        .get(`/api/chat/channels/${CHANNEL_ID}/messages`)
        .set('Authorization', AUTH);

      expect(res.status).toBe(200);
      expect(res.body.messages[0].authorHandle).toBe('hacker1');
      expect(res.body.messages[0]).not.toHaveProperty('email');
      expect(res.body.messages[0]).not.toHaveProperty('password');
      expect(res.body.messages[0]).not.toHaveProperty('otp_hash');
      expect(res.body.messages[0]).not.toHaveProperty('firebase_uid');
      expect(res.body.privacy).toMatchObject({
        credentialsIncluded: false,
        otpsIncluded: false,
        emailsIncluded: false,
      });
      expect(publicPayloadHasPrivateChatKey(res.body)).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/part@example\.com|Password123!|deadbeef/);
    });

    it('redacts sensitive keys from validation draft echoes', async () => {
      const body = {
        title: '',
        description: 'keep-me',
        email: 'part@example.com',
        password: 'secret',
        otpCode: '123456',
      };

      const res = await request(app)
        .post('/api/chat/channels')
        .set('Authorization', AUTH)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.submitted).toMatchObject({
        title: '',
        description: 'keep-me',
        email: '[redacted]',
        password: '[redacted]',
        otpCode: '[redacted]',
      });
    });
  });
});

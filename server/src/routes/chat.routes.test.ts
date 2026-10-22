import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { chatRepository } from '../db/chat.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { Participant } from '../db/types.js';

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
const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';

describe('Express Chat Endpoints (US-030 / #344 / #347 / FR-087–FR-089)', () => {
  const verifiedParticipant: Participant = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    firebase_uid: 'fb-verified-1',
    email: 'part@example.com',
    full_name: 'Verified Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-21T00:00:00.000Z',
    updated_at: '2026-10-21T00:00:00.000Z',
  };

  const unverifiedParticipant: Participant = {
    ...verifiedParticipant,
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    firebase_uid: 'fb-unverified-2',
    email: 'unverified@example.com',
    is_verified: false,
  };

  const suspendedParticipant: Participant = {
    ...verifiedParticipant,
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    firebase_uid: 'fb-suspended-3',
    email: 'suspended@example.com',
    is_suspended: true,
  };

  const validDecodedToken = {
    uid: 'fb-verified-1',
    email: 'part@example.com',
    role: 'PART',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;

  const validTokenHeader = 'Bearer valid-mfa-token';

  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(
      verifiedParticipant
    );
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(verifiedParticipant);
  });

  describe('Access control', () => {
    it('denies Visitors with 401 on channel and message routes', async () => {
      expect((await request(app).get('/api/chat/channels')).status).toBe(401);
      expect(
        (await request(app).post('/api/chat/channels').send({ title: 'x', description: 'y' }))
          .status
      ).toBe(401);
      expect(
        (await request(app).get(`/api/chat/channels/${CHANNEL_ID}/messages`)).status
      ).toBe(401);
      expect(
        (
          await request(app)
            .post(`/api/chat/channels/${CHANNEL_ID}/messages`)
            .send({ body: 'hi' })
        ).status
      ).toBe(401);
    });

    it('denies unverified accounts with 403 EMAIL_NOT_VERIFIED', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(
        unverifiedParticipant
      );

      const res = await request(app)
        .post('/api/chat/channels')
        .set('Authorization', validTokenHeader)
        .send({ title: 'General', description: 'Forum' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('denies suspended accounts with 403 ACCOUNT_SUSPENDED', async () => {
      mockVerifyIdToken.mockResolvedValue({
        ...validDecodedToken,
        uid: 'fb-suspended-3',
      });
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(
        suspendedParticipant
      );

      const res = await request(app)
        .get('/api/chat/channels')
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
    });
  });

  describe('GET/POST /api/chat/channels', () => {
    it('lists an empty channel array', async () => {
      vi.spyOn(chatRepository, 'listChannelsNewestFirst').mockResolvedValue([]);

      const res = await request(app)
        .get('/api/chat/channels')
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.channels).toEqual([]);
    });

    it('creates a channel (happy path) with privacy flags and no email', async () => {
      vi.spyOn(chatRepository, 'createChannel').mockResolvedValue({
        id: CHANNEL_ID,
        title: 'General',
        description: 'Open forum',
        created_by: verifiedParticipant.id,
        created_at: '2026-10-21T12:00:00.000Z',
        updated_at: '2026-10-21T12:00:00.000Z',
      });

      const res = await request(app)
        .post('/api/chat/channels')
        .set('Authorization', validTokenHeader)
        .send({ title: 'General', description: 'Open forum' });

      expect(res.status).toBe(201);
      expect(res.body.channel.title).toBe('General');
      expect(res.body.channel).not.toHaveProperty('email');
      expect(res.body.privacy).toMatchObject({
        credentialsIncluded: false,
        otpsIncluded: false,
        emailsIncluded: false,
      });
      expect(res.body).not.toHaveProperty('email');
      expect(res.body.channel).not.toHaveProperty('password');
      expect(res.body.channel).not.toHaveProperty('otp');
      expect(JSON.stringify(res.body)).not.toMatch(/part@example\.com/);
    });

    it('rejects blank title/description with 400 and echoes submitted draft', async () => {
      const body = { title: '  ', description: '' };
      const res = await request(app)
        .post('/api/chat/channels')
        .set('Authorization', validTokenHeader)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.title).toBeTruthy();
      expect(res.body.errors.description).toBeTruthy();
      expect(res.body.submitted).toEqual(body);
    });

    it('redacts email/password/otp from validation draft echoes (FR-089)', async () => {
      const body = {
        title: '  ',
        description: 'x',
        email: 'part@example.com',
        password: 'Password123!',
        otp: '123456',
      };
      const res = await request(app)
        .post('/api/chat/channels')
        .set('Authorization', validTokenHeader)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.submitted).toMatchObject({
        title: '  ',
        description: 'x',
        email: '[redacted]',
        password: '[redacted]',
        otp: '[redacted]',
      });
    });
  });

  describe('GET/POST /api/chat/channels/:channelId/messages', () => {
    it('lists messages with author handle', async () => {
      vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue({
        id: CHANNEL_ID,
        title: 'General',
        description: 'Open forum',
        created_by: verifiedParticipant.id,
        created_at: '2026-10-21T12:00:00.000Z',
        updated_at: '2026-10-21T12:00:00.000Z',
      });
      vi.spyOn(chatRepository, 'listMessagesByChannel').mockResolvedValue([
        {
          id: '22222222-2222-4222-8222-222222222222',
          channel_id: CHANNEL_ID,
          author_id: verifiedParticipant.id,
          body: 'Hello team',
          created_at: '2026-10-21T12:05:00.000Z',
        },
      ]);
      vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
        participant_id: verifiedParticipant.id,
        handle: 'hacker1',
      } as never);

      const res = await request(app)
        .get(`/api/chat/channels/${CHANNEL_ID}/messages`)
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.messages[0].body).toBe('Hello team');
      expect(res.body.messages[0].authorHandle).toBe('hacker1');
      expect(res.body.privacy.emailsIncluded).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/part@example\.com|password|otp_hash|firebase_uid/i);
    });

    it('scrubs leaked sensitive keys from message list payloads (FR-089)', async () => {
      vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue({
        id: CHANNEL_ID,
        title: 'General',
        description: 'Open forum',
        created_by: verifiedParticipant.id,
        created_at: '2026-10-21T12:00:00.000Z',
        updated_at: '2026-10-21T12:00:00.000Z',
      });
      vi.spyOn(chatRepository, 'listMessagesByChannel').mockResolvedValue([
        {
          id: '22222222-2222-4222-8222-222222222222',
          channel_id: CHANNEL_ID,
          author_id: verifiedParticipant.id,
          body: 'Hello team',
          created_at: '2026-10-21T12:05:00.000Z',
          // Simulate an accidental join leak — must be scrubbed before response.
          email: 'part@example.com',
          password: 'secret',
          otp_hash: 'hash',
        } as never,
      ]);
      vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
        participant_id: verifiedParticipant.id,
        handle: 'hacker1',
      } as never);

      const res = await request(app)
        .get(`/api/chat/channels/${CHANNEL_ID}/messages`)
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.messages[0]).not.toHaveProperty('email');
      expect(res.body.messages[0]).not.toHaveProperty('password');
      expect(res.body.messages[0]).not.toHaveProperty('otp_hash');
      expect(res.body.messages[0].authorHandle).toBe('hacker1');
    });

    it('sends a message (happy path)', async () => {
      vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue({
        id: CHANNEL_ID,
        title: 'General',
        description: 'Open forum',
        created_by: verifiedParticipant.id,
        created_at: '2026-10-21T12:00:00.000Z',
        updated_at: '2026-10-21T12:00:00.000Z',
      });
      vi.spyOn(chatRepository, 'createMessage').mockResolvedValue({
        id: '33333333-3333-4333-8333-333333333333',
        channel_id: CHANNEL_ID,
        author_id: verifiedParticipant.id,
        body: 'Hello team',
        created_at: '2026-10-21T12:10:00.000Z',
      });
      vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
        participant_id: verifiedParticipant.id,
        handle: 'hacker1',
      } as never);

      const res = await request(app)
        .post(`/api/chat/channels/${CHANNEL_ID}/messages`)
        .set('Authorization', validTokenHeader)
        .send({ body: 'Hello team' });

      expect(res.status).toBe(201);
      expect(res.body.message.body).toBe('Hello team');
      expect(res.body.message.authorHandle).toBe('hacker1');
    });

    it('rejects blank message with 400 and echoes submitted draft', async () => {
      const body = { body: '   ' };
      const res = await request(app)
        .post(`/api/chat/channels/${CHANNEL_ID}/messages`)
        .set('Authorization', validTokenHeader)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.body).toBeTruthy();
      expect(res.body.submitted).toEqual(body);
    });

    it('returns 404 when channel does not exist', async () => {
      vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/chat/channels/${CHANNEL_ID}/messages`)
        .set('Authorization', validTokenHeader)
        .send({ body: 'Hello' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('CHANNEL_NOT_FOUND');
    });
  });
});

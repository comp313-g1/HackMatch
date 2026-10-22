import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
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

describe('Express Presence Endpoints (US-030 / #343 / FR-086)', () => {
  const verifiedParticipant: Participant = {
    id: '11111111-1111-4111-8111-111111111111',
    firebase_uid: 'fb-verified-1',
    email: 'part@example.com',
    full_name: 'Verified Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    presence_status: 'Invisible',
    created_at: '2026-10-21T00:00:00.000Z',
    updated_at: '2026-10-21T00:00:00.000Z',
  };

  const unverifiedParticipant: Participant = {
    ...verifiedParticipant,
    id: '22222222-2222-4222-8222-222222222222',
    firebase_uid: 'fb-unverified-2',
    email: 'unverified@example.com',
    is_verified: false,
  };

  const suspendedParticipant: Participant = {
    ...verifiedParticipant,
    id: '33333333-3333-4333-8333-333333333333',
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
    it('denies Visitors (unauthenticated) with 401', async () => {
      const getRes = await request(app).get('/api/presence/me');
      expect(getRes.status).toBe(401);
      expect(getRes.body.code).toBe('UNAUTHORIZED');

      const putRes = await request(app)
        .put('/api/presence/me')
        .send({ presenceStatus: 'Online' });
      expect(putRes.status).toBe(401);
    });

    it('denies unverified accounts with 403 EMAIL_NOT_VERIFIED', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(
        unverifiedParticipant
      );

      const res = await request(app)
        .put('/api/presence/me')
        .set('Authorization', validTokenHeader)
        .send({ presenceStatus: 'Online' });

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
        .put('/api/presence/me')
        .set('Authorization', validTokenHeader)
        .send({ presenceStatus: 'Online' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
    });
  });

  describe('GET /api/presence/me', () => {
    it('returns own presence without email or credentials', async () => {
      const res = await request(app)
        .get('/api/presence/me')
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.status).toBe('ok');
      expect(res.body.presence.presenceStatus).toBe('Invisible');
      expect(res.body.presence).not.toHaveProperty('email');
      expect(JSON.stringify(res.body)).not.toMatch(/password|otp|firebase_uid/i);
    });
  });

  describe('PUT /api/presence/me', () => {
    it('updates presence to Online (happy path)', async () => {
      vi.spyOn(participantsRepository, 'updatePresenceStatus').mockResolvedValue({
        ...verifiedParticipant,
        presence_status: 'Online',
        updated_at: '2026-10-21T12:00:00.000Z',
      });

      const res = await request(app)
        .put('/api/presence/me')
        .set('Authorization', validTokenHeader)
        .send({ presenceStatus: 'Online' });

      expect(res.status).toBe(200);
      expect(res.body.presence.presenceStatus).toBe('Online');
      expect(participantsRepository.updatePresenceStatus).toHaveBeenCalledWith(
        verifiedParticipant.id,
        'Online'
      );
    });

    it('accepts Idle, Do Not Disturb, and Invisible', async () => {
      for (const status of ['Idle', 'Do Not Disturb', 'Invisible'] as const) {
        vi.spyOn(participantsRepository, 'updatePresenceStatus').mockResolvedValue({
          ...verifiedParticipant,
          presence_status: status,
          updated_at: '2026-10-21T12:00:00.000Z',
        });

        const res = await request(app)
          .put('/api/presence/me')
          .set('Authorization', validTokenHeader)
          .send({ presenceStatus: status });

        expect(res.status).toBe(200);
        expect(res.body.presence.presenceStatus).toBe(status);
      }
    });

    it('rejects invalid presence with 400 and keeps draft-friendly fieldErrors', async () => {
      const updateSpy = vi.spyOn(participantsRepository, 'updatePresenceStatus');

      const res = await request(app)
        .put('/api/presence/me')
        .set('Authorization', validTokenHeader)
        .send({ presenceStatus: 'Busy' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.fieldErrors.presenceStatus).toBeTruthy();
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });
});

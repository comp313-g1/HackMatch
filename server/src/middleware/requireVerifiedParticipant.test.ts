import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { Participant } from '../db/types.js';

// Mock Firebase Admin module to operate 100% offline without live Google Cloud credentials
const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase.js', () => ({
  firebaseAuth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
  getFirebaseAdminAuth: vi.fn(),
  _resetFirebaseInstances: vi.fn(),
}));

describe('requireVerifiedParticipant Middleware & Action Route Protections', () => {
  const verifiedParticipant: Participant = {
    id: '11111111-1111-4111-8111-111111111111',
    firebase_uid: 'verified-fb-uid',
    email: 'verified@example.com',
    full_name: 'Verified User',
    role: 'PART',
    is_verified: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const unverifiedParticipant: Participant = {
    id: '22222222-2222-4222-8222-222222222222',
    firebase_uid: 'unverified-fb-uid',
    email: 'unverified@example.com',
    full_name: 'Unverified User',
    role: 'PART',
    is_verified: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const protectedEndpoints = [
    { method: 'post' as const, path: '/api/teams', expectedStatusOnSuccess: 201 },
    { method: 'post' as const, path: '/api/availability', expectedStatusOnSuccess: 200 },
    { method: 'post' as const, path: '/api/applications', expectedStatusOnSuccess: 201 },
    { method: 'post' as const, path: '/api/invitations/inv-123/accept', expectedStatusOnSuccess: 200 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Test Case 1 & 2: Missing or malformed Authorization header', () => {
    it('rejects with 401 UNAUTHORIZED when Authorization header is missing', async () => {
      const response = await request(app).post('/api/teams').send({});

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Authentication required. Missing or malformed Authorization header.',
        code: 'UNAUTHORIZED',
      });
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });

    it('rejects with 401 UNAUTHORIZED when Authorization header uses non-Bearer scheme', async () => {
      const response = await request(app)
        .post('/api/availability')
        .set('Authorization', 'Basic dXNlcjpwYXNz')
        .send({});

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Authentication required. Missing or malformed Authorization header.',
        code: 'UNAUTHORIZED',
      });
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });

    it('rejects with 401 UNAUTHORIZED when Bearer token is empty whitespace', async () => {
      const response = await request(app)
        .post('/api/applications')
        .set('Authorization', 'Bearer    ')
        .send({});

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Authentication required. Missing or malformed Authorization header.',
        code: 'UNAUTHORIZED',
      });
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });
  });

  describe('Test Case 3: Invalid or expired Firebase ID token', () => {
    it('rejects with 401 INVALID_TOKEN when verifyIdToken throws Firebase auth code error', async () => {
      const authError = new Error('Firebase ID token has expired.') as Error & { code: string };
      authError.code = 'auth/id-token-expired';
      mockVerifyIdToken.mockRejectedValue(authError);

      const response = await request(app)
        .post('/api/teams')
        .set('Authorization', 'Bearer expired-token')
        .send({});

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Invalid or expired authentication token.',
        code: 'INVALID_TOKEN',
      });
    });

    it('rejects with 401 INVALID_TOKEN when verifyIdToken throws decoding or signature error', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('Decoding Firebase ID token failed'));

      const response = await request(app)
        .post('/api/teams')
        .set('Authorization', 'Bearer invalid-token')
        .send({});

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Invalid or expired authentication token.',
        code: 'INVALID_TOKEN',
      });
    });
  });

  describe('Test Case 4: Authenticated user without participant record', () => {
    it('returns 404 PARTICIPANT_NOT_FOUND when participant record does not exist in DB', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'ghost-firebase-uid' });
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(null);

      const response = await request(app)
        .post('/api/teams')
        .set('Authorization', 'Bearer valid-token-ghost-user')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'Participant record not found.',
        code: 'PARTICIPANT_NOT_FOUND',
      });
    });
  });

  describe('Test Case 5: Authenticated unverified participant across all 4 action scopes', () => {
    beforeEach(() => {
      mockVerifyIdToken.mockResolvedValue({ uid: unverifiedParticipant.firebase_uid });
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(unverifiedParticipant);
    });

    for (const { path } of protectedEndpoints) {
      it(`blocks unverified participant with 403 EMAIL_NOT_VERIFIED on ${path}`, async () => {
        const response = await request(app)
          .post(path)
          .set('Authorization', 'Bearer unverified-token')
          .send({});

        expect(response.status).toBe(403);
        expect(response.body).toEqual({
          error:
            'Email verification required. Unverified accounts cannot declare availability, create teams, apply, or accept invitations.',
          code: 'EMAIL_NOT_VERIFIED',
        });
      });
    }
  });

  describe('Test Case 6: Authenticated verified participant across all 4 action scopes', () => {
    beforeEach(() => {
      mockVerifyIdToken.mockResolvedValue({ uid: verifiedParticipant.firebase_uid });
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(verifiedParticipant);
    });

    for (const { path, expectedStatusOnSuccess } of protectedEndpoints) {
      it(`allows verified participant to access ${path} with HTTP ${expectedStatusOnSuccess}`, async () => {
        const response = await request(app)
          .post(path)
          .set('Authorization', 'Bearer verified-token')
          .send({});

        expect(response.status).toBe(expectedStatusOnSuccess);
      });
    }
  });

  describe('Test Case 7: Database lookup failure propagation', () => {
    it('propagates DB error to centralized handler as 500 without leaking details', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'db-fail-uid' });
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockRejectedValue(
        new Error('PostgreSQL connection terminated unexpectedly')
      );

      const response = await request(app)
        .post('/api/teams')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
      // In test mode, ensure sensitive connection strings/details are not part of error contract
      expect(response.body).not.toHaveProperty('password');
    });
  });

  describe('Test Case 8: Stale Firebase token claim handling (D4, R2)', () => {
    it('grants access when DB is_verified is true even if Firebase token has email_verified=false', async () => {
      // Firebase JWT claim might be stale if user verified in another tab or just consumed link
      mockVerifyIdToken.mockResolvedValue({
        uid: verifiedParticipant.firebase_uid,
        email_verified: false,
      });
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(verifiedParticipant);

      const response = await request(app)
        .post('/api/teams')
        .set('Authorization', 'Bearer verified-participant-stale-jwt')
        .send({});

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ message: 'Team created successfully' });
    });
  });
});

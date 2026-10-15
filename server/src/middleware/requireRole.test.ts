import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { Participant } from '../db/types.js';
import { requireRole } from './requireRole.js';
import { readRoleClaim } from '../utils/roleClaims.js';
import type { DecodedIdToken } from 'firebase-admin/auth';

const mockVerifyIdToken = vi.fn();
const mockGetUser = vi.fn();
const mockSetCustomUserClaims = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    getUser: (...args: unknown[]) => mockGetUser(...args),
    setCustomUserClaims: (...args: unknown[]) => mockSetCustomUserClaims(...args),
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

const token = (claims: Record<string, unknown> = {}) => ({
  uid: 'fb-uid-1',
  email: 'user@example.com',
  auth_time: 1_792_000_000,
  mfa_auth_time: 1_792_000_000,
  iat: 1_792_000_000,
  exp: 1_792_003_600,
  firebase: { sign_in_provider: 'password', identities: {} },
  ...claims,
});

const participant = (role: 'PART' | 'ADMIN'): Participant => ({
  id: 'part-uuid-1',
  firebase_uid: 'fb-uid-1',
  email: 'user@example.com',
  full_name: 'Test User',
  role,
  is_verified: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const get = (path: string) =>
  request(app).get(path).set('Authorization', 'Bearer valid.id.token');

describe('readRoleClaim', () => {
  it.each([
    [{ role: 'PART' }, { status: 'valid', role: 'PART' }],
    [{ role: 'ADMIN' }, { status: 'valid', role: 'ADMIN' }],
    [{}, { status: 'missing' }],
    [{ role: null }, { status: 'missing' }],
    [{ role: 'admin' }, { status: 'invalid' }],
    [{ role: 'SUPERUSER' }, { status: 'invalid' }],
    [{ role: ['ADMIN'] }, { status: 'invalid' }],
    [{ role: 1 }, { status: 'invalid' }],
  ])('reads %j as %j', (claims, expected) => {
    expect(readRoleClaim(token(claims) as unknown as DecodedIdToken)).toEqual(expected);
  });
});

describe('requireRole factory', () => {
  it('refuses to build a middleware with no allowed roles', () => {
    expect(() => requireRole()).toThrow(/at least one allowed role/);
  });
});

describe('Role-based authorization (GET /api/access/*)', () => {
  let findByUid: MockInstance<typeof participantsRepository.findByFirebaseUid>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    findByUid = vi.spyOn(participantsRepository, 'findByFirebaseUid');
    mockGetUser.mockResolvedValue({ uid: 'fb-uid-1', customClaims: {} });
    mockSetCustomUserClaims.mockResolvedValue(undefined);
  });

  describe('authentication still comes first', () => {
    it('returns 401 without a token and never reads the role', async () => {
      const response = await request(app).get('/api/access/admin');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHORIZED');
      expect(findByUid).not.toHaveBeenCalled();
    });

    it('returns 401 TOKEN_REVOKED for a revoked token before checking roles', async () => {
      mockVerifyIdToken.mockRejectedValueOnce(Object.assign(new Error('revoked'), { code: 'auth/id-token-revoked' }));

      const response = await get('/api/access/participant');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('TOKEN_REVOKED');
    });
  });

  describe('PART claim', () => {
    beforeEach(() => {
      mockVerifyIdToken.mockResolvedValue(token({ role: 'PART' }));
    });

    it('grants participant access without a database lookup', async () => {
      const response = await get('/api/access/participant');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ access: 'granted', role: 'PART', uid: 'fb-uid-1' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(findByUid).not.toHaveBeenCalled();
    });

    it('denies admin access with 403 FORBIDDEN_ROLE', async () => {
      const response = await get('/api/access/admin');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'You do not have permission to access this resource.',
        code: 'FORBIDDEN_ROLE',
      });
    });
  });

  describe('ADMIN claim', () => {
    beforeEach(() => {
      mockVerifyIdToken.mockResolvedValue(token({ role: 'ADMIN' }));
    });

    it('grants admin access when the participant record is also ADMIN', async () => {
      findByUid.mockResolvedValue(participant('ADMIN'));

      const response = await get('/api/access/admin');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ access: 'granted', role: 'ADMIN', uid: 'fb-uid-1' });
      expect(findByUid).toHaveBeenCalledWith('fb-uid-1');
    });

    it('denies participant-only routes to administrators with 403 FORBIDDEN_ROLE', async () => {
      findByUid.mockResolvedValue(participant('ADMIN'));

      const response = await get('/api/access/participant');

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('rejects a demoted admin whose token still says ADMIN with 403 ROLE_MISMATCH', async () => {
      findByUid.mockResolvedValue(participant('PART'));

      const response = await get('/api/access/admin');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Your account role has changed. Please sign in again.',
        code: 'ROLE_MISMATCH',
      });
    });

    it('rejects an ADMIN claim with no participant record with 403 ROLE_MISMATCH', async () => {
      findByUid.mockResolvedValue(null);

      const response = await get('/api/access/admin');

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('ROLE_MISMATCH');
    });
  });

  describe('invalid claim', () => {
    it.each(['admin', 'SUPERUSER', ''])('rejects role %j with 403 INVALID_ROLE_CLAIM', async (role) => {
      mockVerifyIdToken.mockResolvedValueOnce(token({ role }));

      const response = await get('/api/access/admin');

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('INVALID_ROLE_CLAIM');
      expect(findByUid).not.toHaveBeenCalled();
    });
  });

  describe('missing claim (accounts registered before role claims)', () => {
    beforeEach(() => {
      mockVerifyIdToken.mockResolvedValue(token());
    });

    it('treats a PART participant record as PART and backfills the claim, keeping other claims', async () => {
      findByUid.mockResolvedValue(participant('PART'));
      mockGetUser.mockResolvedValueOnce({ uid: 'fb-uid-1', customClaims: { mfa: true } });

      const response = await get('/api/access/participant');

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('PART');
      expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-uid-1', { mfa: true, role: 'PART' });
    });

    it('still grants access if the claim backfill fails', async () => {
      findByUid.mockResolvedValue(participant('PART'));
      mockSetCustomUserClaims.mockRejectedValueOnce(new Error('quota exceeded'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const response = await get('/api/access/participant');

      expect(response.status).toBe(200);
      expect(warn).toHaveBeenCalled();
    });

    it('never upgrades a missing claim to ADMIN, even if the database says ADMIN', async () => {
      findByUid.mockResolvedValue(participant('ADMIN'));

      const response = await get('/api/access/admin');

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('ROLE_NOT_ASSIGNED');
      expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    });

    it('denies a user with no participant record with 403 ROLE_NOT_ASSIGNED', async () => {
      findByUid.mockResolvedValue(null);

      const response = await get('/api/access/participant');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Your account does not have a role yet. Please contact support.',
        code: 'ROLE_NOT_ASSIGNED',
      });
    });

    it('denies admin routes to a backfilled PART user with 403 FORBIDDEN_ROLE', async () => {
      findByUid.mockResolvedValue(participant('PART'));

      const response = await get('/api/access/admin');

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('passes database failures to the 500 handler without leaking details', async () => {
      findByUid.mockRejectedValue(new Error('PostgreSQL connection terminated'));

      const response = await get('/api/access/participant');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
      expect(JSON.stringify(response.body)).not.toContain('PostgreSQL');
    });
  });
});

/**
 * US-003 login integration tests.
 *
 * Exercises the full Express middleware chain (token → suspension → MFA → role →
 * session / logout) against the real app with Firebase Admin mocked offline.
 * Maps to acceptance tests US-003-T1 … US-003-T5.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { Participant } from '../db/types.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import { ACCOUNT_SUSPENDED_MESSAGE } from '../middleware/requireActiveAccount.js';

const mockVerifyIdToken = vi.fn();
const mockCreateSessionCookie = vi.fn();
const mockVerifySessionCookie = vi.fn();
const mockRevokeRefreshTokens = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    createSessionCookie: (...args: unknown[]) => mockCreateSessionCookie(...args),
    verifySessionCookie: (...args: unknown[]) => mockVerifySessionCookie(...args),
    revokeRefreshTokens: (...args: unknown[]) => mockRevokeRefreshTokens(...args),
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
const CSRF = 'c'.repeat(43);

const firebaseError = (code: string) => Object.assign(new Error(code), { code });

const participant = (overrides: Partial<Participant> = {}): Participant => ({
  id: 'part-uuid-1',
  firebase_uid: 'fb-uid-1',
  email: 'part@example.com',
  full_name: 'Pat Participant',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  suspended_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const claims = (overrides: Record<string, unknown> = {}) => ({
  uid: 'fb-uid-1',
  email: 'part@example.com',
  email_verified: true,
  role: 'PART',
  auth_time: AUTH_TIME,
  iat: AUTH_TIME,
  exp: AUTH_TIME + 3600,
  firebase: { sign_in_provider: 'password', identities: {} },
  ...overrides,
});

const withMfa = (overrides: Record<string, unknown> = {}) =>
  claims({ [MFA_CLAIM]: AUTH_TIME, ...overrides });

const authGet = (path: string) =>
  request(app).get(path).set('Authorization', 'Bearer valid.id.token');

const authPost = (path: string) =>
  request(app).post(path).set('Authorization', 'Bearer valid.id.token');

describe('US-003 login integration (middleware + session)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant());
    mockCreateSessionCookie.mockResolvedValue('session-cookie-value');
    mockRevokeRefreshTokens.mockResolvedValue(undefined);
    mockVerifySessionCookie.mockResolvedValue(withMfa());
  });

  describe('US-003-T1: MFA-complete user receives an authorized session', () => {
    it('PART: account-status → session cookie → protected participant access', async () => {
      mockVerifyIdToken.mockResolvedValue(withMfa());

      const status = await authGet('/api/auth/account-status');
      expect(status.status).toBe(200);
      expect(status.body).toEqual({ active: true });

      const session = await authPost('/api/auth/session');
      expect(session.status).toBe(200);
      expect(session.body.csrfToken).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(session.body.session.maxAgeSeconds).toBe(7 * 24 * 60 * 60);
      expect(mockCreateSessionCookie).toHaveBeenCalled();
      const cookies = session.headers['set-cookie'];
      const cookieList = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
      expect(cookieList.some((c) => c.startsWith('hm_session='))).toBe(true);
      expect(cookieList.some((c) => c.startsWith('hm_csrf='))).toBe(true);

      const access = await authGet('/api/access/participant');
      expect(access.status).toBe(200);
      expect(access.body).toEqual({ access: 'granted', role: 'PART', uid: 'fb-uid-1' });
    });

    it('ADMIN: MFA-complete admin reaches /api/access/admin', async () => {
      mockVerifyIdToken.mockResolvedValue(withMfa({ role: 'ADMIN' }));
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(
        participant({ role: 'ADMIN', email: 'admin@example.com' })
      );

      const access = await authGet('/api/access/admin');
      expect(access.status).toBe(200);
      expect(access.body.role).toBe('ADMIN');
    });
  });

  describe('US-003-T3: protected action before MFA is rejected', () => {
    it('rejects participant access without the MFA claim', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(claims()); // no mfa_auth_time

      const response = await authGet('/api/access/participant');

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('MFA_REQUIRED');
    });

    it('rejects session creation without the MFA claim', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(claims());

      const response = await authPost('/api/auth/session');

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('MFA_REQUIRED');
      expect(mockCreateSessionCookie).not.toHaveBeenCalled();
    });

    it('rejects an MFA claim from a previous sign-in (stale claim)', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(
        claims({ auth_time: AUTH_TIME + 600, [MFA_CLAIM]: AUTH_TIME })
      );

      const response = await authGet('/api/access/participant');

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('MFA_REQUIRED');
    });
  });

  describe('US-003-T4: suspended account cannot sign in or renew a session', () => {
    beforeEach(() => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(
        participant({ is_suspended: true, suspended_at: new Date().toISOString() })
      );
      mockVerifyIdToken.mockResolvedValue(withMfa());
    });

    it('blocks account-status with ACCOUNT_SUSPENDED', async () => {
      const response = await authGet('/api/auth/account-status');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: ACCOUNT_SUSPENDED_MESSAGE,
        code: 'ACCOUNT_SUSPENDED',
      });
    });

    it('blocks session creation (renewal)', async () => {
      const response = await authPost('/api/auth/session');

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('ACCOUNT_SUSPENDED');
      expect(mockCreateSessionCookie).not.toHaveBeenCalled();
    });

    it('blocks protected access after MFA', async () => {
      const response = await authGet('/api/access/participant');

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('ACCOUNT_SUSPENDED');
    });
  });

  describe('US-003-T5: logout revokes tokens; replay fails', () => {
    it('revokes refresh tokens and rejects a replayed ID token', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(withMfa());

      const logout = await request(app)
        .delete('/api/auth/session')
        .set('Authorization', 'Bearer valid.id.token');

      expect(logout.status).toBe(200);
      expect(logout.body.code).toBe('LOGGED_OUT');
      expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('fb-uid-1');

      mockVerifyIdToken.mockRejectedValueOnce(firebaseError('auth/id-token-revoked'));

      const replay = await authGet('/api/auth/me');
      expect(replay.status).toBe(401);
      expect(replay.body.code).toBe('TOKEN_REVOKED');
    });

    it('rejects a replayed session cookie after logout', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(withMfa());
      mockVerifySessionCookie.mockResolvedValueOnce(withMfa());

      await request(app)
        .delete('/api/auth/session')
        .set('Cookie', `hm_session=old-cookie; hm_csrf=${CSRF}`)
        .set('X-CSRF-Token', CSRF);

      mockVerifySessionCookie.mockRejectedValueOnce(firebaseError('auth/session-cookie-revoked'));

      const replay = await request(app)
        .get('/api/auth/session')
        .set('Cookie', 'hm_session=old-cookie');

      expect(replay.status).toBe(401);
      expect(replay.body.code).toBe('SESSION_REVOKED');
    });
  });

  describe('Unauthorized access, invalid input, and failure boundaries', () => {
    it('returns 401 UNAUTHORIZED with no Authorization header', async () => {
      const response = await request(app).get('/api/auth/account-status');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHORIZED');
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });

    it('returns 401 INVALID_TOKEN for a malformed Bearer token', async () => {
      mockVerifyIdToken.mockRejectedValueOnce(firebaseError('auth/argument-error'));

      const response = await authGet('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_TOKEN');
    });

    it('returns 401 TOKEN_EXPIRED for an expired ID token', async () => {
      mockVerifyIdToken.mockRejectedValueOnce(firebaseError('auth/id-token-expired'));

      const response = await authGet('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('TOKEN_EXPIRED');
    });

    it('returns 403 ACCOUNT_DISABLED for a Firebase-disabled user', async () => {
      mockVerifyIdToken.mockRejectedValueOnce(firebaseError('auth/user-disabled'));

      const response = await authGet('/api/auth/account-status');

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('ACCOUNT_DISABLED');
    });

    it('returns 403 FORBIDDEN_ROLE when PART hits an admin route', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(withMfa({ role: 'PART' }));

      const response = await authGet('/api/access/admin');

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('returns 403 CSRF_TOKEN_INVALID when cookie logout omits the CSRF header', async () => {
      const response = await request(app)
        .delete('/api/auth/session')
        .set('Cookie', `hm_session=cookie; hm_csrf=${CSRF}`);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('CSRF_TOKEN_INVALID');
      expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
    });

    it('returns 401 RECENT_SIGN_IN_REQUIRED when the sign-in is older than 10 minutes', async () => {
      const oldAuth = AUTH_TIME - 700;
      mockVerifyIdToken.mockResolvedValueOnce(
        withMfa({ auth_time: oldAuth, [MFA_CLAIM]: oldAuth })
      );

      const response = await authPost('/api/auth/session');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('RECENT_SIGN_IN_REQUIRED');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import { participantsRepository } from '../db/participants.repository.js';
import { mfaRepository } from '../db/mfa.repository.js';
import type { Participant, MfaAttempt } from '../db/types.js';

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

const SEVEN_DAYS = 7 * 24 * 60 * 60;
const now = () => Math.floor(Date.now() / 1000);

const decoded = (overrides: Record<string, unknown> = {}) => {
  const authTime = now() - 30;
  return {
    uid: 'fb-uid-1',
    email: 'jane@example.com',
    email_verified: true,
    role: 'PART',
    auth_time: authTime,
    [MFA_CLAIM]: authTime,
    iat: authTime,
    exp: authTime + 3600,
    firebase: { sign_in_provider: 'password', identities: {} },
    ...overrides,
  };
};

const firebaseError = (code: string) => Object.assign(new Error(code), { code });

const getSetCookies = (res: request.Response): string[] => {
  const raw = res.headers['set-cookie'] as unknown;
  if (Array.isArray(raw)) return raw as string[];
  return typeof raw === 'string' ? [raw] : [];
};
const findCookie = (res: request.Response, name: string) =>
  getSetCookies(res).find((c) => c.startsWith(`${name}=`));

const postSession = () =>
  request(app).post('/api/auth/session').set('Authorization', 'Bearer valid.id.token');

describe('POST /api/auth/session (create session cookie)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSessionCookie.mockResolvedValue('firebase-session-cookie-value');
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(null);
  });

  it('issues an HttpOnly, Secure, SameSite=Strict session cookie with a fixed 7-day lifetime', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(decoded());

    const response = await postSession();

    expect(response.status).toBe(200);
    expect(mockVerifyIdToken).toHaveBeenCalledWith('valid.id.token', true);
    expect(mockCreateSessionCookie).toHaveBeenCalledWith('valid.id.token', { expiresIn: SEVEN_DAYS * 1000 });

    const session = findCookie(response, 'hm_session');
    expect(session).toBeDefined();
    expect(session).toContain('firebase-session-cookie-value');
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/Secure/i);
    expect(session).toMatch(/SameSite=Strict/i);
    expect(session).toMatch(/Path=\/api/);
    expect(session).toMatch(new RegExp(`Max-Age=${SEVEN_DAYS}`));

    const csrf = findCookie(response, 'hm_csrf');
    expect(csrf).toBeDefined();
    expect(csrf).not.toMatch(/HttpOnly/i);
    expect(csrf).toMatch(/Secure/i);
    expect(csrf).toMatch(/SameSite=Strict/i);
    expect(csrf).toContain(`hm_csrf=${response.body.csrfToken}`);

    expect(response.body.session.maxAgeSeconds).toBe(SEVEN_DAYS);
    expect(response.body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(response.body)).not.toContain('firebase-session-cookie-value');
  });

  it('generates a different CSRF token for every session', async () => {
    mockVerifyIdToken.mockResolvedValue(decoded());

    const first = await postSession();
    const second = await postSession();

    expect(first.body.csrfToken).not.toBe(second.body.csrfToken);
  });

  it('blocks session renewal with ACCOUNT_LOCKED during OTP lockout (FR-010)', async () => {
    const participant: Participant = {
      id: 'part-uuid-1',
      firebase_uid: 'fb-uid-1',
      email: 'jane@example.com',
      full_name: 'Jane Doe',
      role: 'PART',
      is_verified: true,
      is_suspended: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockVerifyIdToken.mockResolvedValueOnce(decoded());
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant);
    const fifthFailureTime = Date.now() - 30_000;
    vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `att-${i}`,
        participant_id: participant.id,
        challenge_id: null,
        success: false,
        ip_address: null,
        created_at: new Date(fifthFailureTime - i * 1000).toISOString(),
      })) as MfaAttempt[]
    );

    const response = await postSession();

    expect(response.status).toBe(423);
    expect(response.body.code).toBe('ACCOUNT_LOCKED');
    expect(response.body.retryAfter).toBeGreaterThan(0);
    expect(response.headers['retry-after']).toBeDefined();
    expect(mockCreateSessionCookie).not.toHaveBeenCalled();
  });

  it('returns 401 UNAUTHORIZED without an ID token', async () => {
    const response = await request(app).post('/api/auth/session');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
    expect(findCookie(response, 'hm_session')).toBeUndefined();
  });

  it('refuses to create a session before MFA (403 MFA_REQUIRED)', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(decoded({ [MFA_CLAIM]: undefined }));

    const response = await postSession();

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('MFA_REQUIRED');
    expect(mockCreateSessionCookie).not.toHaveBeenCalled();
  });

  it('returns 401 TOKEN_EXPIRED for an expired ID token', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(firebaseError('auth/id-token-expired'));

    const response = await postSession();

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('TOKEN_EXPIRED');
  });

  describe('recent sign-in boundary (10 minutes)', () => {
    it('accepts a sign-in exactly 600 seconds old', async () => {
      const authTime = now() - 600;
      mockVerifyIdToken.mockResolvedValueOnce(decoded({ auth_time: authTime, [MFA_CLAIM]: authTime }));

      expect((await postSession()).status).toBe(200);
    });

    it('rejects a sign-in older than 10 minutes with 401 RECENT_SIGN_IN_REQUIRED', async () => {
      const authTime = now() - 602;
      mockVerifyIdToken.mockResolvedValueOnce(decoded({ auth_time: authTime, [MFA_CLAIM]: authTime }));

      const response = await postSession();

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Please sign in again to start a new session.',
        code: 'RECENT_SIGN_IN_REQUIRED',
      });
      expect(mockCreateSessionCookie).not.toHaveBeenCalled();
    });

    it('rejects a sign-in time far in the future', async () => {
      const authTime = now() + 120;
      mockVerifyIdToken.mockResolvedValueOnce(decoded({ auth_time: authTime, [MFA_CLAIM]: authTime }));

      expect((await postSession()).body.code).toBe('RECENT_SIGN_IN_REQUIRED');
    });
  });

  it('maps a Firebase failure while creating the cookie to 401 INVALID_TOKEN', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(decoded());
    mockCreateSessionCookie.mockRejectedValueOnce(firebaseError('auth/invalid-id-token'));

    const response = await postSession();

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_TOKEN');
    expect(findCookie(response, 'hm_session')).toBeUndefined();
  });

  it('passes unexpected failures to the 500 handler', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(decoded());
    mockCreateSessionCookie.mockRejectedValueOnce(new Error('boom'));

    const response = await postSession();

    expect(response.status).toBe(500);
    expect(findCookie(response, 'hm_session')).toBeUndefined();
  });
});

describe('GET /api/auth/session (read session cookie)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const getSession = (cookie?: string) => {
    const req = request(app).get('/api/auth/session');
    return cookie ? req.set('Cookie', cookie) : req;
  };

  it('returns the session for a valid cookie and checks revocation', async () => {
    mockVerifySessionCookie.mockResolvedValueOnce(decoded());

    const response = await getSession('hm_session=good-cookie');

    expect(response.status).toBe(200);
    expect(mockVerifySessionCookie).toHaveBeenCalledWith('good-cookie', true);
    expect(response.body.user).toMatchObject({ uid: 'fb-uid-1', role: 'PART' });
    expect(response.body.session.mfaVerified).toBe(true);
  });

  it('returns 401 NO_SESSION without a cookie', async () => {
    const response = await getSession();

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('NO_SESSION');
    expect(mockVerifySessionCookie).not.toHaveBeenCalled();
  });

  it('ignores a session token sent as a Bearer header instead of the cookie', async () => {
    const response = await request(app).get('/api/auth/session').set('Authorization', 'Bearer good-cookie');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('NO_SESSION');
  });

  it.each([
    ['auth/session-cookie-expired', 401, 'SESSION_EXPIRED'],
    ['auth/session-cookie-revoked', 401, 'SESSION_REVOKED'],
    ['auth/argument-error', 401, 'INVALID_SESSION'],
    ['auth/user-disabled', 403, 'ACCOUNT_DISABLED'],
    ['app/network-error', 503, 'AUTH_SERVICE_UNAVAILABLE'],
  ])('maps %s to HTTP %i %s', async (firebaseCode, status, code) => {
    mockVerifySessionCookie.mockRejectedValueOnce(firebaseError(firebaseCode));

    const response = await getSession('hm_session=bad-cookie');

    expect(response.status).toBe(status);
    expect(response.body.code).toBe(code);
    if (status !== 503) {
      expect(findCookie(response, 'hm_session')).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(findCookie(response, 'hm_csrf')).toMatch(/Expires=Thu, 01 Jan 1970/);
    }
  });

  it('passes unexpected errors to the 500 handler', async () => {
    mockVerifySessionCookie.mockRejectedValueOnce(new Error('boom'));

    const response = await getSession('hm_session=cookie');

    expect(response.status).toBe(500);
  });
});

describe('DELETE /api/auth/session (logout + refresh-token revocation)', () => {
  const CSRF = 'a'.repeat(43);

  beforeEach(() => {
    vi.clearAllMocks();
    mockRevokeRefreshTokens.mockResolvedValue(undefined);
    mockVerifySessionCookie.mockResolvedValue(decoded());
    mockVerifyIdToken.mockResolvedValue(decoded());
  });

  it('revokes refresh tokens, clears cookies, and returns LOGGED_OUT (happy path)', async () => {
    const response = await request(app)
      .delete('/api/auth/session')
      .set('Cookie', `hm_session=good-cookie; hm_csrf=${CSRF}`)
      .set('X-CSRF-Token', CSRF)
      .set('Origin', 'http://localhost:5173');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: 'Signed out successfully. All refresh tokens for this account have been revoked.',
      code: 'LOGGED_OUT',
    });
    expect(mockVerifySessionCookie).toHaveBeenCalledWith('good-cookie', false);
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('fb-uid-1');
    expect(findCookie(response, 'hm_session')).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(findCookie(response, 'hm_csrf')).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('accepts Bearer-token logout without a session cookie (no CSRF)', async () => {
    const response = await request(app)
      .delete('/api/auth/session')
      .set('Authorization', 'Bearer valid.id.token');

    expect(response.status).toBe(200);
    expect(response.body.code).toBe('LOGGED_OUT');
    expect(mockVerifyIdToken).toHaveBeenCalledWith('valid.id.token', false);
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('fb-uid-1');
    expect(mockVerifySessionCookie).not.toHaveBeenCalled();
  });

  it('returns 401 NO_SESSION when there is no cookie and no Bearer token', async () => {
    const response = await request(app).delete('/api/auth/session');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('NO_SESSION');
    expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
    expect(findCookie(response, 'hm_session')).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it.each([
    ['no CSRF header', `hm_session=cookie; hm_csrf=${CSRF}`, undefined],
    ['mismatched token', `hm_session=cookie; hm_csrf=${CSRF}`, 'b'.repeat(43)],
    ['different length token', `hm_session=cookie; hm_csrf=${CSRF}`, 'short'],
  ])('rejects cookie logout with %s (403 CSRF_TOKEN_INVALID)', async (_label, cookie, header) => {
    const req = request(app).delete('/api/auth/session').set('Cookie', cookie);
    if (header !== undefined) req.set('X-CSRF-Token', header);
    const response = await req;

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('CSRF_TOKEN_INVALID');
    expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('rejects a request from another origin with 403 ORIGIN_NOT_ALLOWED', async () => {
    const response = await request(app)
      .delete('/api/auth/session')
      .set('Cookie', `hm_session=cookie; hm_csrf=${CSRF}`)
      .set('X-CSRF-Token', CSRF)
      .set('Origin', 'https://evil.example.com');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('still signs out when the Firebase user was already deleted', async () => {
    mockRevokeRefreshTokens.mockRejectedValueOnce(firebaseError('auth/user-not-found'));

    const response = await request(app)
      .delete('/api/auth/session')
      .set('Authorization', 'Bearer valid.id.token');

    expect(response.status).toBe(200);
    expect(response.body.code).toBe('LOGGED_OUT');
  });

  it('clears cookies and returns REVOCATION_FAILED when Firebase is unreachable', async () => {
    mockRevokeRefreshTokens.mockRejectedValueOnce(firebaseError('auth/internal-error'));

    const response = await request(app)
      .delete('/api/auth/session')
      .set('Authorization', 'Bearer valid.id.token');

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('REVOCATION_FAILED');
    expect(findCookie(response, 'hm_session')).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('rejects an invalid Bearer token with 401 INVALID_TOKEN', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(firebaseError('auth/argument-error'));

    const response = await request(app)
      .delete('/api/auth/session')
      .set('Authorization', 'Bearer bad.token');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_TOKEN');
    expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('falls back to Bearer when the session cookie is unusable', async () => {
    mockVerifySessionCookie.mockRejectedValueOnce(firebaseError('auth/session-cookie-expired'));

    const response = await request(app)
      .delete('/api/auth/session')
      .set('Cookie', `hm_session=stale; hm_csrf=${CSRF}`)
      .set('X-CSRF-Token', CSRF)
      .set('Authorization', 'Bearer valid.id.token');

    expect(response.status).toBe(200);
    expect(response.body.code).toBe('LOGGED_OUT');
    expect(mockVerifyIdToken).toHaveBeenCalled();
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('fb-uid-1');
  });

  it('US-003-T5: replaying an old ID token after logout fails with TOKEN_REVOKED', async () => {
    const logoutResponse = await request(app)
      .delete('/api/auth/session')
      .set('Authorization', 'Bearer valid.id.token');
    expect(logoutResponse.body.code).toBe('LOGGED_OUT');
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('fb-uid-1');

    mockVerifyIdToken.mockRejectedValueOnce(firebaseError('auth/id-token-revoked'));

    const replay = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer valid.id.token');

    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('TOKEN_REVOKED');
  });

  it('US-003-T5: replaying an old session cookie after logout fails with SESSION_REVOKED', async () => {
    await request(app)
      .delete('/api/auth/session')
      .set('Cookie', `hm_session=good-cookie; hm_csrf=${CSRF}`)
      .set('X-CSRF-Token', CSRF);

    mockVerifySessionCookie.mockRejectedValueOnce(firebaseError('auth/session-cookie-revoked'));

    const replay = await request(app)
      .get('/api/auth/session')
      .set('Cookie', 'hm_session=good-cookie');

    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('SESSION_REVOKED');
  });
});

describe('CORS', () => {
  it('allows the client to send the X-CSRF-Token header with credentials', async () => {
    const response = await request(app)
      .options('/api/auth/session')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'DELETE')
      .set('Access-Control-Request-Headers', 'X-CSRF-Token');

    expect(response.headers['access-control-allow-headers']).toMatch(/X-CSRF-Token/i);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('sends HSTS so browsers keep using HTTPS', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['strict-transport-security']).toMatch(/max-age=\d+/);
  });
});

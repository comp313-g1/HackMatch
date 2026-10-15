import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { extractBearerToken, mapFirebaseAuthError } from './requireFirebaseAuth.js';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase.js', () => ({
  firebaseAuth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
  getFirebaseAdminAuth: vi.fn(),
  verifyEmailActionCode: vi.fn(),
  sendVerificationEmail: vi.fn(),
  _resetFirebaseInstances: vi.fn(),
}));

const firebaseError = (code: string, message = 'Firebase error') =>
  Object.assign(new Error(message), { code });

const AUTH_TIME = 1_792_000_000;
const decodedToken = {
  uid: 'fb-uid-123',
  email: 'jane@example.com',
  email_verified: true,
  role: 'PART',
  auth_time: AUTH_TIME,
  iat: AUTH_TIME,
  exp: AUTH_TIME + 3600,
  firebase: { sign_in_provider: 'password', identities: {} },
};

describe('extractBearerToken', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['Basic dXNlcjpwYXNz', null],
    ['Bearer', null],
    ['Bearer    ', null],
    ['Bearer a b', null],
    [`Bearer ${'x'.repeat(4097)}`, null],
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer abc.def.ghi', 'abc.def.ghi'],
    ['  Bearer   abc.def.ghi  ', 'abc.def.ghi'],
  ])('extracts from %j -> %j', (header, expected) => {
    expect(extractBearerToken(header)).toBe(expected);
  });
});

describe('mapFirebaseAuthError', () => {
  it('returns null for errors without a Firebase code so they reach the error handler', () => {
    expect(mapFirebaseAuthError(new Error('database down'))).toBeNull();
    expect(mapFirebaseAuthError(null)).toBeNull();
    expect(mapFirebaseAuthError(firebaseError('db/unknown'))).toBeNull();
  });

  it('treats unknown auth/* codes as an invalid token', () => {
    expect(mapFirebaseAuthError(firebaseError('auth/some-new-code'))?.code).toBe('INVALID_TOKEN');
  });
});

describe('requireFirebaseAuth middleware (GET /api/auth/me)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('missing or malformed Authorization header', () => {
    it.each([
      ['no header', undefined],
      ['non-Bearer scheme', 'Basic dXNlcjpwYXNz'],
      ['empty Bearer token', 'Bearer    '],
      ['extra segments', 'Bearer token extra'],
    ])('returns 401 UNAUTHORIZED for %s without calling Firebase', async (_label, header) => {
      const req = request(app).get('/api/auth/me');
      if (header !== undefined) req.set('Authorization', header);
      const response = await req;

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Authentication required. Missing or malformed Authorization header.',
        code: 'UNAUTHORIZED',
      });
      expect(response.headers['www-authenticate']).toBe('Bearer realm="hackmatch"');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });
  });

  describe('Firebase verification failures', () => {
    it.each([
      ['auth/id-token-expired', 401, 'TOKEN_EXPIRED', /session has expired/i],
      ['auth/id-token-revoked', 401, 'TOKEN_REVOKED', /session has been signed out/i],
      ['auth/argument-error', 401, 'INVALID_TOKEN', /invalid authentication token/i],
      ['auth/invalid-id-token', 401, 'INVALID_TOKEN', /invalid authentication token/i],
      ['auth/user-not-found', 401, 'INVALID_TOKEN', /invalid authentication token/i],
      ['auth/user-disabled', 403, 'ACCOUNT_DISABLED', /cannot access hackmatch/i],
      ['auth/internal-error', 503, 'AUTH_SERVICE_UNAVAILABLE', /temporarily unavailable/i],
      ['app/network-error', 503, 'AUTH_SERVICE_UNAVAILABLE', /temporarily unavailable/i],
    ])('maps %s to HTTP %i %s', async (firebaseCode, status, code, message) => {
      mockVerifyIdToken.mockRejectedValueOnce(firebaseError(firebaseCode));

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer some.id.token');

      expect(response.status).toBe(status);
      expect(response.body.code).toBe(code);
      expect(response.body.error).toMatch(message);
      expect(response.body).not.toHaveProperty('user');
      expect(response.headers['cache-control']).toBe('no-store');
      if (status === 401) {
        expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
      } else {
        expect(response.headers['www-authenticate']).toBeUndefined();
      }
    });

    it('does not leak Firebase error details in the response', async () => {
      mockVerifyIdToken.mockRejectedValueOnce(
        firebaseError('auth/argument-error', 'Firebase ID token has incorrect "aud" claim. Expected "secret-project"')
      );

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer some.id.token');

      expect(JSON.stringify(response.body)).not.toContain('secret-project');
    });

    it('passes unexpected errors (e.g. missing Firebase config) to the 500 handler', async () => {
      mockVerifyIdToken.mockRejectedValueOnce(
        new Error('[Firebase Admin Error] Missing FIREBASE_PROJECT_ID')
      );

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer some.id.token');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
      expect(JSON.stringify(response.body)).not.toContain('FIREBASE_PROJECT_ID');
    });
  });

  describe('valid token', () => {
    it('verifies with revocation checking enabled and returns the identity', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(decodedToken);

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid.id.token');

      expect(mockVerifyIdToken).toHaveBeenCalledWith('valid.id.token', true);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({
        user: {
          uid: 'fb-uid-123',
          email: 'jane@example.com',
          emailVerified: true,
          role: 'PART',
          signInProvider: 'password',
        },
        session: {
          authTime: new Date(AUTH_TIME * 1000).toISOString(),
          expiresAt: new Date((AUTH_TIME + 3600) * 1000).toISOString(),
        },
      });
    });

    it('accepts a lowercase bearer scheme', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(decodedToken);

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'bearer valid.id.token');

      expect(response.status).toBe(200);
    });

    it('returns null for a missing role claim and false for an unverified email', async () => {
      mockVerifyIdToken.mockResolvedValueOnce({
        ...decodedToken,
        role: undefined,
        email_verified: false,
        email: undefined,
      });

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid.id.token');

      expect(response.status).toBe(200);
      expect(response.body.user).toMatchObject({ role: null, emailVerified: false, email: null });
    });

    it('never echoes the raw token back to the client', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(decodedToken);

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid.id.token');

      expect(JSON.stringify(response.body)).not.toContain('valid.id.token');
    });
  });
});

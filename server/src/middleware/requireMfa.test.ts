import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { hasCompletedMfa, markMfaComplete, MFA_CLAIM } from '../utils/mfaClaim.js';

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

const AUTH_TIME = 1_792_000_000;

const token = (claims: Record<string, unknown> = {}) => ({
  uid: 'fb-uid-1',
  email: 'user@example.com',
  role: 'PART',
  auth_time: AUTH_TIME,
  iat: AUTH_TIME,
  exp: AUTH_TIME + 3600,
  firebase: { sign_in_provider: 'password', identities: {} },
  ...claims,
});

const asDecoded = (claims: Record<string, unknown>) => token(claims) as unknown as DecodedIdToken;

describe('hasCompletedMfa (boundary conditions)', () => {
  it.each([
    ['claim equals auth_time', { [MFA_CLAIM]: AUTH_TIME }, true],
    ['claim missing', {}, false],
    ['claim from an earlier sign-in', { [MFA_CLAIM]: AUTH_TIME - 1 }, false],
    ['claim newer than sign-in', { [MFA_CLAIM]: AUTH_TIME + 1 }, false],
    ['claim is a string', { [MFA_CLAIM]: String(AUTH_TIME) }, false],
    ['claim is boolean true', { [MFA_CLAIM]: true }, false],
    ['claim is null', { [MFA_CLAIM]: null }, false],
    ['auth_time missing', { auth_time: undefined, [MFA_CLAIM]: AUTH_TIME }, false],
    ['both NaN', { auth_time: Number.NaN, [MFA_CLAIM]: Number.NaN }, false],
  ])('%s -> %s', (_label, claims, expected) => {
    expect(hasCompletedMfa(asDecoded(claims))).toBe(expected);
  });
});

describe('markMfaComplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetCustomUserClaims.mockResolvedValue(undefined);
  });

  it('stores the sign-in auth_time and keeps existing claims such as role', async () => {
    mockGetUser.mockResolvedValueOnce({ uid: 'fb-uid-1', customClaims: { role: 'ADMIN' } });

    await markMfaComplete('fb-uid-1', AUTH_TIME);

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-uid-1', {
      role: 'ADMIN',
      [MFA_CLAIM]: AUTH_TIME,
    });
  });

  it('works for users without existing claims', async () => {
    mockGetUser.mockResolvedValueOnce({ uid: 'fb-uid-1' });

    await markMfaComplete('fb-uid-1', AUTH_TIME);

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-uid-1', { [MFA_CLAIM]: AUTH_TIME });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid auth_time %s', async (bad) => {
    await expect(markMfaComplete('fb-uid-1', bad)).rejects.toThrow(/auth_time/);
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });
});

describe('requireMfa on protected routes (GET /api/access/*)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(null);
  });

  const get = (path: string) =>
    request(app).get(path).set('Authorization', 'Bearer valid.id.token');

  it('rejects password-only sign-in (no MFA claim) with 403 MFA_REQUIRED', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(token());

    const response = await get('/api/access/participant');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: 'Email verification code required. Enter the code sent to your email to continue.',
      code: 'MFA_REQUIRED',
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('rejects a new sign-in that reuses an MFA claim from a previous sign-in', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(token({ auth_time: AUTH_TIME + 600, [MFA_CLAIM]: AUTH_TIME }));

    const response = await get('/api/access/participant');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('MFA_REQUIRED');
  });

  it('checks suspension then MFA before role, so admins without MFA are also rejected', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(token({ role: 'ADMIN' }));

    const response = await get('/api/access/admin');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('MFA_REQUIRED');
  });

  it('grants access once the current sign-in has completed MFA', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(token({ [MFA_CLAIM]: AUTH_TIME }));

    const response = await get('/api/access/participant');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ access: 'granted', role: 'PART', uid: 'fb-uid-1' });
  });

  it('still returns 401 for a missing token before checking MFA', async () => {
    const response = await request(app).get('/api/access/participant');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
  });

  it('reports MFA status on /api/auth/me without blocking it', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(token());
    const before = await get('/api/auth/me');
    expect(before.status).toBe(200);
    expect(before.body.session.mfaVerified).toBe(false);

    mockVerifyIdToken.mockResolvedValueOnce(token({ [MFA_CLAIM]: AUTH_TIME }));
    const after = await get('/api/auth/me');
    expect(after.body.session.mfaVerified).toBe(true);
  });
});

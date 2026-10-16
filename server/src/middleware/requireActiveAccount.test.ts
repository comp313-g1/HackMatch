import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { Participant } from '../db/types.js';
import { ACCOUNT_SUSPENDED_MESSAGE } from './requireActiveAccount.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';

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

const AUTH_TIME = 1_792_000_000;

const token = (claims: Record<string, unknown> = {}) => ({
  uid: 'fb-uid-1',
  email: 'user@example.com',
  role: 'PART',
  auth_time: AUTH_TIME,
  [MFA_CLAIM]: AUTH_TIME,
  iat: AUTH_TIME,
  exp: AUTH_TIME + 3600,
  firebase: { sign_in_provider: 'password', identities: {} },
  ...claims,
});

const participant = (overrides: Partial<Participant> = {}): Participant => ({
  id: 'part-uuid-1',
  firebase_uid: 'fb-uid-1',
  email: 'user@example.com',
  full_name: 'Test User',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  suspended_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe('requireActiveAccount (GET /api/auth/account-status)', () => {
  let findByUid: MockInstance<typeof participantsRepository.findByFirebaseUid>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    findByUid = vi.spyOn(participantsRepository, 'findByFirebaseUid');
  });

  it('returns 200 when the participant is active', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(token());
    findByUid.mockResolvedValueOnce(participant());

    const response = await request(app)
      .get('/api/auth/account-status')
      .set('Authorization', 'Bearer valid.id.token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ active: true });
    expect(findByUid).toHaveBeenCalledWith('fb-uid-1');
  });

  it('allows an authenticated user with no participant row yet', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(token());
    findByUid.mockResolvedValueOnce(null);

    const response = await request(app)
      .get('/api/auth/account-status')
      .set('Authorization', 'Bearer valid.id.token');

    expect(response.status).toBe(200);
  });

  it('rejects a suspended participant with 403 ACCOUNT_SUSPENDED', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(token());
    findByUid.mockResolvedValueOnce(
      participant({ is_suspended: true, suspended_at: new Date().toISOString() })
    );

    const response = await request(app)
      .get('/api/auth/account-status')
      .set('Authorization', 'Bearer valid.id.token');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: ACCOUNT_SUSPENDED_MESSAGE,
      code: 'ACCOUNT_SUSPENDED',
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('rejects Firebase-disabled users before the DB check (ACCOUNT_DISABLED)', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error('disabled'), { code: 'auth/user-disabled' })
    );

    const response = await request(app)
      .get('/api/auth/account-status')
      .set('Authorization', 'Bearer disabled.token');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ACCOUNT_DISABLED');
    expect(findByUid).not.toHaveBeenCalled();
  });

  it('returns 401 without a token', async () => {
    const response = await request(app).get('/api/auth/account-status');

    expect(response.status).toBe(401);
    expect(findByUid).not.toHaveBeenCalled();
  });

  it('blocks suspended accounts from renewing access (POST session path)', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(token());
    findByUid.mockResolvedValueOnce(participant({ is_suspended: true }));

    const response = await request(app)
      .post('/api/auth/session')
      .set('Authorization', 'Bearer valid.id.token');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('blocks suspended accounts from protected access routes after MFA', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(token());
    findByUid.mockResolvedValueOnce(participant({ is_suspended: true }));

    const response = await request(app)
      .get('/api/access/participant')
      .set('Authorization', 'Bearer valid.id.token');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('passes database failures to the 500 handler', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(token());
    findByUid.mockRejectedValueOnce(new Error('PostgreSQL connection terminated'));

    const response = await request(app)
      .get('/api/auth/account-status')
      .set('Authorization', 'Bearer valid.id.token');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Internal Server Error');
  });
});

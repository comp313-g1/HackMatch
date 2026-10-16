/**
 * US-004 S1-P1-11: POST /api/auth/mfa/verify
 * Validate and atomically consume the current OTP.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { mfaRepository } from '../db/mfa.repository.js';
import type { Participant, MfaChallenge, MfaAttempt } from '../db/types.js';
import { hashOtp } from '../utils/otp.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';

const mockVerifyIdToken = vi.fn();
const mockGetUser = vi.fn();
const mockSetCustomUserClaims = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    getUser: (...args: unknown[]) => mockGetUser(...args),
    setCustomUserClaims: (...args: unknown[]) => mockSetCustomUserClaims(...args),
    createUser: vi.fn(),
    deleteUser: vi.fn(),
    generateEmailVerificationLink: vi.fn(),
    verifyEmailActionCode: vi.fn(),
    createSessionCookie: vi.fn(),
    verifySessionCookie: vi.fn(),
    revokeRefreshTokens: vi.fn(),
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

const now = () => Math.floor(Date.now() / 1000);

const decoded = (overrides: Record<string, unknown> = {}) => ({
  uid: 'fb-uid-1',
  email: 'jane@example.com',
  email_verified: true,
  role: 'PART',
  auth_time: now() - 30,
  iat: now() - 30,
  exp: now() + 3600,
  firebase: { sign_in_provider: 'password', identities: {} },
  ...overrides,
});

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

const otp = '482913';
const activeChallenge: MfaChallenge = {
  id: 'challenge-uuid-1',
  participant_id: participant.id,
  otp_hash: hashOtp(otp),
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  consumed_at: null,
  invalidated_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('POST /api/auth/mfa/verify (US-004 S1-P1-11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ customClaims: { role: 'PART' } });
    mockSetCustomUserClaims.mockResolvedValue(undefined);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant);
    vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue([]);
    vi.spyOn(mfaRepository, 'getChallengeById').mockResolvedValue(activeChallenge);
    vi.spyOn(mfaRepository, 'tryConsumeChallenge').mockResolvedValue({
      ...activeChallenge,
      consumed_at: new Date().toISOString(),
    });
    vi.spyOn(mfaRepository, 'createAttempt').mockResolvedValue({
      id: 'att-1',
      participant_id: participant.id,
      challenge_id: activeChallenge.id,
      success: true,
      ip_address: null,
      created_at: new Date().toISOString(),
    } as MfaAttempt);
    vi.spyOn(mfaRepository, 'invalidatePendingChallenges').mockResolvedValue(0);
  });

  it('happy path: valid OTP consumes challenge and sets MFA claim', async () => {
    const token = decoded();
    mockVerifyIdToken.mockResolvedValueOnce(token);

    const response = await request(app)
      .post('/api/auth/mfa/verify')
      .set('Authorization', 'Bearer valid.id.token')
      .send({ challengeId: activeChallenge.id, code: otp });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ verified: true });
    expect(response.body.code).toBeUndefined();
    expect(mfaRepository.tryConsumeChallenge).toHaveBeenCalledWith(
      activeChallenge.id,
      hashOtp(otp)
    );
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      'fb-uid-1',
      expect.objectContaining({ [MFA_CLAIM]: token.auth_time })
    );
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('unauthorized: missing Authorization header → 401', async () => {
    const response = await request(app)
      .post('/api/auth/mfa/verify')
      .send({ challengeId: activeChallenge.id, code: otp });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
    expect(mfaRepository.tryConsumeChallenge).not.toHaveBeenCalled();
  });

  it('unauthorized: invalid bearer token → 401', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error('bad'), { code: 'auth/argument-error' })
    );

    const response = await request(app)
      .post('/api/auth/mfa/verify')
      .set('Authorization', 'Bearer bad.token')
      .send({ challengeId: activeChallenge.id, code: otp });

    expect(response.status).toBe(401);
    expect(mfaRepository.tryConsumeChallenge).not.toHaveBeenCalled();
  });

  it('rejects unverified email → 403 EMAIL_NOT_VERIFIED', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(decoded({ email_verified: false }));

    const response = await request(app)
      .post('/api/auth/mfa/verify')
      .set('Authorization', 'Bearer valid.id.token')
      .send({ challengeId: activeChallenge.id, code: otp });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(mfaRepository.tryConsumeChallenge).not.toHaveBeenCalled();
  });

  it('rejects suspended account → 403 ACCOUNT_SUSPENDED', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(decoded());
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
      ...participant,
      is_suspended: true,
    });

    const response = await request(app)
      .post('/api/auth/mfa/verify')
      .set('Authorization', 'Bearer valid.id.token')
      .send({ challengeId: activeChallenge.id, code: otp });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('invalid input: missing/malformed body → 400 validation errors', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(decoded());

    const response = await request(app)
      .post('/api/auth/mfa/verify')
      .set('Authorization', 'Bearer valid.id.token')
      .send({ challengeId: '', code: '12' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
    expect(response.body.errors.challengeId).toBeDefined();
    expect(response.body.errors.code).toBeDefined();
    expect(mfaRepository.tryConsumeChallenge).not.toHaveBeenCalled();
  });

  it('invalid OTP → 401 INVALID_OTP and does not set MFA claim', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(decoded());
    vi.spyOn(mfaRepository, 'tryConsumeChallenge').mockResolvedValueOnce(null);
    vi.spyOn(mfaRepository, 'getChallengeById')
      .mockResolvedValueOnce(activeChallenge)
      .mockResolvedValueOnce(activeChallenge);

    const response = await request(app)
      .post('/api/auth/mfa/verify')
      .set('Authorization', 'Bearer valid.id.token')
      .send({ challengeId: activeChallenge.id, code: '000000' });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_OTP');
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it('boundary: expired OTP → 400 OTP_EXPIRED', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(decoded());
    vi.spyOn(mfaRepository, 'getChallengeById').mockResolvedValueOnce({
      ...activeChallenge,
      expires_at: new Date(Date.now() - 5_000).toISOString(),
    });

    const response = await request(app)
      .post('/api/auth/mfa/verify')
      .set('Authorization', 'Bearer valid.id.token')
      .send({ challengeId: activeChallenge.id, code: otp });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('OTP_EXPIRED');
    expect(mfaRepository.tryConsumeChallenge).not.toHaveBeenCalled();
  });

  it('boundary: already consumed OTP → 400 OTP_CONSUMED', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(decoded());
    vi.spyOn(mfaRepository, 'getChallengeById').mockResolvedValueOnce({
      ...activeChallenge,
      consumed_at: new Date().toISOString(),
    });

    const response = await request(app)
      .post('/api/auth/mfa/verify')
      .set('Authorization', 'Bearer valid.id.token')
      .send({ challengeId: activeChallenge.id, code: otp });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('OTP_CONSUMED');
  });

  it('failure: MFA store unavailable → 503', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(decoded());
    vi.spyOn(mfaRepository, 'getRecentAttempts').mockRejectedValueOnce({
      code: '42P01',
      message: 'relation "mfa_attempts" does not exist',
    });

    const response = await request(app)
      .post('/api/auth/mfa/verify')
      .set('Authorization', 'Bearer valid.id.token')
      .send({ challengeId: activeChallenge.id, code: otp });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('MFA_STORE_UNAVAILABLE');
  });

  it('unknown challenge id → 404 CHALLENGE_NOT_FOUND', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(decoded());
    vi.spyOn(mfaRepository, 'getChallengeById').mockResolvedValueOnce(null);

    const response = await request(app)
      .post('/api/auth/mfa/verify')
      .set('Authorization', 'Bearer valid.id.token')
      .send({ challengeId: '00000000-0000-0000-0000-000000000000', code: otp });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('CHALLENGE_NOT_FOUND');
  });
});

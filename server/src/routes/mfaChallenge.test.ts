/**
 * US-004 S1-P1-09: POST /api/auth/mfa/challenge
 * Generate and email cryptographically random six-digit OTPs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { mfaRepository } from '../db/mfa.repository.js';
import type { Participant, MfaChallenge } from '../db/types.js';
import { _resetRateLimiter } from '../utils/rateLimiter.js';
import { _setMfaOtpEmailSender, _resetMfaOtpEmailSender } from '../controllers/auth.controller.js';
import { hashOtp } from '../utils/otp.js';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    createUser: vi.fn(),
    deleteUser: vi.fn(),
    setCustomUserClaims: vi.fn(),
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

const mockChallenge: MfaChallenge = {
  id: 'challenge-uuid-1',
  participant_id: participant.id,
  otp_hash: 'b'.repeat(64),
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('POST /api/auth/mfa/challenge (US-004 S1-P1-09)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimiter();
    _resetMfaOtpEmailSender();
    vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue([]);
    vi.spyOn(mfaRepository, 'invalidatePendingChallenges').mockResolvedValue(0);
    vi.spyOn(mfaRepository, 'createChallenge').mockResolvedValue(mockChallenge);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant);
  });

  it('happy path: authorized verified user receives challenge descriptor; OTP emailed and hashed', async () => {
    let capturedOtp = '';
    _setMfaOtpEmailSender(async (_email, otp) => {
      capturedOtp = otp;
    });
    mockVerifyIdToken.mockResolvedValueOnce(decoded());

    const response = await request(app)
      .post('/api/auth/mfa/challenge')
      .set('Authorization', 'Bearer valid.id.token');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      requiresOtp: true,
      challengeId: 'challenge-uuid-1',
      email: 'j***e@example.com',
      expiresInSeconds: 600,
    });
    expect(response.body.otp).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(capturedOtp);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(capturedOtp).toMatch(/^\d{6}$/);

    const createArg = vi.mocked(mfaRepository.createChallenge).mock.calls[0]?.[0];
    expect(createArg?.otp_hash).toBe(hashOtp(capturedOtp));
    // Resend/reissue path: predecessors invalidated before the new challenge is stored (AC 5).
    expect(mfaRepository.invalidatePendingChallenges).toHaveBeenCalledWith(participant.id);
  });

  it('unauthorized: missing Authorization header → 401', async () => {
    const response = await request(app).post('/api/auth/mfa/challenge');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
    expect(mfaRepository.createChallenge).not.toHaveBeenCalled();
  });

  it('unauthorized: invalid bearer token → 401', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error('bad'), { code: 'auth/argument-error' })
    );

    const response = await request(app)
      .post('/api/auth/mfa/challenge')
      .set('Authorization', 'Bearer bad.token');

    expect(response.status).toBe(401);
    expect(mfaRepository.createChallenge).not.toHaveBeenCalled();
  });

  it('rejects unverified email → 403 EMAIL_NOT_VERIFIED', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(decoded({ email_verified: false }));

    const response = await request(app)
      .post('/api/auth/mfa/challenge')
      .set('Authorization', 'Bearer valid.id.token');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(mfaRepository.createChallenge).not.toHaveBeenCalled();
  });

  it('rejects suspended account → 403 ACCOUNT_SUSPENDED', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(decoded());
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
      ...participant,
      is_suspended: true,
    });

    const response = await request(app)
      .post('/api/auth/mfa/challenge')
      .set('Authorization', 'Bearer valid.id.token');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ACCOUNT_SUSPENDED');
    expect(mfaRepository.createChallenge).not.toHaveBeenCalled();
  });

  it('returns 404 when no participant is linked to the Firebase user', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(decoded());
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(null);

    const response = await request(app)
      .post('/api/auth/mfa/challenge')
      .set('Authorization', 'Bearer valid.id.token');

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('PARTICIPANT_NOT_FOUND');
  });

  it('returns 502 EMAIL_DELIVERY_FAILED when the mailer throws (FR-084)', async () => {
    _setMfaOtpEmailSender(async () => {
      throw new Error('SMTP down');
    });
    mockVerifyIdToken.mockResolvedValueOnce(decoded());

    const response = await request(app)
      .post('/api/auth/mfa/challenge')
      .set('Authorization', 'Bearer valid.id.token');

    expect(response.status).toBe(502);
    expect(response.body.code).toBe('EMAIL_DELIVERY_FAILED');
    expect(response.body.retryable).toBe(true);
    expect(response.body.error).toMatch(/try again/i);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(mfaRepository.invalidatePendingChallenges).toHaveBeenCalled();
  });

  it('allows retry after EMAIL_DELIVERY_FAILED without hitting RATE_LIMITED (FR-084)', async () => {
    let calls = 0;
    _setMfaOtpEmailSender(async () => {
      calls += 1;
      if (calls === 1) throw new Error('SMTP down');
    });
    mockVerifyIdToken.mockResolvedValue(decoded());

    const failed = await request(app)
      .post('/api/auth/mfa/challenge')
      .set('Authorization', 'Bearer valid.id.token');
    expect(failed.status).toBe(502);
    expect(failed.body.code).toBe('EMAIL_DELIVERY_FAILED');

    const retried = await request(app)
      .post('/api/auth/mfa/challenge')
      .set('Authorization', 'Bearer valid.id.token');
    expect(retried.status).toBe(200);
    expect(retried.body.requiresOtp).toBe(true);
  });

  it('reuses the active challenge on rapid reissue instead of 429 when a code is still valid (#356)', async () => {
    _setMfaOtpEmailSender(async () => undefined);
    mockVerifyIdToken.mockResolvedValue(decoded());
    vi.spyOn(mfaRepository, 'getLatestActiveChallenge').mockResolvedValue(mockChallenge);

    const first = await request(app)
      .post('/api/auth/mfa/challenge')
      .set('Authorization', 'Bearer valid.id.token');
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/auth/mfa/challenge')
      .set('Authorization', 'Bearer valid.id.token');
    expect(second.status).toBe(200);
    expect(second.body.challengeId).toBe(mockChallenge.id);
    expect(second.body.message).toMatch(/already sent/i);
  });

  it('returns 429 RATE_LIMITED on rapid reissue when no active challenge can be reused (FR-081)', async () => {
    _setMfaOtpEmailSender(async () => undefined);
    mockVerifyIdToken.mockResolvedValue(decoded());
    vi.spyOn(mfaRepository, 'getLatestActiveChallenge').mockResolvedValue(null);

    const first = await request(app)
      .post('/api/auth/mfa/challenge')
      .set('Authorization', 'Bearer valid.id.token');
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/auth/mfa/challenge')
      .set('Authorization', 'Bearer valid.id.token');
    expect(second.status).toBe(429);
    expect(second.body.code).toBe('RATE_LIMITED');
    expect(second.headers['retry-after']).toBeDefined();
  });

  it('ADMIN primary auth can also request an OTP challenge', async () => {
    _setMfaOtpEmailSender(async () => undefined);
    mockVerifyIdToken.mockResolvedValueOnce(decoded({ role: 'ADMIN' }));
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
      ...participant,
      role: 'ADMIN',
    });

    const response = await request(app)
      .post('/api/auth/mfa/challenge')
      .set('Authorization', 'Bearer admin.id.token');

    expect(response.status).toBe(200);
    expect(response.body.requiresOtp).toBe(true);
  });

  it('returns 503 MFA_STORE_UNAVAILABLE when MFA tables are missing', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(decoded());
    vi.spyOn(mfaRepository, 'getRecentAttempts').mockRejectedValueOnce({
      code: '42P01',
      message: 'relation "mfa_attempts" does not exist',
    });

    const response = await request(app)
      .post('/api/auth/mfa/challenge')
      .set('Authorization', 'Bearer valid.id.token');

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('MFA_STORE_UNAVAILABLE');
  });

  it('five-attempt lock: blocks new OTP challenge with ACCOUNT_LOCKED (FR-010)', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(decoded());
    const fifthFailureTime = Date.now() - 120_000;
    vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `att-${i}`,
        participant_id: participant.id,
        challenge_id: null,
        success: false,
        ip_address: null,
        created_at: new Date(fifthFailureTime - i * 1000).toISOString(),
      }))
    );

    const response = await request(app)
      .post('/api/auth/mfa/challenge')
      .set('Authorization', 'Bearer valid.id.token');

    expect(response.status).toBe(423);
    expect(response.body.code).toBe('ACCOUNT_LOCKED');
    expect(response.body.retryAfter).toBeGreaterThan(0);
    expect(response.headers['retry-after']).toBeDefined();
    expect(mfaRepository.createChallenge).not.toHaveBeenCalled();
    expect(mfaRepository.invalidatePendingChallenges).toHaveBeenCalledWith(participant.id);
  });
});

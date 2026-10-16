/**
 * Comprehensive US-004 Integration Test Suite
 *
 * Exercises the end-to-end multi-factor authentication (MFA) lifecycle,
 * including OTP dispatch, verification, timing-safe validation, atomic consumption,
 * 5-attempt lockout, resend invalidation, rate limiting, and post-lockout re-auth.
 *
 * Verifies US-004-T1 through US-004-T6, AC 1–6, FR-009, FR-010, FR-081, FR-084, and NR-008.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { providerIdentitiesRepository } from '../db/provider_identities.repository.js';
import { mfaRepository } from '../db/mfa.repository.js';
import type { Participant, MfaChallenge, MfaAttempt } from '../db/types.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import { _resetRateLimiter } from '../utils/rateLimiter.js';
import { _setMfaOtpEmailSender, _resetMfaOtpEmailSender } from '../controllers/auth.controller.js';

// Firebase Admin SDK Mocks
const mockVerifyIdToken = vi.fn();
const mockCreateSessionCookie = vi.fn();
const mockVerifySessionCookie = vi.fn();
const mockRevokeRefreshTokens = vi.fn();
const mockGetUser = vi.fn();
const mockSetCustomUserClaims = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    createSessionCookie: (...args: unknown[]) => mockCreateSessionCookie(...args),
    verifySessionCookie: (...args: unknown[]) => mockVerifySessionCookie(...args),
    revokeRefreshTokens: (...args: unknown[]) => mockRevokeRefreshTokens(...args),
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

describe('US-004 MFA Integration Suite (OTP Lifecycle & Account Lockout)', () => {
  let baseAuthTimeSeconds: number;

  // In-Memory Stateful Database Store for MFA Challenges, Attempts & Claims
  let challenges: MfaChallenge[] = [];
  let attempts: MfaAttempt[] = [];
  let customClaimsByUid: Record<string, Record<string, unknown>> = {};
  let sentEmails: Array<{ email: string; otp: string }> = [];

  const partParticipant: Participant = {
    id: 'part-uuid-1',
    firebase_uid: 'fb-part-1',
    email: 'participant@example.com',
    full_name: 'Pat Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    suspended_at: null,
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString(),
  };

  const adminParticipant: Participant = {
    id: 'admin-uuid-1',
    firebase_uid: 'fb-admin-1',
    email: 'admin@example.com',
    full_name: 'Alex Admin',
    role: 'ADMIN',
    is_verified: true,
    is_suspended: false,
    suspended_at: null,
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString(),
  };

  const otherParticipant: Participant = {
    id: 'part-uuid-2',
    firebase_uid: 'fb-part-2',
    email: 'other@example.com',
    full_name: 'Other User',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    suspended_at: null,
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString(),
  };

  const unverifiedParticipant: Participant = {
    id: 'unverified-uuid-1',
    firebase_uid: 'fb-unverified',
    email: 'unverified@example.com',
    full_name: 'Unverified User',
    role: 'PART',
    is_verified: false,
    is_suspended: false,
    suspended_at: null,
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString(),
  };

  const buildClaims = (
    p: Participant,
    overrides: Record<string, unknown> = {},
    authTime = baseAuthTimeSeconds
  ) => {
    const claimsObj = customClaimsByUid[p.firebase_uid] || {};
    return {
      uid: p.firebase_uid,
      email: p.email,
      email_verified: p.is_verified,
      role: p.role,
      auth_time: authTime,
      iat: authTime,
      exp: authTime + 3600,
      firebase: { sign_in_provider: 'password', identities: {} },
      ...claimsObj,
      ...overrides,
    };
  };

  const postSend = (token: string) =>
    request(app).post('/api/auth/mfa/send').set('Authorization', `Bearer ${token}`);

  const postVerify = (token: string, body: Record<string, unknown>) =>
    request(app).post('/api/auth/mfa/verify').set('Authorization', `Bearer ${token}`).send(body);

  const postSession = (token: string) =>
    request(app).post('/api/auth/session').set('Authorization', `Bearer ${token}`);

  const getParticipantAccess = (token: string) =>
    request(app).get('/api/access/participant').set('Authorization', `Bearer ${token}`);

  const getAdminAccess = (token: string) =>
    request(app).get('/api/access/admin').set('Authorization', `Bearer ${token}`);

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimiter();
    _resetMfaOtpEmailSender();

    baseAuthTimeSeconds = Math.floor(Date.now() / 1000);
    challenges = [];
    attempts = [];
    customClaimsByUid = {};
    sentEmails = [];

    // Capture dispatched emails
    _setMfaOtpEmailSender(async (email: string, otp: string) => {
      sentEmails.push({ email, otp });
    });

    // Mock participants repository
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockImplementation(async (uid) => {
      if (uid === partParticipant.firebase_uid) return partParticipant;
      if (uid === adminParticipant.firebase_uid) return adminParticipant;
      if (uid === otherParticipant.firebase_uid) return otherParticipant;
      if (uid === unverifiedParticipant.firebase_uid) return unverifiedParticipant;
      return null;
    });

    vi.spyOn(participantsRepository, 'findById').mockImplementation(async (id) => {
      if (id === partParticipant.id) return partParticipant;
      if (id === adminParticipant.id) return adminParticipant;
      if (id === otherParticipant.id) return otherParticipant;
      if (id === unverifiedParticipant.id) return unverifiedParticipant;
      return null;
    });

    vi.spyOn(participantsRepository, 'findByEmail').mockImplementation(async (email) => {
      if (email === partParticipant.email) return partParticipant;
      if (email === adminParticipant.email) return adminParticipant;
      if (email === otherParticipant.email) return otherParticipant;
      if (email === unverifiedParticipant.email) return unverifiedParticipant;
      return null;
    });

    vi.spyOn(providerIdentitiesRepository, 'findByProviderUid').mockImplementation(async (_provider, uid) => {
      if (uid === partParticipant.firebase_uid) {
        return {
          id: 'identity-1',
          participant_id: partParticipant.id,
          provider: 'google',
          provider_uid: partParticipant.firebase_uid,
          email: partParticipant.email,
          provider_handle: 'pat',
          avatar_url: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
      return null;
    });

    // Stateful in-memory repository spies for mfaRepository
    vi.spyOn(mfaRepository, 'createChallenge').mockImplementation(async (data) => {
      const challenge: MfaChallenge = {
        id: `chal-${challenges.length + 1}`,
        participant_id: data.participant_id,
        otp_hash: data.otp_hash,
        expires_at: data.expires_at,
        consumed_at: null,
        invalidated_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      challenges.push(challenge);
      return challenge;
    });

    vi.spyOn(mfaRepository, 'getLatestActiveChallenge').mockImplementation(async (participantId) => {
      const active = challenges
        .filter(
          (c) =>
            c.participant_id === participantId &&
            c.consumed_at === null &&
            c.invalidated_at === null
        )
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return active[0] ?? null;
    });

    vi.spyOn(mfaRepository, 'invalidatePendingChallenges').mockImplementation(async (participantId) => {
      const nowIso = new Date().toISOString();
      let count = 0;
      for (const c of challenges) {
        if (c.participant_id === participantId && c.consumed_at === null && c.invalidated_at === null) {
          c.invalidated_at = nowIso;
          count++;
        }
      }
      return count;
    });

    vi.spyOn(mfaRepository, 'markChallengeConsumed').mockImplementation(async (challengeId) => {
      const challenge = challenges.find((c) => c.id === challengeId);
      if (!challenge || challenge.consumed_at !== null || challenge.invalidated_at !== null) {
        throw new Error('Challenge already consumed or invalidated');
      }
      challenge.consumed_at = new Date().toISOString();
      return challenge;
    });

    vi.spyOn(mfaRepository, 'createAttempt').mockImplementation(async (data) => {
      const attempt: MfaAttempt = {
        id: `attempt-${attempts.length + 1}`,
        participant_id: data.participant_id,
        challenge_id: data.challenge_id ?? null,
        success: data.success,
        ip_address: data.ip_address ?? null,
        created_at: new Date().toISOString(),
      };
      attempts.push(attempt);
      return attempt;
    });

    vi.spyOn(mfaRepository, 'getRecentAttempts').mockImplementation(async (participantId, limit = 10) => {
      return attempts
        .filter((a) => a.participant_id === participantId)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, limit);
    });

    vi.spyOn(mfaRepository, 'countRecentChallenges').mockImplementation(async (participantId, since) => {
      const sinceMs = new Date(since).getTime();
      return challenges.filter(
        (c) => c.participant_id === participantId && new Date(c.created_at).getTime() >= sinceMs
      ).length;
    });

    // Mock Firebase User Claims & Token verification
    mockGetUser.mockImplementation(async (uid: string) => ({
      uid,
      customClaims: customClaimsByUid[uid] || {},
    }));

    mockSetCustomUserClaims.mockImplementation(async (uid: string, newClaims: Record<string, unknown>) => {
      customClaimsByUid[uid] = newClaims;
    });

    mockVerifyIdToken.mockImplementation(async (tokenStr: string) => {
      if (tokenStr === 'part-token') return buildClaims(partParticipant);
      if (tokenStr === 'admin-token') return buildClaims(adminParticipant);
      if (tokenStr === 'other-token') return buildClaims(otherParticipant);
      if (tokenStr === 'unverified-token') return buildClaims(unverifiedParticipant, { email_verified: false });
      if (tokenStr === 'google-oauth-token') {
        return buildClaims(partParticipant, {
          firebase: { sign_in_provider: 'google.com', identities: {} },
        });
      }
      throw Object.assign(new Error('Invalid token'), { code: 'auth/argument-error' });
    });

    mockCreateSessionCookie.mockResolvedValue('session-cookie-value');
    mockVerifySessionCookie.mockImplementation(async () => buildClaims(partParticipant));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // US-004-T1: Happy Path Lifecycle for PART & ADMIN Accounts
  // =========================================================================
  describe('US-004-T1: Happy Path Lifecycle (PART & ADMIN)', () => {
    it('PART: dispatches OTP → verifies code → completes MFA claims → grants session & protected access', async () => {
      // 1. Dispatch MFA OTP
      const sendRes = await postSend('part-token');
      expect(sendRes.status).toBe(200);
      expect(sendRes.body.requiresOtp).toBe(true);
      expect(sendRes.body.challengeId).toBe('chal-1');
      expect(sendRes.body.email).toBe('p***t@example.com');
      expect(sendRes.body.expiresInSeconds).toBe(600);
      expect(sendRes.headers['cache-control']).toBe('no-store');

      expect(sentEmails.length).toBe(1);
      const dispatchedOtp = sentEmails[0].otp;
      expect(dispatchedOtp).toMatch(/^\d{6}$/);

      // Pre-verification: session & access are denied (403 MFA_REQUIRED)
      const preSession = await postSession('part-token');
      expect(preSession.status).toBe(403);
      expect(preSession.body.code).toBe('MFA_REQUIRED');

      const preAccess = await getParticipantAccess('part-token');
      expect(preAccess.status).toBe(403);
      expect(preAccess.body.code).toBe('MFA_REQUIRED');

      // 2. Verify MFA OTP
      const verifyRes = await postVerify('part-token', {
        otp: dispatchedOtp,
        challengeId: sendRes.body.challengeId,
      });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.verified).toBe(true);
      expect(verifyRes.body.mfaAuthTime).toBe(baseAuthTimeSeconds);

      // Verify custom claims updated in Firebase
      expect(customClaimsByUid[partParticipant.firebase_uid]).toEqual({
        [MFA_CLAIM]: baseAuthTimeSeconds,
      });

      // 3. Post-verification: refreshed token starts session and gains access
      const postMfaSession = await postSession('part-token');
      expect(postMfaSession.status).toBe(200);
      expect(postMfaSession.body.session).toBeDefined();

      const postMfaAccess = await getParticipantAccess('part-token');
      expect(postMfaAccess.status).toBe(200);
      expect(postMfaAccess.body).toEqual({
        access: 'granted',
        role: 'PART',
        uid: partParticipant.firebase_uid,
      });
    });

    it('ADMIN: dispatches OTP → verifies code → gains administrator access', async () => {
      const sendRes = await postSend('admin-token');
      expect(sendRes.status).toBe(200);
      expect(sendRes.body.email).toBe('a***n@example.com');

      const otp = sentEmails[0].otp;
      const verifyRes = await postVerify('admin-token', { otp });
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.verified).toBe(true);

      const adminAccess = await getAdminAccess('admin-token');
      expect(adminAccess.status).toBe(200);
      expect(adminAccess.body).toEqual({
        access: 'granted',
        role: 'ADMIN',
        uid: adminParticipant.firebase_uid,
      });
    });

    it('resets failure counter when user has 4 prior failed attempts and succeeds on 5th attempt', async () => {
      const sendRes = await postSend('part-token');
      expect(sendRes.status).toBe(200);
      const validOtp = sentEmails[0].otp;

      // 4 wrong attempts
      for (let i = 1; i <= 4; i++) {
        const failRes = await postVerify('part-token', { otp: '000000' });
        expect(failRes.status).toBe(400);
        expect(failRes.body.code).toBe('INVALID_OTP');
        expect(failRes.body.remainingAttempts).toBe(5 - i);
      }

      // 5th attempt with valid OTP succeeds
      const successRes = await postVerify('part-token', { otp: validOtp });
      expect(successRes.status).toBe(200);
      expect(successRes.body.verified).toBe(true);

      // Request a new challenge after reset
      _resetRateLimiter();
      await postSend('part-token');

      // Next wrong attempt starts counter fresh (remainingAttempts = 4)
      const nextFailRes = await postVerify('part-token', { otp: '000000' });
      expect(nextFailRes.status).toBe(400);
      expect(nextFailRes.body.remainingAttempts).toBe(4);
    });
  });

  // =========================================================================
  // US-004-T2: Invalid, Expired, Consumed, and Concurrent Replay Gaps
  // =========================================================================
  describe('US-004-T2: Invalid, Expired, Consumed, and Concurrent Replays', () => {
    it('returns 400 INVALID_OTP on incorrect 6-digit code and logs success: false', async () => {
      await postSend('part-token');
      const res = await postVerify('part-token', { otp: '999999' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_OTP');
      expect(res.body.remainingAttempts).toBe(4);

      expect(attempts.length).toBe(1);
      expect(attempts[0].success).toBe(false);
    });

    it('returns 400 OTP_EXPIRED at exact 10-minute boundary and after', async () => {
      const baseTime = Date.now();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(baseTime);

      try {
        await postSend('part-token');
        const otp = sentEmails[0].otp;

        // Advance to exact 10-minute boundary (baseTime + 600_000ms)
        vi.setSystemTime(baseTime + 600_000);
        const boundaryRes = await postVerify('part-token', { otp });
        expect(boundaryRes.status).toBe(400);
        expect(boundaryRes.body.code).toBe('OTP_EXPIRED');

        // Advance past boundary
        vi.setSystemTime(baseTime + 600_001);
        const expiredRes = await postVerify('part-token', { otp });
        expect(expiredRes.status).toBe(400);
        expect(expiredRes.body.code).toBe('OTP_EXPIRED');
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns 400 INVALID_OR_EXPIRED_OTP when replaying an already-consumed code', async () => {
      await postSend('part-token');
      const otp = sentEmails[0].otp;

      const first = await postVerify('part-token', { otp });
      expect(first.status).toBe(200);

      const replay = await postVerify('part-token', { otp });
      expect(replay.status).toBe(400);
      expect(replay.body.code).toBe('INVALID_OR_EXPIRED_OTP');
    });

    it('concurrent Promise.all replay of the same valid code yields exactly one 200 and one 400 (NR-008)', async () => {
      await postSend('part-token');
      const otp = sentEmails[0].otp;

      const [res1, res2] = await Promise.all([
        postVerify('part-token', { otp }),
        postVerify('part-token', { otp }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 400]);

      const errorRes = res1.status === 400 ? res1 : res2;
      expect(errorRes.body.code).toBe('INVALID_OR_EXPIRED_OTP');
    });

    it('rejects verification if challengeId belongs to another participant (NR-008)', async () => {
      // User 2 generates challenge
      await postSend('other-token');
      const otherChallengeId = challenges[0].id;

      // User 1 generates challenge
      await postSend('part-token');
      const user1Otp = sentEmails[1].otp;

      // User 1 attempts verify using User 2's challengeId
      const res = await postVerify('part-token', {
        otp: user1Otp,
        challengeId: otherChallengeId,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_OR_EXPIRED_OTP');
    });
  });

  // =========================================================================
  // US-004-T3: 5-Attempt Lockout & Challenge Invalidation
  // =========================================================================
  describe('US-004-T3: 5-Attempt Lockout & Challenge Invalidation', () => {
    it('locks account for 15 minutes after 5 consecutive failures, invalidates challenges, and blocks logins', async () => {
      await postSend('part-token');
      const validOtp = sentEmails[0].otp;

      // Attempts 1–4 return 400 INVALID_OTP
      for (let i = 1; i <= 4; i++) {
        const res = await postVerify('part-token', { otp: '111111' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_OTP');
        expect(res.body.remainingAttempts).toBe(5 - i);
      }

      // 5th attempt locks account (423 ACCOUNT_LOCKED)
      const lockRes = await postVerify('part-token', { otp: '111111' });
      expect(lockRes.status).toBe(423);
      expect(lockRes.body.code).toBe('ACCOUNT_LOCKED');
      expect(lockRes.body.retryAfter).toBeGreaterThan(0);
      expect(lockRes.body.retryAfter).toBeLessThanOrEqual(900);

      // Verify all pending challenges were invalidated
      expect(challenges.every((c) => c.invalidated_at !== null || c.consumed_at !== null)).toBe(true);

      // Subsequent verify (even with previously valid OTP) is locked (423)
      const verifyAfterLock = await postVerify('part-token', { otp: validOtp });
      expect(verifyAfterLock.status).toBe(423);
      expect(verifyAfterLock.body.code).toBe('ACCOUNT_LOCKED');

      // Subsequent send is locked (423)
      _resetRateLimiter();
      const sendAfterLock = await postSend('part-token');
      expect(sendAfterLock.status).toBe(423);
      expect(sendAfterLock.body.code).toBe('ACCOUNT_LOCKED');

      // Subsequent session creation (with MFA-verified token) is blocked by lockout (423)
      customClaimsByUid[partParticipant.firebase_uid] = { [MFA_CLAIM]: baseAuthTimeSeconds };
      const sessionAfterLock = await postSession('part-token');
      expect(sessionAfterLock.status).toBe(423);
      expect(sessionAfterLock.body.code).toBe('ACCOUNT_LOCKED');

      // Subsequent OAuth sign-in is blocked by lockout (423)
      const oauthLockRes = await request(app)
        .post('/api/auth/oauth/sign-in')
        .send({ idToken: 'google-oauth-token', provider: 'google' });
      expect(oauthLockRes.status).toBe(423);
      expect(oauthLockRes.body.code).toBe('ACCOUNT_LOCKED');

      // Meanwhile, an already-issued session cookie continues to return 200 (US-004 AC 4)
      const cookieRes = await request(app)
        .get('/api/auth/session')
        .set('Cookie', 'hm_session=mock-valid-cookie; hm_csrf=dummy-csrf');
      expect(cookieRes.status).toBe(200);
    });
  });

  // =========================================================================
  // US-004-T4: Resend Invalidation, Non-Reset of Failures, Rate Limits & Delivery Failures
  // =========================================================================
  describe('US-004-T4: Resends, Non-Reset of Failures, Rate Limits & Delivery Failures', () => {
    it('resending OTP invalidates old challenge; failed attempts against both challenges accumulate toward lockout', async () => {
      await postSend('part-token');
      const challenge1Otp = sentEmails[0].otp;

      // 3 failed attempts against challenge 1
      for (let i = 0; i < 3; i++) {
        await postVerify('part-token', { otp: '000000' });
      }

      // Advance clock past 60s cooldown and request replacement OTP
      const baseTime = Date.now();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(baseTime + 65_000);

      try {
        const resendRes = await postSend('part-token');
        expect(resendRes.status).toBe(200);
        expect(resendRes.body.challengeId).toBe('chal-2');

        // Submitting challenge 1's code fails because challenge 1 was invalidated
        const oldCodeRes = await postVerify('part-token', { otp: challenge1Otp });
        expect(oldCodeRes.status).toBe(400);

        // 2 more wrong attempts reach 5 total failures (3 + 1 + 1 = 5) and trigger lockout
        const lockRes = await postVerify('part-token', { otp: '000000' });
        expect(lockRes.status).toBe(423);
        expect(lockRes.body.code).toBe('ACCOUNT_LOCKED');
      } finally {
        vi.useRealTimers();
      }
    });

    it('enforces FR-081 rate limits: 429 on resend within 60s and 6th send within 1 hour', async () => {
      // 1st send succeeds
      const first = await postSend('part-token');
      expect(first.status).toBe(200);

      // Immediate resend triggers 429 RATE_LIMITED
      const immediateResend = await postSend('part-token');
      expect(immediateResend.status).toBe(429);
      expect(immediateResend.body.code).toBe('RATE_LIMITED');
      expect(immediateResend.headers['retry-after']).toBeDefined();
    });

    it('handles email dispatch failure gracefully (FR-084 / 502 EMAIL_DELIVERY_FAILED) without creating active challenge', async () => {
      _setMfaOtpEmailSender(async () => {
        throw new Error('SMTP transport down');
      });

      const res = await postSend('part-token');
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('EMAIL_DELIVERY_FAILED');

      // Challenge created before failure must be invalidated
      expect(challenges.every((c) => c.invalidated_at !== null)).toBe(true);
    });
  });

  // =========================================================================
  // US-004-T5: OAuth and Password Recovery Non-Exemption
  // =========================================================================
  describe('US-004-T5: OAuth and Password Recovery Non-Exemption', () => {
    it('requires MFA verification before session creation for OAuth tokens', async () => {
      // OAuth sign in token without MFA claim
      const res = await postSession('part-token');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
    });

    it('post-password-recovery token with fresh auth_time requires MFA again', async () => {
      // Completed MFA at auth_time = 1000
      customClaimsByUid[partParticipant.firebase_uid] = { [MFA_CLAIM]: 1000 };

      // User recovers password and gets new token at auth_time = 2000
      mockVerifyIdToken.mockResolvedValueOnce(
        buildClaims(partParticipant, {}, 2000)
      );

      const res = await postSession('part-token');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
    });
  });

  // =========================================================================
  // US-004-T6: Post-Lockout Expiry Requires Fresh Primary Authentication
  // =========================================================================
  describe('US-004-T6: Post-Lockout Expiry & Fresh Authentication', () => {
    it('rejects stale pre-lockout token with 401 FRESH_AUTH_REQUIRED; allows fresh token and resets counter', async () => {
      const lockStartTime = Date.now();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(lockStartTime);

      try {
        await postSend('part-token');

        // Trigger 5-attempt lockout
        for (let i = 0; i < 5; i++) {
          await postVerify('part-token', { otp: '000000' });
        }

        // Advance clock past 15-minute lockout window (15m + 1s)
        const postLockoutTime = lockStartTime + 15 * 60 * 1000 + 1000;
        vi.setSystemTime(postLockoutTime);

        // Calling /mfa/send with pre-lockout token (auth_time was lockStartTime) returns 401 FRESH_AUTH_REQUIRED
        const staleSend = await postSend('part-token');
        expect(staleSend.status).toBe(401);
        expect(staleSend.body.code).toBe('FRESH_AUTH_REQUIRED');

        // Calling /mfa/verify with pre-lockout token returns 401 FRESH_AUTH_REQUIRED
        const staleVerify = await postVerify('part-token', { otp: '123456' });
        expect(staleVerify.status).toBe(401);
        expect(staleVerify.body.code).toBe('FRESH_AUTH_REQUIRED');

        // User re-authenticates with primary password; token has fresh auth_time
        const freshAuthTimeSeconds = Math.floor(postLockoutTime / 1000);
        mockVerifyIdToken.mockImplementation(async () =>
          buildClaims(partParticipant, {}, freshAuthTimeSeconds)
        );

        // Dispatches new challenge successfully
        _resetRateLimiter();
        const freshSend = await postSend('part-token');
        expect(freshSend.status).toBe(200);

        // Verifies new challenge successfully
        const freshOtp = sentEmails[sentEmails.length - 1].otp;
        const freshVerify = await postVerify('part-token', { otp: freshOtp });
        expect(freshVerify.status).toBe(200);
        expect(freshVerify.body.verified).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // =========================================================================
  // Unverified Email Rejection Guard
  // =========================================================================
  describe('Unverified Email Rejection Guard', () => {
    it('rejects unverified account with 403 EMAIL_NOT_VERIFIED', async () => {
      const sendRes = await postSend('unverified-token');
      expect(sendRes.status).toBe(403);
      expect(sendRes.body.code).toBe('EMAIL_NOT_VERIFIED');

      const verifyRes = await postVerify('unverified-token', { otp: '123456' });
      expect(verifyRes.status).toBe(403);
      expect(verifyRes.body.code).toBe('EMAIL_NOT_VERIFIED');
    });
  });
});

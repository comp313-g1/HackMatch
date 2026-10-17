/**
 * US-005 password-recovery integration tests (S1-P3-05).
 *
 * Exercises the Express + Firebase Admin (mocked) + participant/MFA repository chain
 * for request → validate → confirm → post-reset session denial.
 * Maps to acceptance tests US-005-T1 … US-005-T5.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { mfaRepository } from '../db/mfa.repository.js';
import type { Participant } from '../db/types.js';
import { _resetRateLimiter } from '../utils/rateLimiter.js';
import { _resetConsumedPasswordResetCodes } from '../utils/consumedResetCodes.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';

const mockGeneratePasswordResetLink = vi.fn();
const mockGetUserByEmail = vi.fn();
const mockGetUser = vi.fn();
const mockSetCustomUserClaims = vi.fn();
const mockInspectPasswordResetCode = vi.fn();
const mockConfirmPasswordResetCode = vi.fn();
const mockRevokeRefreshTokens = vi.fn();
const mockVerifyIdToken = vi.fn();
const mockCreateSessionCookie = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    generatePasswordResetLink: (...args: unknown[]) => mockGeneratePasswordResetLink(...args),
    getUserByEmail: (...args: unknown[]) => mockGetUserByEmail(...args),
    getUser: (...args: unknown[]) => mockGetUser(...args),
    setCustomUserClaims: (...args: unknown[]) => mockSetCustomUserClaims(...args),
    inspectPasswordResetCode: (...args: unknown[]) => mockInspectPasswordResetCode(...args),
    confirmPasswordResetCode: (...args: unknown[]) => mockConfirmPasswordResetCode(...args),
    revokeRefreshTokens: (...args: unknown[]) => mockRevokeRefreshTokens(...args),
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    createSessionCookie: (...args: unknown[]) => mockCreateSessionCookie(...args),
  };
  return {
    firebaseAuth: authMock,
    auth: authMock,
    getFirebaseAdminAuth: vi.fn(),
    inspectPasswordResetCode: (...args: unknown[]) => mockInspectPasswordResetCode(...args),
    confirmPasswordResetCode: (...args: unknown[]) => mockConfirmPasswordResetCode(...args),
    sendPasswordResetEmail: vi.fn(),
    _resetFirebaseInstances: vi.fn(),
  };
});

const GENERIC_REQUEST_MESSAGE =
  'If an account exists for that email, you will receive password reset instructions shortly. If you signed in with Google or GitHub, use that provider to regain access.';

const credentialParticipant = (): Participant => ({
  id: 'part-uuid-credential',
  firebase_uid: 'fb-uid-credential',
  email: 'credential@example.com',
  full_name: 'Credential User',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const oauthParticipant = (): Participant => ({
  ...credentialParticipant(),
  id: 'part-uuid-oauth',
  firebase_uid: 'fb-uid-oauth',
  email: 'oauth@example.com',
  full_name: 'OAuth User',
});

describe('US-005 password recovery integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    _resetRateLimiter();
    _resetConsumedPasswordResetCodes();

    mockGeneratePasswordResetLink.mockResolvedValue('https://example.com/reset');
    mockRevokeRefreshTokens.mockResolvedValue(undefined);
    mockSetCustomUserClaims.mockResolvedValue(undefined);
    mockCreateSessionCookie.mockResolvedValue('should-not-be-issued');
    mockGetUser.mockResolvedValue({
      uid: 'fb-uid-credential',
      customClaims: { role: 'PART', [MFA_CLAIM]: 1_700_000_000 },
    });
    mockInspectPasswordResetCode.mockResolvedValue({ email: 'credential@example.com' });
    mockConfirmPasswordResetCode.mockResolvedValue({
      email: 'credential@example.com',
      uid: 'fb-uid-credential',
    });
    mockGetUserByEmail.mockImplementation(async (email: string) => {
      if (email === 'credential@example.com') {
        return {
          uid: 'fb-uid-credential',
          email,
          providerData: [{ providerId: 'password' }],
        };
      }
      if (email === 'oauth@example.com') {
        return {
          uid: 'fb-uid-oauth',
          email,
          providerData: [{ providerId: 'google.com' }],
        };
      }
      const err = Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
      throw err;
    });
    vi.spyOn(participantsRepository, 'findByEmail').mockImplementation(async (email) => {
      if (email === 'credential@example.com') return credentialParticipant();
      if (email === 'oauth@example.com') return oauthParticipant();
      return null;
    });
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(
      credentialParticipant()
    );
    vi.spyOn(mfaRepository, 'invalidatePendingChallenges').mockResolvedValue(1);
  });

  describe('US-005-T1: recovery request returns generic confirmation', () => {
    it('happy path: known credential email returns uniform 200 and dispatches reset', async () => {
      const response = await request(app)
        .post('/api/auth/password-reset')
        .send({ email: 'credential@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: GENERIC_REQUEST_MESSAGE });
      expect(response.body.token).toBeUndefined();
      expect(mockGeneratePasswordResetLink).toHaveBeenCalled();
    });

    it('unknown email: identical 200 body without dispatch (anti-enumeration)', async () => {
      const response = await request(app)
        .post('/api/auth/password-reset')
        .send({ email: 'ghost@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: GENERIC_REQUEST_MESSAGE });
      expect(mockGeneratePasswordResetLink).not.toHaveBeenCalled();
    });

    it('invalid input: empty and malformed email return 400 field errors', async () => {
      const missing = await request(app).post('/api/auth/password-reset').send({});
      expect(missing.status).toBe(400);
      expect(missing.body.errors.email).toMatch(/required/i);

      const bad = await request(app)
        .post('/api/auth/password-reset')
        .send({ email: 'not-an-email' });
      expect(bad.status).toBe(400);
      expect(bad.body.errors.email).toMatch(/valid email/i);
    });

    it('boundary: rate limit after consecutive requests (FR-081)', async () => {
      const first = await request(app)
        .post('/api/auth/password-reset')
        .send({ email: 'credential@example.com' });
      expect(first.status).toBe(200);

      const second = await request(app)
        .post('/api/auth/password-reset')
        .send({ email: 'credential@example.com' });
      expect(second.status).toBe(429);
      expect(second.body.code).toBe('RATE_LIMITED');
      expect(second.headers['retry-after']).toBeDefined();
    });
  });

  describe('US-005-T2: valid link + compliant password consumes the link', () => {
    it('validate → confirm happy path: password changes, link consumed, no session', async () => {
      const validated = await request(app)
        .post('/api/auth/password-reset/validate')
        .send({ oobCode: 'fresh-oob' });
      expect(validated.status).toBe(200);
      expect(validated.body).toEqual({
        state: 'valid',
        email: 'credential@example.com',
        accountType: 'credential',
      });

      const confirmed = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({
          oobCode: 'fresh-oob',
          newPassword: 'Valid1@Password',
          confirmPassword: 'Valid1@Password',
        });

      expect(confirmed.status).toBe(200);
      expect(confirmed.body).toMatchObject({
        signedIn: false,
        sessionIssued: false,
        requiresMfa: true,
        email: 'credential@example.com',
      });
      expect(mockConfirmPasswordResetCode).toHaveBeenCalledWith(
        'fresh-oob',
        'Valid1@Password'
      );
      expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('fb-uid-credential');
      expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-uid-credential', {
        role: 'PART',
      });
      expect(mfaRepository.invalidatePendingChallenges).toHaveBeenCalledWith(
        'part-uuid-credential'
      );

      const replay = await request(app)
        .post('/api/auth/password-reset/validate')
        .send({ oobCode: 'fresh-oob' });
      expect(replay.status).toBe(400);
      expect(replay.body).toMatchObject({ code: 'USED_ACTION_CODE', state: 'used' });
    });

    it('invalid input: weak password and mismatched confirm preserve field errors', async () => {
      const weak = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({
          oobCode: 'fresh-oob',
          newPassword: 'Pass12!',
          confirmPassword: 'Pass12!',
        });
      expect(weak.status).toBe(400);
      expect(weak.body.errors.newPassword).toMatch(/at least 8 characters/i);
      expect(mockConfirmPasswordResetCode).not.toHaveBeenCalled();

      const mismatch = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({
          oobCode: 'fresh-oob',
          newPassword: 'Valid1@Password',
          confirmPassword: 'Valid1@Other',
        });
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.errors.confirmPassword).toMatch(/do not match/i);
      expect(mockConfirmPasswordResetCode).not.toHaveBeenCalled();
    });

    it('boundary: password of length 7 fails; length 8 with full policy passes', async () => {
      const tooShort = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({
          oobCode: 'boundary-oob',
          newPassword: 'Valid1@',
          confirmPassword: 'Valid1@',
        });
      expect(tooShort.status).toBe(400);
      expect(mockConfirmPasswordResetCode).not.toHaveBeenCalled();

      const ok = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({
          oobCode: 'boundary-oob',
          newPassword: 'Valid1@x',
          confirmPassword: 'Valid1@x',
        });
      expect(ok.status).toBe(200);
      expect(mockConfirmPasswordResetCode).toHaveBeenCalled();
    });
  });

  describe('US-005-T3: expired, invalid, and used links leave password unchanged', () => {
    it('expired validate/confirm return EXPIRED_ACTION_CODE without confirm/revoke', async () => {
      mockInspectPasswordResetCode.mockRejectedValue(
        Object.assign(new Error('expired'), { code: 'auth/expired-action-code' })
      );

      const validated = await request(app)
        .post('/api/auth/password-reset/validate')
        .send({ oobCode: 'expired-oob' });
      expect(validated.status).toBe(400);
      expect(validated.body).toMatchObject({ code: 'EXPIRED_ACTION_CODE', state: 'expired' });

      const confirmed = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({
          oobCode: 'expired-oob',
          newPassword: 'Valid1@Password',
          confirmPassword: 'Valid1@Password',
        });
      expect(confirmed.status).toBe(400);
      expect(confirmed.body.state).toBe('expired');
      expect(mockConfirmPasswordResetCode).not.toHaveBeenCalled();
      expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
    });

    it('invalid/tampered links return INVALID_ACTION_CODE', async () => {
      mockInspectPasswordResetCode.mockRejectedValue(
        Object.assign(new Error('bad'), { code: 'auth/invalid-action-code' })
      );

      const response = await request(app)
        .post('/api/auth/password-reset/validate')
        .send({ oobCode: 'tampered' });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'INVALID_ACTION_CODE', state: 'invalid' });
    });

    it('used links return USED_ACTION_CODE after a successful confirm', async () => {
      const first = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({
          oobCode: 'once-oob',
          newPassword: 'Valid1@Password',
          confirmPassword: 'Valid1@Password',
        });
      expect(first.status).toBe(200);

      mockConfirmPasswordResetCode.mockClear();
      const second = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({
          oobCode: 'once-oob',
          newPassword: 'Valid1@Password',
          confirmPassword: 'Valid1@Password',
        });
      expect(second.status).toBe(400);
      expect(second.body).toMatchObject({ code: 'USED_ACTION_CODE', state: 'used' });
      expect(mockConfirmPasswordResetCode).not.toHaveBeenCalled();
    });
  });

  describe('US-005-T4: after reset, old sessions are unauthorized without MFA', () => {
    it('confirm revokes refresh tokens and session create returns MFA_REQUIRED', async () => {
      const confirmed = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({
          oobCode: 'post-reset-oob',
          newPassword: 'Valid1@Password',
          confirmPassword: 'Valid1@Password',
        });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.requiresMfa).toBe(true);
      expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('fb-uid-credential');

      // Unauthorized for protected session: password-only token (stale MFA claim).
      const authTime = 1_800_000_000;
      mockVerifyIdToken.mockResolvedValueOnce({
        uid: 'fb-uid-credential',
        email: 'credential@example.com',
        role: 'PART',
        auth_time: authTime,
        exp: authTime + 3600,
        [MFA_CLAIM]: 1_700_000_000,
        firebase: { sign_in_provider: 'password' },
      });

      const session = await request(app)
        .post('/api/auth/session')
        .set('Authorization', 'Bearer post-reset.id.token');

      expect(session.status).toBe(403);
      expect(session.body.code).toBe('MFA_REQUIRED');
      expect(mockCreateSessionCookie).not.toHaveBeenCalled();
    });

    it('failure handling: revoke failure returns 502 REVOCATION_FAILED after password change', async () => {
      mockRevokeRefreshTokens.mockRejectedValueOnce(new Error('admin down'));

      const response = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({
          oobCode: 'revoke-fail-oob',
          newPassword: 'Valid1@Password',
          confirmPassword: 'Valid1@Password',
        });

      expect(response.status).toBe(502);
      expect(response.body).toMatchObject({
        code: 'REVOCATION_FAILED',
        signedIn: false,
        sessionIssued: false,
        requiresMfa: true,
      });
      expect(mockConfirmPasswordResetCode).toHaveBeenCalled();
    });
  });

  describe('US-005-T5: OAuth-only recovery without account-type disclosure on request', () => {
    it('request: OAuth-only email still gets generic 200 without sending a reset', async () => {
      const response = await request(app)
        .post('/api/auth/password-reset')
        .send({ email: 'oauth@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: GENERIC_REQUEST_MESSAGE });
      // Dispatch skipped when Firebase user has no password provider.
      expect(mockGeneratePasswordResetLink).not.toHaveBeenCalled();
    });

    it('validate/confirm: OAuth recovery state is explicit when a link is presented', async () => {
      mockInspectPasswordResetCode.mockResolvedValue({ email: 'oauth@example.com' });

      const validated = await request(app)
        .post('/api/auth/password-reset/validate')
        .send({ oobCode: 'oauth-oob' });
      expect(validated.status).toBe(200);
      expect(validated.body).toMatchObject({
        state: 'oauth',
        code: 'OAUTH_RECOVERY_REQUIRED',
        email: 'oauth@example.com',
      });

      const confirmed = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({
          oobCode: 'oauth-oob',
          newPassword: 'Valid1@Password',
          confirmPassword: 'Valid1@Password',
        });
      expect(confirmed.status).toBe(403);
      expect(confirmed.body).toMatchObject({
        code: 'OAUTH_RECOVERY_REQUIRED',
        state: 'oauth',
      });
      expect(mockConfirmPasswordResetCode).not.toHaveBeenCalled();
    });
  });
});

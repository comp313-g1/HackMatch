import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { providerIdentitiesRepository } from '../db/provider_identities.repository.js';
import { mfaRepository } from '../db/mfa.repository.js';
import type { Participant, ProviderIdentity, MfaChallenge, MfaAttempt } from '../db/types.js';
import { _resetRateLimiter } from '../utils/rateLimiter.js';
import { _setMfaOtpEmailSender, _resetMfaOtpEmailSender } from '../controllers/auth.controller.js';

// Mock Firebase Admin module to operate 100% offline without live Google Cloud credentials
// and avoid the throwing offline proxy in server/src/config/firebase.ts
const mockCreateUser = vi.fn();
const mockDeleteUser = vi.fn();
const mockVerifyIdToken = vi.fn();
const mockSetCustomUserClaims = vi.fn();
const mockGenerateEmailVerificationLink = vi.fn();
const mockVerifyEmailActionCode = vi.fn();

vi.mock('../config/firebase.js', () => ({
  firebaseAuth: {
    createUser: (...args: unknown[]) => mockCreateUser(...args),
    deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    setCustomUserClaims: (...args: unknown[]) => mockSetCustomUserClaims(...args),
    generateEmailVerificationLink: (...args: unknown[]) => mockGenerateEmailVerificationLink(...args),
    verifyEmailActionCode: (...args: unknown[]) => mockVerifyEmailActionCode(...args),
  },
  auth: {
    createUser: (...args: unknown[]) => mockCreateUser(...args),
    deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    setCustomUserClaims: (...args: unknown[]) => mockSetCustomUserClaims(...args),
    generateEmailVerificationLink: (...args: unknown[]) => mockGenerateEmailVerificationLink(...args),
    verifyEmailActionCode: (...args: unknown[]) => mockVerifyEmailActionCode(...args),
  },
  verifyEmailActionCode: (...args: unknown[]) => mockVerifyEmailActionCode(...args),
  getFirebaseAdminAuth: vi.fn(),
  _resetFirebaseInstances: vi.fn(),
}));

describe('Auth Routes (POST /api/auth/register)', () => {
  const validPayload = {
    fullName: 'Jane Doe',
    email: 'jane.doe@example.com',
    password: 'Valid1@Password',
  };

  const mockCreatedFirebaseUser = {
    uid: 'fb-uid-12345',
    email: 'jane.doe@example.com',
    displayName: 'Jane Doe',
  };

  const mockCreatedParticipant: Participant = {
    id: 'part-uuid-999',
    firebase_uid: 'fb-uid-12345',
    email: 'jane.doe@example.com',
    full_name: 'Jane Doe',
    role: 'PART',
    is_verified: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimiter();
    mockCreateUser.mockResolvedValue(mockCreatedFirebaseUser);
    mockDeleteUser.mockResolvedValue(undefined);
    mockGenerateEmailVerificationLink.mockResolvedValue('https://example.com/verify');
    vi.spyOn(participantsRepository, 'createParticipant').mockResolvedValue(mockCreatedParticipant);
  });

  describe('Happy path registration', () => {
    it('creates Firebase auth user, persists participant record, and responds with 201', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send(validPayload);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        message: 'User registered successfully',
        user: {
          id: 'part-uuid-999',
          firebaseUid: 'fb-uid-12345',
          email: 'jane.doe@example.com',
          fullName: 'Jane Doe',
          role: 'PART',
          isVerified: false,
        },
        verificationEmailSent: true,
      });

      expect(mockCreateUser).toHaveBeenCalledWith({
        email: 'jane.doe@example.com',
        password: 'Valid1@Password',
        displayName: 'Jane Doe',
        emailVerified: false,
      });

      expect(participantsRepository.createParticipant).toHaveBeenCalledWith({
        firebase_uid: 'fb-uid-12345',
        email: 'jane.doe@example.com',
        full_name: 'Jane Doe',
        role: 'PART',
        is_verified: false,
      });

      expect(mockGenerateEmailVerificationLink).toHaveBeenCalledWith('jane.doe@example.com', {
        url: expect.stringContaining('/?mode=verifyEmail'),
      });
    });

    it('handles email verification link generation failure gracefully by returning 201 with verificationEmailSent: false (FR-084)', async () => {
      mockGenerateEmailVerificationLink.mockRejectedValueOnce(new Error('Network transport timeout'));

      const response = await request(app)
        .post('/api/auth/register')
        .send(validPayload);

      expect(response.status).toBe(201);
      expect(response.body.verificationEmailSent).toBe(false);
      expect(response.body.user.isVerified).toBe(false);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(participantsRepository.createParticipant).toHaveBeenCalled();
      expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it('enforces pre-auth session invariant (FR-007 / US-001 AC 5): sets zero cookies or tokens', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send(validPayload);

      expect(response.status).toBe(201);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.body.token).toBeUndefined();
      expect(response.body.accessToken).toBeUndefined();
      expect(response.body.refreshToken).toBeUndefined();
      expect(response.body.session).toBeUndefined();
    });

    it('permits non-academic commercial email domains per US-001 AC 1', async () => {
      const commercialPayload = {
        fullName: 'Alice Smith',
        email: 'alice.smith@gmail.com',
        password: 'Valid1@Password',
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(commercialPayload);

      expect(response.status).toBe(201);
      expect(mockCreateUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'alice.smith@gmail.com' })
      );
    });

    it('trims whitespace and normalizes email to lowercase', async () => {
      const unnormalizedPayload = {
        fullName: '  Jane Doe  ',
        email: '  JANE.DOE@Example.COM  ',
        password: 'Valid1@Password',
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(unnormalizedPayload);

      expect(response.status).toBe(201);
      expect(mockCreateUser).toHaveBeenCalledWith({
        email: 'jane.doe@example.com',
        password: 'Valid1@Password',
        displayName: 'Jane Doe',
        emailVerified: false,
      });
    });
  });

  describe('Server-side input validation (HTTP 400)', () => {
    it('rejects missing or empty request body', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.errors.fullName).toBe('Full name is required.');
      expect(response.body.errors.email).toBe('Email address is required.');
      expect(response.body.errors.password).toBe('Password is required.');
      expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it('rejects missing or whitespace-only fullName', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...validPayload, fullName: '   ' });

      expect(response.status).toBe(400);
      expect(response.body.errors.fullName).toBe('Full name is required.');
      expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it('rejects fullName exceeding 100 characters', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...validPayload, fullName: 'A'.repeat(101) });

      expect(response.status).toBe(400);
      expect(response.body.errors.fullName).toBe('Full name must not exceed 100 characters.');
      expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it('rejects missing or whitespace-only email', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...validPayload, email: '   ' });

      expect(response.status).toBe(400);
      expect(response.body.errors.email).toBe('Email address is required.');
      expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it('rejects malformed email addresses', async () => {
      const malformedEmails = ['plainaddress', 'missingatsign.com', 'user@', '@domain.com', 'user@domain'];

      for (const email of malformedEmails) {
        const response = await request(app)
          .post('/api/auth/register')
          .send({ ...validPayload, email });

        expect(response.status).toBe(400);
        expect(response.body.errors.email).toBe('Please provide a valid email address.');
      }
      expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it('rejects email exceeding 255 characters', async () => {
      const longEmail = `${'a'.repeat(250)}@example.com`;
      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...validPayload, email: longEmail });

      expect(response.status).toBe(400);
      expect(response.body.errors.email).toBe('Please provide a valid email address.');
      expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it('rejects missing or empty password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...validPayload, password: '' });

      expect(response.status).toBe(400);
      expect(response.body.errors.password).toBe('Password is required.');
      expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it('rejects passwords failing password-policy complexity rules', async () => {
      const testCases = [
        { pwd: 'Short1!', reason: 'fewer than 8 characters (boundary condition)' },
        { pwd: 'lowercase1@pass', reason: 'missing uppercase letter' },
        { pwd: 'UPPERCASE1@PASS', reason: 'missing lowercase letter' },
        { pwd: 'NoDigits!Pass', reason: 'missing digit' },
        { pwd: 'NoSpecial123Pass', reason: 'missing special character' },
      ];

      for (const { pwd } of testCases) {
        const response = await request(app)
          .post('/api/auth/register')
          .send({ ...validPayload, password: pwd });

        expect(response.status).toBe(400);
        expect(response.body.errors.password).toBe(
          'Password must be at least 8 characters long and include uppercase, lowercase, a number, and a special character.'
        );
      }
      expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it('accepts password exactly meeting boundary of 8 characters with all character classes', async () => {
      const boundaryPayload = {
        ...validPayload,
        password: 'Pass12!#', // exactly 8 characters: upper, lower, digit, special
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(boundaryPayload);

      expect(response.status).toBe(201);
      expect(mockCreateUser).toHaveBeenCalled();
    });
  });

  describe('Role boundary and ADMIN privilege escalation protection (US-001 AC 4 / US-001-T6)', () => {
    it('halts and returns HTTP 403 Forbidden when role: ADMIN is supplied', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...validPayload, role: 'ADMIN' });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Public registration cannot grant administrative privileges.',
      });
      expect(mockCreateUser).not.toHaveBeenCalled();
      expect(participantsRepository.createParticipant).not.toHaveBeenCalled();
    });

    it('halts and returns HTTP 403 Forbidden for case-insensitive role: admin', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...validPayload, role: 'admin' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Public registration cannot grant administrative privileges.');
      expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it('halts and returns HTTP 403 Forbidden for non-PART role like LEAD or SUPERADMIN', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...validPayload, role: 'SUPERADMIN' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Public registration cannot grant administrative privileges.');
      expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it('halts and returns HTTP 403 Forbidden when privilege escalation alias parameters are sent', async () => {
      const aliasPayloads = [
        { isAdmin: true },
        { is_admin: true },
        { claims: { admin: true } },
        { customClaims: { role: 'ADMIN' } },
        { roles: ['ADMIN'] },
      ];

      for (const alias of aliasPayloads) {
        const response = await request(app)
          .post('/api/auth/register')
          .send({ ...validPayload, ...alias });

        expect(response.status).toBe(403);
        expect(response.body).toEqual({
          error: 'Public registration cannot grant administrative privileges.',
        });
        expect(mockCreateUser).not.toHaveBeenCalled();
        expect(participantsRepository.createParticipant).not.toHaveBeenCalled();
      }
    });

    it('never invokes firebaseAuth.setCustomUserClaims across any registration requests', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ ...validPayload, role: 'ADMIN' });

      await request(app)
        .post('/api/auth/register')
        .send({ ...validPayload, isAdmin: true });

      await request(app)
        .post('/api/auth/register')
        .send(validPayload);

      expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    });

    it('accepts explicit role: PART without issue', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...validPayload, role: 'PART' });

      expect(response.status).toBe(201);
      expect(mockCreateUser).toHaveBeenCalled();
      expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    });
  });

  describe('Firebase error code translation', () => {
    it('translates auth/email-already-exists to HTTP 409 Conflict with EMAIL_ALREADY_IN_USE', async () => {
      mockCreateUser.mockRejectedValueOnce({
        code: 'auth/email-already-exists',
        message: 'The email address is already in use by another account.',
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send(validPayload);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'An account with this email already exists.',
        code: 'EMAIL_ALREADY_IN_USE',
      });
      expect(participantsRepository.createParticipant).not.toHaveBeenCalled();
    });

    it('translates auth/invalid-email to HTTP 400 Bad Request with INVALID_EMAIL', async () => {
      mockCreateUser.mockRejectedValueOnce({
        code: 'auth/invalid-email',
        message: 'The email address is badly formatted.',
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send(validPayload);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Invalid email address.',
        code: 'INVALID_EMAIL',
      });
    });

    it('translates auth/invalid-password to HTTP 400 Bad Request with WEAK_PASSWORD', async () => {
      mockCreateUser.mockRejectedValueOnce({
        code: 'auth/invalid-password',
        message: 'The password is too weak.',
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send(validPayload);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Password does not meet requirements.',
        code: 'WEAK_PASSWORD',
      });
    });

    it('translates auth/weak-password to HTTP 400 Bad Request with WEAK_PASSWORD', async () => {
      mockCreateUser.mockRejectedValueOnce({
        code: 'auth/weak-password',
        message: 'Password does not meet requirements.',
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send(validPayload);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Password does not meet requirements.',
        code: 'WEAK_PASSWORD',
      });
    });

    it('propagates unknown Firebase errors to 500 without leaking message in non-dev', async () => {
      mockCreateUser.mockRejectedValueOnce({
        code: 'auth/internal-error',
        message: 'Internal Firebase failure details that must not leak',
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send(validPayload);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal Server Error' });
      expect(response.body.message).toBeUndefined();
      expect(participantsRepository.createParticipant).not.toHaveBeenCalled();
    });
  });

  describe('Compensatory rollback on database persistence failure', () => {
    it('deletes created Firebase user when database persistence throws a generic error', async () => {
      vi.spyOn(participantsRepository, 'createParticipant').mockRejectedValueOnce(
        new Error('Database network timeout')
      );

      const response = await request(app)
        .post('/api/auth/register')
        .send(validPayload);

      // Verifies compensatory rollback executed
      expect(mockDeleteUser).toHaveBeenCalledWith('fb-uid-12345');

      // Unhandled database error propagates to centralized error handler (HTTP 500)
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('translates database unique constraint violation (code 23505) to HTTP 409 after rollback', async () => {
      const dbError = new Error('duplicate key value violates unique constraint');
      (dbError as unknown as { code: string }).code = '23505';

      vi.spyOn(participantsRepository, 'createParticipant').mockRejectedValueOnce(dbError);

      const response = await request(app)
        .post('/api/auth/register')
        .send(validPayload);

      // Verifies compensatory rollback executed
      expect(mockDeleteUser).toHaveBeenCalledWith('fb-uid-12345');

      // Returns HTTP 409 Conflict with EMAIL_ALREADY_IN_USE
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'An account with this email already exists.',
        code: 'EMAIL_ALREADY_IN_USE',
      });
    });

    it('translates database error containing "duplicate" without error code to HTTP 409', async () => {
      vi.spyOn(participantsRepository, 'createParticipant').mockRejectedValueOnce(
        new Error('Key (email)=(jane.doe@example.com) already exists - duplicate entry')
      );

      const response = await request(app)
        .post('/api/auth/register')
        .send(validPayload);

      expect(mockDeleteUser).toHaveBeenCalledWith('fb-uid-12345');
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'An account with this email already exists.',
        code: 'EMAIL_ALREADY_IN_USE',
      });
    });

    it('gracefully handles failure inside compensatory deleteUser without masking initial error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(participantsRepository, 'createParticipant').mockRejectedValueOnce(
        new Error('Database failure')
      );
      mockDeleteUser.mockRejectedValueOnce(new Error('Firebase service unavailable'));

      const response = await request(app)
        .post('/api/auth/register')
        .send(validPayload);

      expect(mockDeleteUser).toHaveBeenCalledWith('fb-uid-12345');
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Routing and parser boundaries', () => {
    it('returns HTTP 400 Bad Request on malformed JSON body', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .set('Content-Type', 'application/json')
        .send('{ malformed: json');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
    });

    it('returns HTTP 404 Not Found on unsupported GET method', async () => {
      const response = await request(app).get('/api/auth/register');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Not Found' });
    });

    it('enforces role 403 precedence before field validation when both are invalid', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          role: 'ADMIN',
          email: 'invalid-email',
          fullName: '',
          password: 'short',
        });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Public registration cannot grant administrative privileges.',
      });
    });
  });

  describe('Security and leak prevention (Invariant L41 / FR-007 / US-001 AC 5)', () => {
    it('never leaks password or issues session cookies across 201, 400, 403, 409, and 500 responses', async () => {
      // 201
      const res201 = await request(app).post('/api/auth/register').send(validPayload);
      expect(res201.status).toBe(201);
      expect(JSON.stringify(res201.body)).not.toContain(validPayload.password);
      expect(res201.headers['set-cookie']).toBeUndefined();

      // 400 validation
      const res400 = await request(app).post('/api/auth/register').send({
        ...validPayload,
        fullName: '',
      });
      expect(res400.status).toBe(400);
      expect(JSON.stringify(res400.body)).not.toContain(validPayload.password);
      expect(res400.headers['set-cookie']).toBeUndefined();

      // 403 role escalation
      const res403 = await request(app).post('/api/auth/register').send({
        ...validPayload,
        role: 'ADMIN',
      });
      expect(res403.status).toBe(403);
      expect(JSON.stringify(res403.body)).not.toContain(validPayload.password);
      expect(res403.headers['set-cookie']).toBeUndefined();

      // 409 conflict
      mockCreateUser.mockRejectedValueOnce({ code: 'auth/email-already-exists' });
      const res409 = await request(app).post('/api/auth/register').send(validPayload);
      expect(res409.status).toBe(409);
      expect(JSON.stringify(res409.body)).not.toContain(validPayload.password);
      expect(res409.headers['set-cookie']).toBeUndefined();

      // 500 internal error
      mockCreateUser.mockRejectedValueOnce(new Error('Internal failure'));
      const res500 = await request(app).post('/api/auth/register').send(validPayload);
      expect(res500.status).toBe(500);
      expect(JSON.stringify(res500.body)).not.toContain(validPayload.password);
      expect(res500.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('US-001 verification (pending S1-P1-03 / S1-P2-01 / S1-P2-03 integration)', () => {
    it('T1 / AC 2: Verification link is dispatched after a successful registration; send failure never verifies the account (FR-084) (S1-P1-03)', async () => {
      // 1. Success dispatch case
      mockGenerateEmailVerificationLink.mockResolvedValueOnce('https://example.com/verify?oobCode=123');
      const resSuccess = await request(app)
        .post('/api/auth/register')
        .send(validPayload);

      expect(resSuccess.status).toBe(201);
      expect(resSuccess.body.verificationEmailSent).toBe(true);
      expect(resSuccess.body.user.isVerified).toBe(false);
      expect(mockGenerateEmailVerificationLink).toHaveBeenCalledWith(
        'jane.doe@example.com',
        { url: expect.stringContaining('/?mode=verifyEmail') }
      );

      // 2. Transport failure simulation (FR-084)
      _resetRateLimiter();
      mockGenerateEmailVerificationLink.mockRejectedValueOnce(
        new Error('SMTP/Firebase transport failure')
      );
      const resFailure = await request(app)
        .post('/api/auth/register')
        .send({
          ...validPayload,
          email: 'jane.retry@example.com',
        });

      expect(resFailure.status).toBe(201);
      expect(resFailure.body.verificationEmailSent).toBe(false);
      expect(resFailure.body.user.isVerified).toBe(false);
      expect(resFailure.headers['set-cookie']).toBeUndefined();
      expect(resFailure.body.token).toBeUndefined();
      expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it('T3 / AC 3: Valid action code sets emailVerified in Firebase, calls updateVerificationStatus(id, true), directs user to sign in, and issues no session cookie (AC 5 / FR-007) (S1-P1-03)', async () => {
      mockVerifyEmailActionCode.mockResolvedValueOnce({
        email: 'jane.doe@example.com',
        uid: 'fb-uid-12345',
      });
      vi.spyOn(participantsRepository, 'findByEmail').mockResolvedValueOnce(mockCreatedParticipant);
      const updateSpy = vi.spyOn(participantsRepository, 'updateVerificationStatus').mockResolvedValueOnce({
        ...mockCreatedParticipant,
        is_verified: true,
      });

      const response = await request(app)
        .post('/api/auth/verify-email')
        .send({ oobCode: 'valid-test-action-code' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Email verified successfully. Please proceed to sign in.',
        isVerified: true,
      });
      expect(updateSpy).toHaveBeenCalledWith('part-uuid-999', true);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.body.token).toBeUndefined();
      expect(response.body.accessToken).toBeUndefined();
      expect(response.body.refreshToken).toBeUndefined();
    });

    it('T4 / AC 3: Expired action code (auth/expired-action-code) fails, keeps is_verified false, and offers replacement link option (S1-P1-03 / S1-P2-03)', async () => {
      mockVerifyEmailActionCode.mockRejectedValueOnce({
        code: 'auth/expired-action-code',
        message: 'The action code has expired.',
      });
      const updateSpy = vi.spyOn(participantsRepository, 'updateVerificationStatus');

      const response = await request(app)
        .post('/api/auth/verify-email')
        .send({ oobCode: 'expired-action-code' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Verification link has expired. Please request a replacement link.',
        code: 'EXPIRED_ACTION_CODE',
      });
      expect(updateSpy).not.toHaveBeenCalled();
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('T4 / AC 3: Invalid or consumed action code (auth/invalid-action-code) fails without access (S1-P1-03 / S1-P2-03)', async () => {
      mockVerifyEmailActionCode.mockRejectedValueOnce({
        code: 'auth/invalid-action-code',
        message: 'The action code is invalid.',
      });
      const updateSpy = vi.spyOn(participantsRepository, 'updateVerificationStatus');

      const response = await request(app)
        .post('/api/auth/verify-email')
        .send({ oobCode: 'consumed-or-tampered-code' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Verification link is invalid or has already been used.',
        code: 'INVALID_ACTION_CODE',
      });
      expect(updateSpy).not.toHaveBeenCalled();
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('AC 3 / FR-081: Replacement verification link request is rate-limited and returns safe guidance without leaking account existence (S1-P1-03)', async () => {
      vi.spyOn(participantsRepository, 'findByEmail').mockImplementation(async (email) => {
        if (email === 'unverified@example.com') return mockCreatedParticipant;
        return null;
      });

      // 1. Initial valid request receives HTTP 200
      const firstRes = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'unverified@example.com' });

      expect(firstRes.status).toBe(200);
      expect(firstRes.body).toEqual({
        message: 'If an account exists for this address, a verification link has been sent.',
      });

      // 2. Immediate second request within 60s is rate-limited (HTTP 429)
      const secondRes = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'unverified@example.com' });

      expect(secondRes.status).toBe(429);
      expect(secondRes.headers['retry-after']).toBeDefined();
      expect(secondRes.body).toEqual({
        error: 'Too many requests. Please wait before requesting another verification email.',
        code: 'RATE_LIMITED',
        retryAfter: expect.any(Number),
      });

      // 3. Request for non-existent email receives identical HTTP 200 (anti-enumeration)
      const nonExistentRes = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'nonexistent-user@example.com' });

      expect(nonExistentRes.status).toBe(200);
      expect(nonExistentRes.body).toEqual({
        message: 'If an account exists for this address, a verification link has been sent.',
      });
    });
    it('T5 / AC 4: Unverified accounts are blocked with 403 and verification message on team creation, availability declaration, application, and invitation acceptance (S1-P2-01)', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'unverified-fb-uid' });
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        id: '22222222-2222-4222-8222-222222222222',
        firebase_uid: 'unverified-fb-uid',
        email: 'unverified@example.com',
        full_name: 'Unverified Candidate',
        role: 'PART',
        is_verified: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const endpoints = [
        '/api/teams',
        '/api/availability',
        '/api/applications',
        '/api/invitations/inv-123/accept',
      ];

      for (const endpoint of endpoints) {
        const response = await request(app)
          .post(endpoint)
          .set('Authorization', 'Bearer token-unverified')
          .send({});

        expect(response.status).toBe(403);
        expect(response.body).toEqual({
          error:
            'Email verification required. Unverified accounts cannot declare availability, create teams, apply, or accept invitations.',
          code: 'EMAIL_NOT_VERIFIED',
        });
      }
    });
    it.todo(
      'Client success view indicates verification link sent only when confirmed by backend dispatch (S1-P2-03)'
    );
  });
});

describe('Auth Routes (POST /api/auth/resend-verification)', () => {
  const unverifiedParticipant: Participant = {
    id: 'part-uuid-unverified',
    firebase_uid: 'fb-uid-unverified',
    email: 'unverified@example.com',
    full_name: 'Unverified User',
    role: 'PART',
    is_verified: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const verifiedParticipant: Participant = {
    id: 'part-uuid-verified',
    firebase_uid: 'fb-uid-verified',
    email: 'verified@example.com',
    full_name: 'Verified User',
    role: 'PART',
    is_verified: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimiter();
    mockGenerateEmailVerificationLink.mockResolvedValue('https://example.com/verify');
    vi.spyOn(participantsRepository, 'findByEmail').mockImplementation(async (email) => {
      if (email === 'unverified@example.com') return unverifiedParticipant;
      if (email === 'verified@example.com') return verifiedParticipant;
      return null;
    });
  });

  describe('Happy path and anti-enumeration', () => {
    it('dispatches link and returns uniform 200 for existing unverified user (zero session cookies)', async () => {
      const response = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'unverified@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'If an account exists for this address, a verification link has been sent.',
      });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.body.token).toBeUndefined();
      expect(mockGenerateEmailVerificationLink).toHaveBeenCalledWith(
        'unverified@example.com',
        { url: expect.stringContaining('/?mode=verifyEmail') }
      );
    });

    it('returns identical uniform 200 and suppresses send for already-verified account', async () => {
      const response = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'verified@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'If an account exists for this address, a verification link has been sent.',
      });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(mockGenerateEmailVerificationLink).not.toHaveBeenCalled();
    });

    it('returns identical uniform 200 and suppresses send for non-existent account', async () => {
      const response = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'nonexistent@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'If an account exists for this address, a verification link has been sent.',
      });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(mockGenerateEmailVerificationLink).not.toHaveBeenCalled();
    });

    it('normalizes email input by trimming whitespace and converting to lowercase', async () => {
      const response = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: '  UNVERIFIED@Example.COM  ' });

      expect(response.status).toBe(200);
      expect(mockGenerateEmailVerificationLink).toHaveBeenCalledWith(
        'unverified@example.com',
        expect.any(Object)
      );
    });
  });

  describe('Dual-tier rate limiting enforcement (FR-081)', () => {
    it('enforces 60-second cooldown on consecutive requests with HTTP 429 and Retry-After header', async () => {
      const first = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'unverified@example.com' });
      expect(first.status).toBe(200);

      const second = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'unverified@example.com' });

      expect(second.status).toBe(429);
      expect(second.headers['retry-after']).toBeDefined();
      expect(second.body).toEqual({
        error: 'Too many requests. Please wait before requesting another verification email.',
        code: 'RATE_LIMITED',
        retryAfter: expect.any(Number),
      });
      expect(second.headers['set-cookie']).toBeUndefined();
    });

    it('rate limits non-existent accounts identically to prevent enumeration oracles', async () => {
      const first = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'ghost@example.com' });
      expect(first.status).toBe(200);

      const second = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'ghost@example.com' });

      expect(second.status).toBe(429);
      expect(second.headers['retry-after']).toBeDefined();
      expect(second.body.code).toBe('RATE_LIMITED');
    });
  });

  describe('Delivery failure and payload validation', () => {
    it('handles email generation failure gracefully without leaking errors (FR-084)', async () => {
      mockGenerateEmailVerificationLink.mockRejectedValueOnce(new Error('Firebase service unavailable'));

      const response = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'unverified@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'If an account exists for this address, a verification link has been sent.',
      });
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('rejects missing or empty email payload with HTTP 400', async () => {
      const response = await request(app)
        .post('/api/auth/resend-verification')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Validation failed',
        errors: {
          email: 'Email address is required.',
        },
      });
    });

    it('rejects invalid email syntax with HTTP 400', async () => {
      const response = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'not-an-email' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Validation failed',
        errors: {
          email: 'Please provide a valid email address.',
        },
      });
    });
  });
});

describe('Auth Routes (POST /api/auth/verify-email)', () => {
  const unverifiedParticipant: Participant = {
    id: 'part-uuid-unverified',
    firebase_uid: 'fb-uid-unverified',
    email: 'unverified@example.com',
    full_name: 'Unverified User',
    role: 'PART',
    is_verified: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimiter();
    mockVerifyEmailActionCode.mockResolvedValue({
      email: 'unverified@example.com',
      uid: 'fb-uid-unverified',
    });
    vi.spyOn(participantsRepository, 'findByEmail').mockResolvedValue(unverifiedParticipant);
    vi.spyOn(participantsRepository, 'updateVerificationStatus').mockResolvedValue({
      ...unverifiedParticipant,
      is_verified: true,
    });
  });

  describe('Happy path action code processing', () => {
    it('verifies action code, marks participant verified, and responds with 200 (zero session cookies)', async () => {
      const response = await request(app)
        .post('/api/auth/verify-email')
        .send({ oobCode: 'valid-action-code-xyz' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Email verified successfully. Please proceed to sign in.',
        isVerified: true,
      });

      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.body.token).toBeUndefined();
      expect(response.body.accessToken).toBeUndefined();

      expect(mockVerifyEmailActionCode).toHaveBeenCalledWith('valid-action-code-xyz');
      expect(participantsRepository.findByEmail).toHaveBeenCalledWith('unverified@example.com');
      expect(participantsRepository.updateVerificationStatus).toHaveBeenCalledWith(
        'part-uuid-unverified',
        true
      );
    });
  });

  describe('Error handling and edge cases', () => {
    it('returns 404 when participant record does not exist for verified email', async () => {
      vi.spyOn(participantsRepository, 'findByEmail').mockResolvedValueOnce(null);

      const response = await request(app)
        .post('/api/auth/verify-email')
        .send({ oobCode: 'valid-action-code-xyz' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'Participant record not found.',
        code: 'PARTICIPANT_NOT_FOUND',
      });
      expect(participantsRepository.updateVerificationStatus).not.toHaveBeenCalled();
    });

    it('returns 400 EXPIRED_ACTION_CODE on auth/expired-action-code', async () => {
      mockVerifyEmailActionCode.mockRejectedValueOnce({
        code: 'auth/expired-action-code',
        message: 'The action code has expired.',
      });

      const response = await request(app)
        .post('/api/auth/verify-email')
        .send({ oobCode: 'expired-code-123' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Verification link has expired. Please request a replacement link.',
        code: 'EXPIRED_ACTION_CODE',
      });
      expect(participantsRepository.updateVerificationStatus).not.toHaveBeenCalled();
    });

    it('returns 400 INVALID_ACTION_CODE on auth/invalid-action-code', async () => {
      mockVerifyEmailActionCode.mockRejectedValueOnce({
        code: 'auth/invalid-action-code',
        message: 'The action code is invalid.',
      });

      const response = await request(app)
        .post('/api/auth/verify-email')
        .send({ oobCode: 'invalid-or-consumed-code' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Verification link is invalid or has already been used.',
        code: 'INVALID_ACTION_CODE',
      });
      expect(participantsRepository.updateVerificationStatus).not.toHaveBeenCalled();
    });

    it('rejects missing oobCode with HTTP 400', async () => {
      const response = await request(app)
        .post('/api/auth/verify-email')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Validation failed',
        errors: {
          oobCode: 'Action code is required.',
        },
      });
      expect(mockVerifyEmailActionCode).not.toHaveBeenCalled();
    });

    it('rejects whitespace-only oobCode with HTTP 400', async () => {
      const response = await request(app)
        .post('/api/auth/verify-email')
        .send({ oobCode: '   ' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Validation failed',
        errors: {
          oobCode: 'Action code is required.',
        },
      });
      expect(mockVerifyEmailActionCode).not.toHaveBeenCalled();
    });
  });
});

describe('Auth Routes (POST /api/auth/oauth/sign-in)', () => {
  const mockGoogleDecodedToken = {
    uid: 'google-uid-100',
    email: 'newuser@example.com',
    email_verified: true,
    name: 'New Google User',
    picture: 'https://lh3.googleusercontent.com/avatar1',
    firebase: {
      sign_in_provider: 'google.com',
    },
  };

  const mockGitHubDecodedToken = {
    uid: 'github-uid-200',
    email: 'gituser@example.com',
    email_verified: true,
    name: 'GitHub User',
    picture: 'https://avatars.githubusercontent.com/u/200',
    screen_name: 'gitdev',
    firebase: {
      sign_in_provider: 'github.com',
    },
  };

  const mockPartParticipant: Participant = {
    id: 'part-uuid-101',
    firebase_uid: 'google-uid-100',
    email: 'newuser@example.com',
    full_name: 'New Google User',
    role: 'PART',
    is_verified: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const mockExistingLinkedParticipant: Participant = {
    id: 'part-uuid-202',
    firebase_uid: 'github-uid-200',
    email: 'gituser@example.com',
    full_name: 'GitHub User',
    role: 'PART',
    is_verified: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const mockProviderIdentity: ProviderIdentity = {
    id: 'identity-uuid-1',
    participant_id: 'part-uuid-202',
    provider: 'github',
    provider_uid: 'github-uid-200',
    email: 'gituser@example.com',
    provider_handle: 'gitdev',
    avatar_url: 'https://avatars.githubusercontent.com/u/200',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const mockChallenge: MfaChallenge = {
    id: 'challenge-uuid-777',
    participant_id: 'part-uuid-101',
    otp_hash: 'a'.repeat(64),
    expires_at: new Date(Date.now() + 600000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimiter();
    _resetMfaOtpEmailSender();
    vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue([]);
    vi.spyOn(mfaRepository, 'invalidatePendingChallenges').mockResolvedValue(0);
    vi.spyOn(mfaRepository, 'createChallenge').mockResolvedValue(mockChallenge);
    vi.spyOn(providerIdentitiesRepository, 'findByProviderUid').mockResolvedValue(null);
    vi.spyOn(providerIdentitiesRepository, 'createProviderIdentity').mockResolvedValue(mockProviderIdentity);
    vi.spyOn(participantsRepository, 'createParticipant').mockResolvedValue(mockPartParticipant);
    vi.spyOn(participantsRepository, 'findByEmail').mockResolvedValue(null);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(mockPartParticipant);
  });

  describe('Happy path federated authentication (US-002-T1 / US-002 AC 5)', () => {
    it('provisions new PART user, creates provider identity, and returns OTP challenge without session (Google)', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(mockGoogleDecodedToken);
      vi.spyOn(providerIdentitiesRepository, 'findByProviderUid').mockResolvedValueOnce(null);
      vi.spyOn(participantsRepository, 'findByEmail').mockResolvedValueOnce(null);

      const response = await request(app)
        .post('/api/auth/oauth/sign-in')
        .send({
          idToken: 'valid-google-id-token',
          provider: 'google',
          consentHandleAvatar: true,
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        requiresOtp: true,
        challengeId: 'challenge-uuid-777',
        email: 'n***r@example.com',
        expiresInSeconds: 600,
        message: 'A 6-digit verification code has been sent to your email.',
      });

      // Assert zero session invariant (FR-007 / US-002-T6)
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.body.token).toBeUndefined();
      expect(response.body.accessToken).toBeUndefined();

      expect(mockVerifyIdToken).toHaveBeenCalledWith('valid-google-id-token');
      expect(participantsRepository.createParticipant).toHaveBeenCalledWith({
        firebase_uid: 'google-uid-100',
        email: 'newuser@example.com',
        full_name: 'New Google User',
        role: 'PART',
        is_verified: true,
      });
      expect(providerIdentitiesRepository.createProviderIdentity).toHaveBeenCalledWith({
        participant_id: 'part-uuid-101',
        provider: 'google',
        provider_uid: 'google-uid-100',
        email: 'newuser@example.com',
        provider_handle: 'New Google User',
        avatar_url: 'https://lh3.googleusercontent.com/avatar1',
      });
      expect(mfaRepository.createChallenge).toHaveBeenCalled();
    });

    it('resolves existing linked participant and routes into OTP challenge (GitHub)', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(mockGitHubDecodedToken);
      vi.spyOn(providerIdentitiesRepository, 'findByProviderUid').mockResolvedValueOnce(mockProviderIdentity);
      vi.spyOn(participantsRepository, 'findById').mockResolvedValueOnce(mockExistingLinkedParticipant);

      const response = await request(app)
        .post('/api/auth/oauth/sign-in')
        .send({
          idToken: 'valid-github-id-token',
          provider: 'github',
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        requiresOtp: true,
        challengeId: 'challenge-uuid-777',
        email: 'g***r@example.com',
        expiresInSeconds: 600,
        message: 'A 6-digit verification code has been sent to your email.',
      });

      expect(participantsRepository.createParticipant).not.toHaveBeenCalled();
      expect(providerIdentitiesRepository.createProviderIdentity).not.toHaveBeenCalled();
      expect(mfaRepository.createChallenge).toHaveBeenCalled();
    });

    it('does not store handle or avatar if consentHandleAvatar is omitted or false', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(mockGoogleDecodedToken);
      vi.spyOn(providerIdentitiesRepository, 'findByProviderUid').mockResolvedValueOnce(null);
      vi.spyOn(participantsRepository, 'findByEmail').mockResolvedValueOnce(null);

      const response = await request(app)
        .post('/api/auth/oauth/sign-in')
        .send({
          idToken: 'valid-google-id-token',
          provider: 'google',
          consentHandleAvatar: false,
        });

      expect(response.status).toBe(200);
      expect(providerIdentitiesRepository.createProviderIdentity).toHaveBeenCalledWith({
        participant_id: 'part-uuid-101',
        provider: 'google',
        provider_uid: 'google-uid-100',
        email: 'newuser@example.com',
        provider_handle: null,
        avatar_url: null,
      });
    });
  });

  describe('Account linking protection (US-002 AC 4 / US-002-T5)', () => {
    it('returns HTTP 409 LINKING_REAUTHENTICATION_REQUIRED when email matches existing participant but provider is not linked', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(mockGoogleDecodedToken);
      vi.spyOn(providerIdentitiesRepository, 'findByProviderUid').mockResolvedValueOnce(null);
      vi.spyOn(participantsRepository, 'findByEmail').mockResolvedValueOnce(mockPartParticipant);

      const response = await request(app)
        .post('/api/auth/oauth/sign-in')
        .send({
          idToken: 'google-token-matching-existing-user',
          provider: 'google',
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'An account with this email already exists. Please sign in with your password to link your provider.',
        code: 'LINKING_REAUTHENTICATION_REQUIRED',
      });

      expect(providerIdentitiesRepository.createProviderIdentity).not.toHaveBeenCalled();
      expect(mfaRepository.createChallenge).not.toHaveBeenCalled();
    });
  });

  describe('Security and credential validations', () => {
    it('rejects provider mismatch between request and ID token (HTTP 400 PROVIDER_MISMATCH)', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(mockGoogleDecodedToken);

      const response = await request(app)
        .post('/api/auth/oauth/sign-in')
        .send({
          idToken: 'google-token',
          provider: 'github',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Provider in request does not match the authentication credential.',
        code: 'PROVIDER_MISMATCH',
      });
      expect(participantsRepository.createParticipant).not.toHaveBeenCalled();
    });

    it('rejects unverified provider email with HTTP 403 UNVERIFIED_PROVIDER_EMAIL (US-002 AC 2 / US-002-T3)', async () => {
      mockVerifyIdToken.mockResolvedValueOnce({
        ...mockGoogleDecodedToken,
        email_verified: false,
      });

      const response = await request(app)
        .post('/api/auth/oauth/sign-in')
        .send({
          idToken: 'unverified-email-token',
          provider: 'google',
        });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'A verified provider email is required. Please sign up using standard email registration.',
        code: 'UNVERIFIED_PROVIDER_EMAIL',
      });
      expect(participantsRepository.createParticipant).not.toHaveBeenCalled();
    });

    it('rejects token missing email with HTTP 403 UNVERIFIED_PROVIDER_EMAIL', async () => {
      mockVerifyIdToken.mockResolvedValueOnce({
        ...mockGoogleDecodedToken,
        email: undefined,
      });

      const response = await request(app)
        .post('/api/auth/oauth/sign-in')
        .send({
          idToken: 'no-email-token',
          provider: 'google',
        });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'A verified provider email is required. Please sign up using standard email registration.',
        code: 'UNVERIFIED_PROVIDER_EMAIL',
      });
    });

    it('rejects admin authentication attempt with HTTP 403 ADMIN_OAUTH_PROHIBITED via token claim (US-002 AC 4 / FR-003)', async () => {
      mockVerifyIdToken.mockResolvedValueOnce({
        ...mockGoogleDecodedToken,
        role: 'ADMIN',
      });

      const response = await request(app)
        .post('/api/auth/oauth/sign-in')
        .send({
          idToken: 'admin-token',
          provider: 'google',
        });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Public OAuth cannot be used to authenticate an administrator account.',
        code: 'ADMIN_OAUTH_PROHIBITED',
      });
      expect(participantsRepository.createParticipant).not.toHaveBeenCalled();
    });

    it('rejects admin authentication attempt with HTTP 403 ADMIN_OAUTH_PROHIBITED via database participant role', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(mockGitHubDecodedToken);
      vi.spyOn(providerIdentitiesRepository, 'findByProviderUid').mockResolvedValueOnce(mockProviderIdentity);
      vi.spyOn(participantsRepository, 'findById').mockResolvedValueOnce({
        ...mockExistingLinkedParticipant,
        role: 'ADMIN',
      });

      const response = await request(app)
        .post('/api/auth/oauth/sign-in')
        .send({
          idToken: 'admin-participant-token',
          provider: 'github',
        });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Public OAuth cannot be used to authenticate an administrator account.',
        code: 'ADMIN_OAUTH_PROHIBITED',
      });
      expect(mfaRepository.createChallenge).not.toHaveBeenCalled();
    });

    it('rejects invalid or expired Firebase ID token with HTTP 401 INVALID_TOKEN', async () => {
      mockVerifyIdToken.mockRejectedValueOnce(new Error('Firebase ID token has expired or is invalid.'));

      const response = await request(app)
        .post('/api/auth/oauth/sign-in')
        .send({
          idToken: 'invalid-expired-token',
          provider: 'google',
        });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Invalid or expired authentication token. Please sign in again.',
        code: 'INVALID_TOKEN',
      });
    });
  });

  describe('Account lockout and rate limiting protections', () => {
    it('returns HTTP 423 ACCOUNT_LOCKED with retryAfter when 5 consecutive failures occur within 15 min (FR-010 / NR-008)', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(mockGitHubDecodedToken);
      vi.spyOn(providerIdentitiesRepository, 'findByProviderUid').mockResolvedValueOnce(mockProviderIdentity);
      vi.spyOn(participantsRepository, 'findById').mockResolvedValueOnce(mockExistingLinkedParticipant);

      const now = Date.now();
      const failedAttempts: MfaAttempt[] = Array.from({ length: 5 }, (_, i) => ({
        id: `att-${i}`,
        participant_id: mockExistingLinkedParticipant.id,
        challenge_id: 'ch-old',
        success: false,
        created_at: new Date(now - (5 - i) * 60000).toISOString(),
        ip_address: '127.0.0.1',
      }));
      vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValueOnce(failedAttempts);

      const response = await request(app)
        .post('/api/auth/oauth/sign-in')
        .send({
          idToken: 'locked-user-token',
          provider: 'github',
        });

      expect(response.status).toBe(423);
      expect(response.body.code).toBe('ACCOUNT_LOCKED');
      expect(response.body.error).toContain('Account temporarily locked');
      expect(typeof response.body.retryAfter).toBe('number');
      expect(response.body.retryAfter).toBeGreaterThan(0);
      expect(mfaRepository.createChallenge).not.toHaveBeenCalled();
    });

    it('enforces FR-081 rate limiting: second send within 60s returns HTTP 429 RATE_LIMITED with Retry-After', async () => {
      mockVerifyIdToken.mockResolvedValue(mockGitHubDecodedToken);
      vi.spyOn(providerIdentitiesRepository, 'findByProviderUid').mockResolvedValue(mockProviderIdentity);
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(mockExistingLinkedParticipant);

      // 1st request -> success
      const firstRes = await request(app)
        .post('/api/auth/oauth/sign-in')
        .send({ idToken: 'token-1', provider: 'github' });
      expect(firstRes.status).toBe(200);

      // 2nd request -> rate limited
      const secondRes = await request(app)
        .post('/api/auth/oauth/sign-in')
        .send({ idToken: 'token-2', provider: 'github' });

      expect(secondRes.status).toBe(429);
      expect(secondRes.body).toEqual({
        error: 'Too many OTP requests. Please wait before requesting another code.',
        code: 'RATE_LIMITED',
        retryAfter: expect.any(Number),
      });
      expect(secondRes.headers['retry-after']).toBeDefined();
    });
  });

  describe('Email dispatch failure handling (FR-084)', () => {
    it('invalidates pending challenge and returns HTTP 502 EMAIL_DELIVERY_FAILED when mail delivery fails', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(mockGitHubDecodedToken);
      vi.spyOn(providerIdentitiesRepository, 'findByProviderUid').mockResolvedValueOnce(mockProviderIdentity);
      vi.spyOn(participantsRepository, 'findById').mockResolvedValueOnce(mockExistingLinkedParticipant);

      _setMfaOtpEmailSender(async () => {
        throw new Error('SMTP transport gateway timeout');
      });

      const response = await request(app)
        .post('/api/auth/oauth/sign-in')
        .send({
          idToken: 'valid-token',
          provider: 'github',
        });

      expect(response.status).toBe(502);
      expect(response.body).toEqual({
        error: 'Failed to dispatch verification code email. Please try again.',
        code: 'EMAIL_DELIVERY_FAILED',
      });

      expect(mfaRepository.invalidatePendingChallenges).toHaveBeenCalledWith(mockExistingLinkedParticipant.id);
    });
  });

  describe('Payload validation error responses', () => {
    it('rejects missing idToken with HTTP 400', async () => {
      const response = await request(app)
        .post('/api/auth/oauth/sign-in')
        .send({ provider: 'google' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Validation failed',
        errors: {
          idToken: 'Firebase ID token is required.',
        },
      });
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });

    it('rejects unsupported provider with HTTP 400', async () => {
      const response = await request(app)
        .post('/api/auth/oauth/sign-in')
        .send({ idToken: 'token', provider: 'facebook' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Validation failed',
        errors: {
          provider: "Provider must be 'google' or 'github'.",
        },
      });
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });
  });
});



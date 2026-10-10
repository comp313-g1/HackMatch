import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { Participant } from '../db/types.js';

// Mock Firebase Admin module to operate 100% offline without live Google Cloud credentials
// and avoid the throwing offline proxy in server/src/config/firebase.ts
const mockCreateUser = vi.fn();
const mockDeleteUser = vi.fn();

vi.mock('../config/firebase.js', () => ({
  firebaseAuth: {
    createUser: (...args: unknown[]) => mockCreateUser(...args),
    deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
  },
  auth: {
    createUser: (...args: unknown[]) => mockCreateUser(...args),
    deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
  },
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
    mockCreateUser.mockResolvedValue(mockCreatedFirebaseUser);
    mockDeleteUser.mockResolvedValue(undefined);
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

    it('accepts explicit role: PART without issue', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...validPayload, role: 'PART' });

      expect(response.status).toBe(201);
      expect(mockCreateUser).toHaveBeenCalled();
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

    it('gracefully handles failure inside compensatory deleteUser without masking initial error', async () => {
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
    });
  });
});

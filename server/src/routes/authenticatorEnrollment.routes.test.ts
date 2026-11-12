import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { Participant } from '../db/types.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import {
  AuthenticatorEnrollmentError,
  _resetAuthenticatorEnrollmentProvider,
  _setAuthenticatorEnrollmentProvider,
  type AuthenticatorEnrollmentProvider,
  type AuthenticatorOwnerContext,
} from '../services/authenticatorEnrollment.js';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    getUser: vi.fn(),
    setCustomUserClaims: vi.fn(),
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

const AUTH = 'Bearer valid.id.token';
const PENDING_ID = 'enrollment_123';
const NOW = () => Math.floor(Date.now() / 1000);

const participant = (role: 'PART' | 'ADMIN' = 'PART'): Participant => ({
  id: role === 'ADMIN' ? 'admin-1' : 'part-1',
  firebase_uid: role === 'ADMIN' ? 'firebase-admin' : 'firebase-part',
  email: role === 'ADMIN' ? 'admin@example.com' : 'part@example.com',
  full_name: role === 'ADMIN' ? 'Admin User' : 'Part User',
  role,
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-11-11T17:00:00.000Z',
  updated_at: '2026-11-11T17:00:00.000Z',
});

function token(role: 'PART' | 'ADMIN' | string = 'PART', overrides: Record<string, unknown> = {}) {
  const authTime = NOW() - 30;
  return {
    uid: role === 'ADMIN' ? 'firebase-admin' : 'firebase-part',
    email: role === 'ADMIN' ? 'admin@example.com' : 'part@example.com',
    email_verified: true,
    role,
    auth_time: authTime,
    [MFA_CLAIM]: authTime,
    iat: authTime,
    exp: NOW() + 3600,
    firebase: { sign_in_provider: 'password', identities: {} },
    ...overrides,
  } as unknown as DecodedIdToken;
}

class FakeEnrollmentProvider implements AuthenticatorEnrollmentProvider {
  private states = new Map<
    string,
    { status: 'pending' | 'active'; enrollmentId: string; activatedAt?: string }
  >();

  beginCalls: AuthenticatorOwnerContext[] = [];
  confirmCalls: Array<{ owner: AuthenticatorOwnerContext; enrollmentId: string; code: string }> = [];

  async begin(owner: AuthenticatorOwnerContext) {
    this.beginCalls.push(owner);
    const current = this.states.get(owner.participantId);
    if (current?.status === 'active') {
      throw new AuthenticatorEnrollmentError('AUTHENTICATOR_ALREADY_ACTIVE', 409);
    }
    if (current?.status === 'pending') {
      throw new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_PENDING', 409);
    }

    this.states.set(owner.participantId, { status: 'pending', enrollmentId: PENDING_ID });
    return {
      enrollmentId: PENDING_ID,
      expiresAt: '2026-11-11T18:10:00.000Z',
      otpauthUri: 'otpauth://totp/HackMatch%3Aaccount?secret=OWNERONLY&issuer=HackMatch',
      manualEntryKey: 'OWNERONLY',
      accountLabel: 'HackMatch account',
    };
  }

  async confirm(owner: AuthenticatorOwnerContext, enrollmentId: string, code: string) {
    this.confirmCalls.push({ owner, enrollmentId, code });
    const current = this.states.get(owner.participantId);
    if (current?.status === 'active') {
      throw new AuthenticatorEnrollmentError('AUTHENTICATOR_ALREADY_ACTIVE', 409);
    }
    if (!current) {
      throw new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_NOT_PENDING', 409);
    }
    if (current.enrollmentId !== enrollmentId) {
      throw new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_STALE', 409);
    }
    if (code !== '123456') {
      throw new AuthenticatorEnrollmentError('INVALID_AUTHENTICATOR_CODE', 401);
    }

    const activatedAt = '2026-11-11T18:05:00.000Z';
    this.states.set(owner.participantId, {
      status: 'active',
      enrollmentId,
      activatedAt,
    });
    return { activatedAt };
  }
}

describe('authenticator enrollment API contract (US-029 / #266)', () => {
  let provider: FakeEnrollmentProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    provider = new FakeEnrollmentProvider();
    _setAuthenticatorEnrollmentProvider(provider);
    mockVerifyIdToken.mockResolvedValue(token());
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant());
  });

  afterEach(() => _resetAuthenticatorEnrollmentProvider());

  const begin = () =>
    request(app)
      .post('/api/auth/mfa/authenticator/enrollment')
      .set('Authorization', AUTH)
      .send({});

  const confirm = (body: Record<string, unknown>) =>
    request(app)
      .post('/api/auth/mfa/authenticator/enrollment/confirm')
      .set('Authorization', AUTH)
      .send(body);

  it('denies an unauthenticated visitor before enrollment state is read', async () => {
    const response = await request(app).post('/api/auth/mfa/authenticator/enrollment').send({});

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
    expect(provider.beginCalls).toHaveLength(0);
  });

  it('allows an eligible PART owner to begin a pending standards-based enrollment', async () => {
    const response = await begin();

    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      authenticator: {
        status: 'pending',
        enrollmentId: PENDING_ID,
        issuer: 'HackMatch',
        accountLabel: 'HackMatch account',
        algorithm: 'SHA1',
        digits: 6,
        periodSeconds: 30,
      },
      setup: { manualEntryKey: 'OWNERONLY' },
      availableChallengeMethods: ['email_otp'],
      emailOtpFallback: true,
    });
    expect(provider.beginCalls).toEqual([
      { participantId: 'part-1', firebaseUid: 'firebase-part', role: 'PART' },
    ]);
    expect(JSON.stringify(response.body)).not.toContain('part@example.com');
    expect(JSON.stringify(response.body)).not.toContain('firebase-part');
  });

  it('allows an eligible ADMIN to enroll only their own account', async () => {
    mockVerifyIdToken.mockResolvedValue(token('ADMIN'));
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant('ADMIN'));

    const response = await begin();

    expect(response.status).toBe(201);
    expect(provider.beginCalls).toEqual([
      { participantId: 'admin-1', firebaseUid: 'firebase-admin', role: 'ADMIN' },
    ]);
  });

  it('rejects arbitrary account targeting without invoking the provider', async () => {
    const response = await request(app)
      .post('/api/auth/mfa/authenticator/enrollment')
      .set('Authorization', AUTH)
      .send({ participantId: 'other-participant' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(provider.beginCalls).toHaveLength(0);
    expect(JSON.stringify(response.body)).not.toContain('other-participant');
  });

  it('denies unsupported roles, suspended accounts, and unverified accounts', async () => {
    mockVerifyIdToken.mockResolvedValueOnce(token('SUPERUSER'));
    const unsupported = await begin();
    expect(unsupported.status).toBe(403);
    expect(unsupported.body.code).toBe('INVALID_ROLE_CLAIM');

    mockVerifyIdToken.mockResolvedValueOnce(token());
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValueOnce({
      ...participant(),
      is_suspended: true,
    });
    const suspended = await begin();
    expect(suspended.status).toBe(403);
    expect(suspended.body.code).toBe('ACCOUNT_SUSPENDED');

    mockVerifyIdToken.mockResolvedValueOnce(token());
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValueOnce({
      ...participant(),
      is_verified: false,
    });
    const unverified = await begin();
    expect(unverified.status).toBe(403);
    expect(unverified.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(provider.beginCalls).toHaveLength(0);
  });

  it('requires current-session MFA and recent primary authentication', async () => {
    const authTime = NOW() - 30;
    mockVerifyIdToken.mockResolvedValueOnce(token('PART', { [MFA_CLAIM]: authTime - 1 }));
    const noMfa = await begin();
    expect(noMfa.status).toBe(403);
    expect(noMfa.body.code).toBe('MFA_REQUIRED');

    const staleAuthTime = NOW() - 601;
    mockVerifyIdToken.mockResolvedValueOnce(
      token('PART', { auth_time: staleAuthTime, [MFA_CLAIM]: staleAuthTime })
    );
    const stale = await begin();
    expect(stale.status).toBe(401);
    expect(stale.body.code).toBe('REAUTHENTICATION_REQUIRED');
    expect(provider.beginCalls).toHaveLength(0);
  });

  it('makes pending and active begin behavior deterministic', async () => {
    expect((await begin()).status).toBe(201);

    const duplicatePending = await begin();
    expect(duplicatePending.status).toBe(409);
    expect(duplicatePending.body.code).toBe('AUTHENTICATOR_ENROLLMENT_PENDING');

    expect(
      (await confirm({ enrollmentId: PENDING_ID, code: '123456' })).status
    ).toBe(200);
    const duplicateActive = await begin();
    expect(duplicateActive.status).toBe(409);
    expect(duplicateActive.body.code).toBe('AUTHENTICATOR_ALREADY_ACTIVE');
  });

  it('rejects malformed confirmation before provider access and does not echo the code', async () => {
    const response = await confirm({ enrollmentId: PENDING_ID, code: '12A456' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(provider.confirmCalls).toHaveLength(0);
    expect(JSON.stringify(response.body)).not.toContain('12A456');
  });

  it('returns an explicit missing-pending response', async () => {
    const response = await confirm({ enrollmentId: PENDING_ID, code: '123456' });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('AUTHENTICATOR_ENROLLMENT_NOT_PENDING');
    expect(JSON.stringify(response.body)).not.toMatch(/secret|database|firebase/i);
  });

  it.each([
    [
      'expired',
      'AUTHENTICATOR_ENROLLMENT_EXPIRED' as const,
      410,
    ],
    [
      'replaced or stale',
      'AUTHENTICATOR_ENROLLMENT_STALE' as const,
      409,
    ],
    [
      'misconfigured',
      'AUTHENTICATOR_CONFIGURATION_ERROR' as const,
      503,
    ],
  ])('maps an %s enrollment to an explicit safe failure', async (_label, code, status) => {
    _setAuthenticatorEnrollmentProvider({
      begin: vi.fn(),
      confirm: vi.fn().mockRejectedValue(new AuthenticatorEnrollmentError(code, status)),
    });

    const response = await confirm({ enrollmentId: PENDING_ID, code: '123456' });

    expect(response.status).toBe(status);
    expect(response.body.code).toBe(code);
    expect(JSON.stringify(response.body)).not.toMatch(/secret|database|firebase|stack/i);
  });

  it('does not activate or remove email fallback after an incorrect code', async () => {
    await begin();
    const incorrect = await confirm({ enrollmentId: PENDING_ID, code: '000000' });

    expect(incorrect.status).toBe(401);
    expect(incorrect.body.code).toBe('INVALID_AUTHENTICATOR_CODE');
    expect(JSON.stringify(incorrect.body)).not.toContain('000000');

    const successfulRetry = await confirm({ enrollmentId: PENDING_ID, code: '123456' });
    expect(successfulRetry.status).toBe(200);
    expect(successfulRetry.body).toEqual({
      authenticator: {
        status: 'active',
        activatedAt: '2026-11-11T18:05:00.000Z',
      },
      availableChallengeMethods: ['authenticator_totp', 'email_otp'],
      emailOtpFallback: true,
    });
    expect(JSON.stringify(successfulRetry.body)).not.toMatch(/OWNERONLY|otpauth|secret/i);
  });

  it('rejects duplicate confirmation without changing the active enrollment', async () => {
    await begin();
    expect((await confirm({ enrollmentId: PENDING_ID, code: '123456' })).status).toBe(200);

    const duplicate = await confirm({ enrollmentId: PENDING_ID, code: '123456' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('AUTHENTICATOR_ALREADY_ACTIVE');
  });

  it('maps unknown provider/configuration failures to a privacy-safe 503', async () => {
    _setAuthenticatorEnrollmentProvider({
      begin: vi.fn().mockRejectedValue(new Error('database row contains secret OWNERONLY')),
      confirm: vi.fn(),
    });

    const response = await begin();

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: 'Authenticator enrollment is temporarily unavailable. Please try again later.',
      code: 'AUTHENTICATOR_ENROLLMENT_UNAVAILABLE',
      retryable: true,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/database|OWNERONLY|stack/i);
  });
});

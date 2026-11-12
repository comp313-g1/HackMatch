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
  type AuthenticatorOwnerContext,
} from '../services/authenticatorEnrollment.js';
import {
  _resetAuthenticatorRecoveryControlsProvider,
  _setAuthenticatorRecoveryControlsProvider,
  type AuthenticatorRecoveryControlsProvider,
} from '../services/authenticatorRecoveryControls.js';

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
const BATCH_A = '30000000-0000-4000-8000-00000000000a';
const NOW = () => Math.floor(Date.now() / 1000);
const BATCH_B = '30000000-0000-4000-8000-00000000000b';
const RAW_CODES = Array.from({ length: 10 }, (_, index) => `RAWC-ODE${String.fromCharCode(65 + index)}-ZZZZ`);
const FRESH_CODES = Array.from({ length: 10 }, (_, index) => `NEWC-ODE${String.fromCharCode(65 + index)}-YYYY`);

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

function token(role: 'PART' | 'ADMIN' = 'PART', overrides: Record<string, unknown> = {}) {
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

/** Per-owner in-memory model of the #269 storage semantics. */
class FakeControlsProvider implements AuthenticatorRecoveryControlsProvider {
  active = new Set<string>(['part-1', 'admin-1']);
  batches = new Map<string, { batchId: string; total: number }>();
  calls: Array<{ op: string; owner: AuthenticatorOwnerContext }> = [];

  pendingReplacement = new Set<string>();

  async confirmReplacement(owner: AuthenticatorOwnerContext, enrollmentId: string, code: string) {
    this.calls.push({ op: 'confirmReplacement', owner });
    if (!this.pendingReplacement.has(owner.participantId) || enrollmentId !== 'replacement_123') {
      throw new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_NOT_PENDING', 409);
    }
    if (code !== '123456') {
      // Old factor and recovery set untouched.
      throw new AuthenticatorEnrollmentError('INVALID_AUTHENTICATOR_CODE', 401);
    }
    this.pendingReplacement.delete(owner.participantId);
    this.batches.set(owner.participantId, { batchId: BATCH_B, total: FRESH_CODES.length });
    return {
      activatedAt: '2026-11-11T18:40:00.000Z',
      recoveryCodes: {
        codes: [...FRESH_CODES],
        batchId: BATCH_B,
        generatedAt: '2026-11-11T18:40:00.000Z',
      },
    };
  }

  async replace(owner: AuthenticatorOwnerContext) {
    this.calls.push({ op: 'replace', owner });
    if (!this.active.has(owner.participantId)) {
      throw new AuthenticatorEnrollmentError('AUTHENTICATOR_NOT_ACTIVE', 409);
    }
    this.pendingReplacement.add(owner.participantId);
    return {
      enrollmentId: 'replacement_123',
      expiresAt: '2026-11-11T18:10:00.000Z',
      otpauthUri: 'otpauth://totp/HackMatch%3Aaccount?secret=NEWDEVICE&issuer=HackMatch',
      manualEntryKey: 'NEWDEVICE',
      accountLabel: 'HackMatch account',
    };
  }

  async disable(owner: AuthenticatorOwnerContext) {
    this.calls.push({ op: 'disable', owner });
    if (!this.active.delete(owner.participantId)) {
      throw new AuthenticatorEnrollmentError('AUTHENTICATOR_NOT_ACTIVE', 409);
    }
    this.batches.delete(owner.participantId);
    return { disabledAt: '2026-11-11T18:30:00.000Z' };
  }

  async getRecoveryCodeStatus(owner: AuthenticatorOwnerContext) {
    this.calls.push({ op: 'status', owner });
    const batch = this.batches.get(owner.participantId);
    return batch
      ? {
          status: 'generated' as const,
          batchId: batch.batchId,
          total: batch.total,
          remaining: batch.total,
          generatedAt: '2026-11-11T18:20:00.000Z',
        }
      : { status: 'not_generated' as const, batchId: null, total: 0, remaining: 0, generatedAt: null };
  }

  async generateRecoveryCodes(owner: AuthenticatorOwnerContext, expectedBatchId: string | null) {
    this.calls.push({ op: 'generate', owner });
    if (!this.active.has(owner.participantId)) {
      throw new AuthenticatorEnrollmentError('AUTHENTICATOR_NOT_ACTIVE', 409);
    }
    const current = this.batches.get(owner.participantId)?.batchId ?? null;
    if (current !== expectedBatchId) {
      throw new AuthenticatorEnrollmentError('RECOVERY_CODES_STALE', 409);
    }
    this.batches.set(owner.participantId, { batchId: BATCH_A, total: RAW_CODES.length });
    return { codes: [...RAW_CODES], batchId: BATCH_A, generatedAt: '2026-11-11T18:20:00.000Z' };
  }
}

describe('authenticator reauthentication-gated recovery controls (US-029 / #269)', () => {
  let provider: FakeControlsProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    provider = new FakeControlsProvider();
    _setAuthenticatorRecoveryControlsProvider(provider);
    mockVerifyIdToken.mockResolvedValue(token());
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant());
  });

  afterEach(() => _resetAuthenticatorRecoveryControlsProvider());

  const as = (role: 'PART' | 'ADMIN') => {
    mockVerifyIdToken.mockResolvedValue(token(role));
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant(role));
  };
  const post = (path: string, body: unknown = {}) =>
    request(app).post(`/api/auth/mfa/authenticator${path}`).set('Authorization', AUTH).send(body as object);
  const codeStatus = () =>
    request(app).get('/api/auth/mfa/authenticator/recovery-codes').set('Authorization', AUTH);
  const generate = (expectedBatchId: string | null = null) =>
    post('/recovery-codes', { expectedBatchId });

  describe('server-authoritative reauthentication', () => {
    const sensitive: Array<[string, () => request.Test]> = [
      ['replacement', () => post('/replacement')],
      ['replacement confirmation', () => post('/replacement/confirm', { enrollmentId: 'replacement_123', code: '123456' })],
      ['disable', () => post('/disable')],
      ['recovery generation', () => generate()],
      ['recovery status', () => codeStatus()],
    ];

    it.each(sensitive)('returns REAUTHENTICATION_REQUIRED for a stale sign-in on %s', async (_label, call) => {
      const stale = NOW() - 601;
      mockVerifyIdToken.mockResolvedValue(token('PART', { auth_time: stale, [MFA_CLAIM]: stale }));
      const response = await call();
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('REAUTHENTICATION_REQUIRED');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(provider.calls).toHaveLength(0);
    });

    it.each(sensitive)(
      'still requires the fresh email OTP after Firebase reauthentication on %s',
      async (_label, call) => {
        // A primary reauthentication issues a new auth_time; the old MFA claim no longer matches.
        const fresh = NOW() - 5;
        mockVerifyIdToken.mockResolvedValue(token('PART', { auth_time: fresh, [MFA_CLAIM]: fresh - 900 }));
        const response = await call();
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('MFA_REQUIRED');
        expect(provider.calls).toHaveLength(0);
      }
    );

    it('accepts the retry once reauthentication and email OTP are both current', async () => {
      const fresh = NOW() - 5;
      mockVerifyIdToken.mockResolvedValue(token('PART', { auth_time: fresh, [MFA_CLAIM]: fresh }));
      expect((await generate()).status).toBe(201);
    });

    it('rejects unauthenticated, suspended, and unsupported-role callers before provider access', async () => {
      expect((await request(app).post('/api/auth/mfa/authenticator/disable').send({})).status).toBe(401);

      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValueOnce({
        ...participant(),
        is_suspended: true,
      });
      const suspended = await post('/disable');
      expect(suspended.status).toBe(403);
      expect(suspended.body.code).toBe('ACCOUNT_SUSPENDED');

      mockVerifyIdToken.mockResolvedValueOnce(token('SUPERUSER' as 'PART'));
      expect((await generate()).body.code).toBe('INVALID_ROLE_CLAIM');
      expect(provider.calls).toHaveLength(0);
    });
  });

  describe('owner-only targeting', () => {
    it.each([
      ['/replacement', { participantId: 'other' }],
      ['/disable', { participantId: 'other' }],
      ['/recovery-codes', { expectedBatchId: null, participantId: 'other' }],
      ['/recovery-codes', {}],
      ['/recovery-codes', { expectedBatchId: 'not-a-uuid' }],
    ])('rejects %s body %j without provider access', async (path, body) => {
      const response = await post(path, body);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(response.body)).not.toContain('other');
      expect(provider.calls).toHaveLength(0);
    });
  });

  describe('recovery codes', () => {
    it.each(['PART', 'ADMIN'] as const)('lets a %s owner generate codes that are returned exactly once', async (role) => {
      as(role);
      const created = await generate();
      expect(created.status).toBe(201);
      expect(created.headers['cache-control']).toBe('no-store');
      expect(created.body).toEqual({
        recoveryCodes: {
          status: 'generated',
          batchId: BATCH_A,
          total: 10,
          remaining: 10,
          generatedAt: '2026-11-11T18:20:00.000Z',
          codes: RAW_CODES,
        },
      });
      expect(provider.calls.at(-1)!.owner.participantId).toBe(role === 'ADMIN' ? 'admin-1' : 'part-1');

      const later = await codeStatus();
      expect(later.status).toBe(200);
      expect(later.body).toEqual({
        recoveryCodes: {
          status: 'generated',
          batchId: BATCH_A,
          total: 10,
          remaining: 10,
          generatedAt: '2026-11-11T18:20:00.000Z',
        },
      });
      expect(JSON.stringify(later.body)).not.toMatch(/RAWC|codes"|verifier/);

      // The #268 authenticator status endpoint never carries recovery material.
      _setAuthenticatorEnrollmentProvider({
        getStatus: vi.fn().mockResolvedValue({ status: 'active', activatedAt: '2026-11-11T18:05:00.000Z' }),
        begin: vi.fn(),
        restart: vi.fn(),
        confirm: vi.fn(),
      });
      try {
        const enrollmentStatus = await request(app)
          .get('/api/auth/mfa/authenticator/enrollment')
          .set('Authorization', AUTH);
        expect(enrollmentStatus.status).toBe(200);
        expect(JSON.stringify(enrollmentStatus.body)).not.toMatch(/RAWC|recovery/i);
      } finally {
        _resetAuthenticatorEnrollmentProvider();
      }
    });

    it('does not expose one account’s set to another account', async () => {
      as('PART');
      await generate();
      as('ADMIN');
      const adminStatus = await codeStatus();
      expect(adminStatus.body).toEqual({
        recoveryCodes: { status: 'not_generated', total: 0, remaining: 0 },
      });
    });

    it('requires the caller to name the current batch when regenerating', async () => {
      expect((await generate()).status).toBe(201);
      const stale = await generate(null);
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('RECOVERY_CODES_STALE');
      expect((await generate(BATCH_A)).status).toBe(201);
    });

    it('rejects generation without an active authenticator', async () => {
      provider.active.clear();
      const response = await generate();
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('AUTHENTICATOR_NOT_ACTIVE');
    });

    it('maps storage failure to a safe retryable response that says old codes were kept', async () => {
      _setAuthenticatorRecoveryControlsProvider({
        ...provider,
        replace: provider.replace.bind(provider),
        confirmReplacement: provider.confirmReplacement.bind(provider),
        disable: provider.disable.bind(provider),
        getRecoveryCodeStatus: provider.getRecoveryCodeStatus.bind(provider),
        generateRecoveryCodes: vi.fn().mockRejectedValue(new Error('SQL relation verifier RAWC-ODEA')),
      });
      const response = await generate();
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('AUTHENTICATOR_ENROLLMENT_UNAVAILABLE');
      expect(JSON.stringify(response.body)).not.toMatch(/SQL|verifier|RAWC|stack/i);
    });

    it('never logs raw codes while generating them', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => {})
      );
      await generate();
      for (const spy of spies) {
        expect(JSON.stringify(spy.mock.calls)).not.toContain('RAWC');
      }
    });
  });

  describe('replacement and disable', () => {
    it.each(['PART', 'ADMIN'] as const)('begins a %s replacement while the current factor stays active', async (role) => {
      as(role);
      const response = await post('/replacement');
      expect(response.status).toBe(201);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toMatchObject({
        authenticator: {
          status: 'pending',
          enrollmentId: 'replacement_123',
          issuer: 'HackMatch',
          algorithm: 'SHA1',
          digits: 6,
          periodSeconds: 30,
        },
        setup: { manualEntryKey: 'NEWDEVICE' },
        currentAuthenticator: { status: 'active' },
        availableChallengeMethods: ['authenticator_totp', 'email_otp'],
        emailOtpFallback: true,
      });
      expect(JSON.stringify(response.body)).not.toMatch(/firebase-|@example\.com/);
    });

    it.each(['PART', 'ADMIN'] as const)(
      'keeps the %s recovery set during pending/failed replacement and rotates it once on confirmation',
      async (role) => {
        as(role);
        await generate();
        await post('/replacement');
        // Pending replacement: existing set still reported as current.
        expect((await codeStatus()).body.recoveryCodes.batchId).toBe(BATCH_A);

        const wrong = await post('/replacement/confirm', { enrollmentId: 'replacement_123', code: '000000' });
        expect(wrong.status).toBe(401);
        expect(wrong.body.code).toBe('INVALID_AUTHENTICATOR_CODE');
        expect(JSON.stringify(wrong.body)).not.toMatch(/NEWC|RAWC|000000/);
        expect((await codeStatus()).body.recoveryCodes.batchId).toBe(BATCH_A);

        const confirmed = await post('/replacement/confirm', { enrollmentId: 'replacement_123', code: '123456' });
        expect(confirmed.status).toBe(200);
        expect(confirmed.headers['cache-control']).toBe('no-store');
        expect(confirmed.body).toEqual({
          authenticator: { status: 'active', activatedAt: '2026-11-11T18:40:00.000Z' },
          recoveryCodes: {
            status: 'generated',
            batchId: BATCH_B,
            total: 10,
            remaining: 10,
            generatedAt: '2026-11-11T18:40:00.000Z',
            codes: FRESH_CODES,
          },
          availableChallengeMethods: ['authenticator_totp', 'email_otp'],
          emailOtpFallback: true,
        });
        expect(provider.calls.at(-1)!.owner.participantId).toBe(role === 'ADMIN' ? 'admin-1' : 'part-1');

        // Fresh codes are shown once; status never repeats them.
        const later = await codeStatus();
        expect(later.body.recoveryCodes).toMatchObject({ status: 'generated', batchId: BATCH_B });
        expect(JSON.stringify(later.body)).not.toMatch(/NEWC|RAWC/);
        // Regenerating against the pre-replacement batch is now stale.
        expect((await generate(BATCH_A)).body.code).toBe('RECOVERY_CODES_STALE');
      }
    );

    it('validates replacement confirmation input and rejects account targeting', async () => {
      for (const body of [
        { enrollmentId: 'replacement_123', code: '12ab56' },
        { enrollmentId: 'replacement_123', code: '123456', participantId: 'other' },
        { code: '123456' },
      ]) {
        const response = await post('/replacement/confirm', body);
        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
      }
      expect(provider.calls).toHaveLength(0);
    });

    it('disables the owner factor, keeps email OTP, and reports revoked recovery codes', async () => {
      await generate();
      const response = await post('/disable');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        authenticator: { status: 'not_enrolled' },
        disabledAt: '2026-11-11T18:30:00.000Z',
        recoveryCodes: { status: 'not_generated', total: 0, remaining: 0 },
        availableChallengeMethods: ['email_otp'],
        emailOtpFallback: true,
      });
      expect((await codeStatus()).body.recoveryCodes.status).toBe('not_generated');

      const again = await post('/disable');
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('AUTHENTICATOR_NOT_ACTIVE');
      expect((await post('/replacement')).body.code).toBe('AUTHENTICATOR_NOT_ACTIVE');
    });
  });
});

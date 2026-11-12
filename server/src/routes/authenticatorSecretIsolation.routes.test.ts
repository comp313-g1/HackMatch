import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { Participant } from '../db/types.js';
import type {
  AuthenticatorEnrollmentRepository,
  CreatePendingAuthenticatorInput,
  StoredAuthenticatorEnrollment,
} from '../db/authenticatorEnrollment.repository.js';
import type {
  ActivateReplacementInput,
  AuthenticatorRecoveryControlsRepository,
  ReplaceRecoveryCodesInput,
} from '../db/authenticatorRecoveryControls.repository.js';
import {
  TotpEncryptionConfigurationError,
  createTotpSecretProtector,
} from '../security/totpSecretEncryption.js';
import { createRecoveryCodeVerifier } from '../security/recoveryCodes.js';
import { _totpCodeForTest } from '../security/totp.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import {
  _resetAuthenticatorEnrollmentProvider,
  _setAuthenticatorEnrollmentProvider,
} from '../services/authenticatorEnrollment.js';
import {
  _resetAuthenticatorRecoveryControlsProvider,
  _setAuthenticatorRecoveryControlsProvider,
} from '../services/authenticatorRecoveryControls.js';
import { createPersistentAuthenticatorEnrollmentProvider } from '../services/persistentAuthenticatorEnrollmentProvider.js';
import { createPersistentAuthenticatorRecoveryControlsProvider } from '../services/persistentAuthenticatorRecoveryControlsProvider.js';

/**
 * US-029 / #270 secret-isolation suite.
 *
 * Layer: route/controller + REAL persistent providers (real AES-256-GCM, TOTP,
 * and HMAC verifiers) over an in-memory, owner-scoped repository that mirrors
 * the SQL functions' ownership rules. Firebase token verification and the
 * participant lookup are mocked. The SQL functions themselves are covered by
 * the PGlite suites; this is not a live end-to-end test.
 */

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

const KEY = Buffer.alloc(32, 42).toString('base64');
const RANDOM_UUID = '99999999-9999-4999-8999-999999999999';

type AccountName = 'partA' | 'partB' | 'adminA' | 'adminB';
const ACCOUNTS: Record<AccountName, Participant> = {
  partA: participant('10000000-0000-4000-8000-0000000000a1', 'fb-part-a', 'PART'),
  partB: participant('10000000-0000-4000-8000-0000000000b1', 'fb-part-b', 'PART'),
  adminA: participant('10000000-0000-4000-8000-0000000000a2', 'fb-admin-a', 'ADMIN'),
  adminB: participant('10000000-0000-4000-8000-0000000000b2', 'fb-admin-b', 'ADMIN'),
};

function participant(id: string, uid: string, role: 'PART' | 'ADMIN'): Participant {
  return {
    id,
    firebase_uid: uid,
    email: `${uid}@example.com`,
    full_name: uid,
    role,
    is_verified: true,
    is_suspended: false,
    is_deactivated: false,
    created_at: '2026-11-11T17:00:00.000Z',
    updated_at: '2026-11-11T17:00:00.000Z',
  };
}

function tokenFor(account: Participant): DecodedIdToken {
  const authTime = Math.floor(Date.now() / 1000) - 30;
  return {
    uid: account.firebase_uid,
    email: account.email,
    email_verified: true,
    role: account.role,
    auth_time: authTime,
    [MFA_CLAIM]: authTime,
    iat: authTime,
    exp: authTime + 3600,
    firebase: { sign_in_provider: 'password', identities: {} },
  } as unknown as DecodedIdToken;
}

/** Owner-scoped in-memory model of authenticator_enrollments + authenticator_recovery_codes. */
class MemoryAuthenticatorStore
  implements AuthenticatorEnrollmentRepository, AuthenticatorRecoveryControlsRepository
{
  enrollments = new Map<string, StoredAuthenticatorEnrollment>();
  codes: Array<{
    participantId: string;
    batchId: string;
    verifier: string;
    createdAt: string;
    usedAt: string | null;
    revokedAt: string | null;
  }> = [];
  failNext: Error | null = null;

  private maybeFail() {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
  }
  private owned(participantId: string, status?: string) {
    return [...this.enrollments.values()].filter(
      (row) => row.participant_id === participantId && (!status || row.status === status)
    );
  }
  private insertPending(input: CreatePendingAuthenticatorInput) {
    const now = new Date().toISOString();
    this.enrollments.set(input.enrollmentId, {
      id: input.enrollmentId,
      participant_id: input.participantId,
      secret_ciphertext: input.protectedSecret.ciphertext,
      secret_iv: input.protectedSecret.iv,
      secret_auth_tag: input.protectedSecret.authTag,
      encryption_key_version: input.protectedSecret.keyVersion,
      status: 'Pending',
      pending_expires_at: input.expiresAt,
      activated_at: null,
      retired_at: null,
      created_at: now,
      updated_at: now,
    });
    return { enrollmentId: input.enrollmentId, status: 'Pending' as const, expiresAt: input.expiresAt };
  }
  private cancelPending(participantId: string) {
    for (const row of this.owned(participantId, 'Pending')) {
      row.status = 'Canceled';
      row.retired_at = new Date().toISOString();
    }
  }
  private currentBatch(participantId: string) {
    return this.codes.find((code) => code.participantId === participantId && !code.revokedAt)?.batchId ?? null;
  }
  private rotateCodes(participantId: string, batchId: string, verifiers: string[], at: string) {
    for (const code of this.codes) {
      if (code.participantId === participantId && !code.revokedAt) code.revokedAt = at;
    }
    for (const verifier of verifiers) {
      this.codes.push({ participantId, batchId, verifier, createdAt: at, usedAt: null, revokedAt: null });
    }
  }

  async createPending(input: CreatePendingAuthenticatorInput) {
    this.maybeFail();
    if (this.owned(input.participantId, 'Active').length) throw new Error('TOTP_AUTHENTICATOR_ALREADY_ACTIVE');
    if (this.owned(input.participantId, 'Pending').length) throw new Error('TOTP_ENROLLMENT_PENDING');
    return this.insertPending(input);
  }
  async restartPending(input: CreatePendingAuthenticatorInput) {
    if (this.owned(input.participantId, 'Active').length) throw new Error('TOTP_AUTHENTICATOR_ALREADY_ACTIVE');
    if (!this.owned(input.participantId, 'Pending').length) throw new Error('TOTP_ENROLLMENT_NOT_PENDING');
    this.cancelPending(input.participantId);
    return this.insertPending(input);
  }
  async findOwnedById(participantId: string, enrollmentId: string) {
    this.maybeFail();
    const row = this.enrollments.get(enrollmentId);
    return row && row.participant_id === participantId ? row : null;
  }
  async findActiveByParticipantId(participantId: string) {
    return this.owned(participantId, 'Active')[0] ?? null;
  }
  async findCurrentByParticipantId(participantId: string) {
    const row = this.owned(participantId, 'Active')[0] ?? this.owned(participantId, 'Pending')[0];
    if (!row) return null;
    return {
      status: row.status as 'Active' | 'Pending',
      pending_expires_at: row.pending_expires_at,
      activated_at: row.activated_at,
    };
  }
  async activatePending(participantId: string, enrollmentId: string) {
    const row = await this.findOwnedById(participantId, enrollmentId);
    if (!row || row.status !== 'Pending') throw new Error('TOTP_ENROLLMENT_NOT_PENDING');
    const now = new Date().toISOString();
    for (const active of this.owned(participantId, 'Active')) {
      active.status = 'Retired';
      active.retired_at = now;
    }
    Object.assign(row, { status: 'Active', pending_expires_at: null, activated_at: now });
    return { outcome: 'Activated' as const, enrollmentId, activatedAt: now };
  }
  async beginReplacement(input: CreatePendingAuthenticatorInput) {
    if (!this.owned(input.participantId, 'Active').length) throw new Error('TOTP_AUTHENTICATOR_NOT_ACTIVE');
    this.cancelPending(input.participantId);
    return this.insertPending(input);
  }
  async activateReplacement(input: ActivateReplacementInput) {
    const row = await this.findOwnedById(input.participantId, input.enrollmentId);
    if (!row) throw new Error('TOTP_ENROLLMENT_NOT_PENDING');
    if (row.status !== 'Pending') throw new Error('TOTP_ENROLLMENT_STALE');
    const now = new Date().toISOString();
    for (const active of this.owned(input.participantId, 'Active')) {
      active.status = 'Retired';
      active.retired_at = now;
    }
    Object.assign(row, { status: 'Active', pending_expires_at: null, activated_at: now });
    this.rotateCodes(input.participantId, input.batchId, input.verifiers, now);
    return {
      outcome: 'Activated' as const,
      activatedAt: now,
      recoveryBatchId: input.batchId,
      recoveryCodeCount: input.verifiers.length,
    };
  }
  async disableActive(participantId: string) {
    if (!this.owned(participantId, 'Active').length) throw new Error('TOTP_AUTHENTICATOR_NOT_ACTIVE');
    this.cancelPending(participantId);
    const now = new Date().toISOString();
    for (const active of this.owned(participantId, 'Active')) {
      active.status = 'Retired';
      active.retired_at = now;
    }
    let revoked = 0;
    for (const code of this.codes) {
      if (code.participantId === participantId && !code.revokedAt) {
        code.revokedAt = now;
        revoked += 1;
      }
    }
    return { disabledAt: now, revokedRecoveryCodes: revoked };
  }
  async replaceRecoveryCodes(input: ReplaceRecoveryCodesInput) {
    this.maybeFail();
    if (!this.owned(input.participantId, 'Active').length) throw new Error('TOTP_AUTHENTICATOR_NOT_ACTIVE');
    if (this.currentBatch(input.participantId) !== input.expectedBatchId) throw new Error('RECOVERY_CODES_STALE');
    const now = new Date().toISOString();
    this.rotateCodes(input.participantId, input.batchId, input.verifiers, now);
    return { batchId: input.batchId, codeCount: input.verifiers.length, generatedAt: now };
  }
  async findCurrentRecoveryCodeSummary(participantId: string) {
    const current = this.codes.filter((code) => code.participantId === participantId && !code.revokedAt);
    if (!current.length) return null;
    return {
      batchId: current[0]!.batchId,
      total: current.length,
      remaining: current.filter((code) => !code.usedAt).length,
      generatedAt: current[0]!.createdAt,
    };
  }
}

function captureConsole() {
  const lines: string[] = [];
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    })
  );
  return { text: () => lines.join('\n'), restore: () => spies.forEach((spy) => spy.mockRestore()) };
}

describe('US-029 secret isolation across accounts, responses, logs, and storage (#270)', () => {
  let store: MemoryAuthenticatorStore;
  let logs: ReturnType<typeof captureConsole>;
  let originalEnv: string | undefined;
  let protectorFactory: () => ReturnType<typeof createTotpSecretProtector>;
  /** Every raw secret the server handed out during a test, for leak scans. */
  let issuedSecrets: string[];

  beforeEach(() => {
    vi.restoreAllMocks();
    store = new MemoryAuthenticatorStore();
    issuedSecrets = [];
    protectorFactory = () => createTotpSecretProtector(KEY, 'v1');
    _setAuthenticatorEnrollmentProvider(
      createPersistentAuthenticatorEnrollmentProvider({
        repository: store,
        getProtector: () => protectorFactory(),
      })
    );
    _setAuthenticatorRecoveryControlsProvider(
      createPersistentAuthenticatorRecoveryControlsProvider({
        repository: store,
        enrollmentRepository: store,
        getProtector: () => protectorFactory(),
        getVerifier: () => createRecoveryCodeVerifier(KEY, 'v1'),
      })
    );
    mockVerifyIdToken.mockImplementation(async (token: string) => {
      const name = token.replace(/^token-/, '') as AccountName;
      return tokenFor(ACCOUNTS[name]);
    });
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockImplementation(
      async (uid: string) => Object.values(ACCOUNTS).find((account) => account.firebase_uid === uid) ?? null
    );
    // Run the request logger for real so every request below is also a log-leak probe.
    originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    logs = captureConsole();
  });

  afterEach(() => {
    logs.restore();
    process.env.NODE_ENV = originalEnv;
    _resetAuthenticatorEnrollmentProvider();
    _resetAuthenticatorRecoveryControlsProvider();
  });

  const api = (account: AccountName) => {
    const auth = { Authorization: `Bearer token-${account}` };
    const base = '/api/auth/mfa/authenticator';
    return {
      status: () => request(app).get(`${base}/enrollment`).set(auth),
      begin: () => request(app).post(`${base}/enrollment`).set(auth).send({}),
      restart: () => request(app).post(`${base}/enrollment/restart`).set(auth).send({}),
      confirm: (enrollmentId: string, code: string) =>
        request(app).post(`${base}/enrollment/confirm`).set(auth).send({ enrollmentId, code }),
      replace: () => request(app).post(`${base}/replacement`).set(auth).send({}),
      confirmReplacement: (enrollmentId: string, code: string) =>
        request(app).post(`${base}/replacement/confirm`).set(auth).send({ enrollmentId, code }),
      disable: () => request(app).post(`${base}/disable`).set(auth).send({}),
      codeStatus: () => request(app).get(`${base}/recovery-codes`).set(auth),
      generate: (expectedBatchId: string | null) =>
        request(app).post(`${base}/recovery-codes`).set(auth).send({ expectedBatchId }),
    };
  };

  async function beginFor(account: AccountName) {
    const response = await api(account).begin();
    expect(response.status).toBe(201);
    issuedSecrets.push(response.body.setup.manualEntryKey, response.body.setup.otpauthUri);
    return {
      enrollmentId: response.body.authenticator.enrollmentId as string,
      secret: response.body.setup.manualEntryKey as string,
    };
  }

  async function activeFor(account: AccountName) {
    const setup = await beginFor(account);
    const code = _totpCodeForTest(setup.secret, new Date());
    issuedSecrets.push(code);
    const confirmed = await api(account).confirm(setup.enrollmentId, code);
    expect(confirmed.status).toBe(200);
    return setup;
  }

  async function codesFor(account: AccountName, expected: string | null = null) {
    const response = await api(account).generate(expected);
    expect(response.status).toBe(201);
    issuedSecrets.push(...(response.body.recoveryCodes.codes as string[]));
    return response.body.recoveryCodes as { batchId: string; codes: string[] };
  }

  function expectNoIssuedSecretsIn(text: string) {
    for (const secret of issuedSecrets) expect(text).not.toContain(secret);
  }

  function expectNoStorageMaterialIn(text: string) {
    for (const row of store.enrollments.values()) {
      expect(text).not.toContain(row.secret_ciphertext);
      expect(text).not.toContain(row.secret_auth_tag);
    }
    for (const code of store.codes) expect(text).not.toContain(code.verifier);
  }

  const ATTACKS: Array<[AccountName, AccountName]> = [
    ['partA', 'partB'],
    ['partA', 'adminA'],
    ['adminA', 'partA'],
    ['adminA', 'adminB'],
  ];

  describe('cross-account enrollment identifiers', () => {
    it.each(ATTACKS)('%s cannot confirm %s’s pending enrollment even with a valid code', async (attacker, victim) => {
      const victimSetup = await beginFor(victim);
      const validVictimCode = _totpCodeForTest(victimSetup.secret, new Date());

      const foreign = await api(attacker).confirm(victimSetup.enrollmentId, validVictimCode);
      const random = await api(attacker).confirm(RANDOM_UUID, validVictimCode);

      // Indistinguishable from a non-existent id: no enumeration signal.
      expect(foreign.status).toBe(409);
      expect(foreign.body).toEqual(random.body);
      expect(foreign.body.code).toBe('AUTHENTICATOR_ENROLLMENT_NOT_PENDING');

      // Victim state untouched and still confirmable by its owner.
      expect((await api(victim).status()).body.authenticator.status).toBe('pending');
      expect((await api(attacker).status()).body.authenticator.status).toBe('not_enrolled');
      expect((await api(victim).confirm(victimSetup.enrollmentId, validVictimCode)).status).toBe(200);
    });

    it.each(ATTACKS)('%s cannot finish %s’s replacement with its enrollment id', async (attacker, victim) => {
      await activeFor(attacker);
      await activeFor(victim);
      const victimReplacement = await api(victim).replace();
      issuedSecrets.push(victimReplacement.body.setup.manualEntryKey);
      const victimId = victimReplacement.body.authenticator.enrollmentId as string;
      const victimCode = _totpCodeForTest(victimReplacement.body.setup.manualEntryKey, new Date());

      const foreign = await api(attacker).confirmReplacement(victimId, victimCode);
      const random = await api(attacker).confirmReplacement(RANDOM_UUID, victimCode);
      expect(foreign.status).toBe(409);
      expect(foreign.body).toEqual(random.body);
      expect(JSON.stringify(foreign.body)).not.toMatch(/recoveryCodes|codes/);
      expect((await api(victim).confirmReplacement(victimId, victimCode)).status).toBe(200);
    });

    it('rejects client-supplied participant targeting on every mutation without leaking ids', async () => {
      const auth = { Authorization: 'Bearer token-partA' };
      for (const path of ['/enrollment', '/enrollment/restart', '/replacement', '/disable']) {
        const response = await request(app)
          .post(`/api/auth/mfa/authenticator${path}`)
          .set(auth)
          .send({ participantId: ACCOUNTS.partB.id });
        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).not.toContain(ACCOUNTS.partB.id);
      }
      expect(store.enrollments.size).toBe(0);
    });
  });

  describe('cross-account recovery-code batches', () => {
    it.each(ATTACKS)('%s cannot use or learn anything from %s’s batch id', async (attacker, victim) => {
      await activeFor(attacker);
      await activeFor(victim);
      const victimSet = await codesFor(victim);

      const foreign = await api(attacker).generate(victimSet.batchId);
      const random = await api(attacker).generate(RANDOM_UUID);
      expect(foreign.status).toBe(409);
      expect(foreign.body).toEqual(random.body);
      expect(foreign.body.code).toBe('RECOVERY_CODES_STALE');

      // The attacker never sees the victim's batch, and the victim's set is unchanged.
      expect((await api(attacker).codeStatus()).body.recoveryCodes).toEqual({
        status: 'not_generated',
        total: 0,
        remaining: 0,
      });
      expect((await api(victim).codeStatus()).body.recoveryCodes.batchId).toBe(victimSet.batchId);
      expectNoIssuedSecretsIn(JSON.stringify([foreign.body, random.body]));
    });

    it('ADMIN status never includes another account’s authenticator or recovery state', async () => {
      await activeFor('partA');
      await codesFor('partA');
      const adminStatus = await api('adminA').status();
      const adminCodes = await api('adminA').codeStatus();
      expect(adminStatus.body.authenticator).toEqual({ status: 'not_enrolled' });
      expect(adminCodes.body.recoveryCodes.status).toBe('not_generated');
      expectNoIssuedSecretsIn(JSON.stringify([adminStatus.body, adminCodes.body]));
    });
  });

  describe('response privacy per endpoint', () => {
    it('returns setup material only from begin/restart/replacement and raw codes only from generate/rotation', async () => {
      const responses: Record<string, request.Response> = {};
      const first = await api('partA').begin();
      responses.begin = first;
      issuedSecrets.push(first.body.setup.manualEntryKey, first.body.setup.otpauthUri);
      responses.statusPending = await api('partA').status();
      const restarted = await api('partA').restart();
      responses.restart = restarted;
      issuedSecrets.push(restarted.body.setup.manualEntryKey, restarted.body.setup.otpauthUri);
      const code = _totpCodeForTest(restarted.body.setup.manualEntryKey, new Date());
      issuedSecrets.push(code);
      responses.confirm = await api('partA').confirm(restarted.body.authenticator.enrollmentId, code);
      responses.statusActive = await api('partA').status();
      responses.codeStatusEmpty = await api('partA').codeStatus();
      responses.generate = await api('partA').generate(null);
      issuedSecrets.push(...responses.generate.body.recoveryCodes.codes);
      responses.codeStatus = await api('partA').codeStatus();
      responses.replace = await api('partA').replace();
      issuedSecrets.push(responses.replace.body.setup.manualEntryKey, responses.replace.body.setup.otpauthUri);
      const replacementCode = _totpCodeForTest(responses.replace.body.setup.manualEntryKey, new Date());
      issuedSecrets.push(replacementCode);
      responses.confirmReplacement = await api('partA').confirmReplacement(
        responses.replace.body.authenticator.enrollmentId,
        replacementCode
      );
      issuedSecrets.push(...responses.confirmReplacement.body.recoveryCodes.codes);
      responses.codeStatusAfterRotation = await api('partA').codeStatus();
      responses.disable = await api('partA').disable();
      responses.statusDisabled = await api('partA').status();

      const setupBearing = new Set(['begin', 'restart', 'replace']);
      const codeBearing = new Set(['generate', 'confirmReplacement']);
      for (const [name, response] of Object.entries(responses)) {
        expect(response.status, name).toBeLessThan(300);
        expect(response.headers['cache-control'], name).toBe('no-store');
        const body = JSON.stringify(response.body);
        expectNoStorageMaterialIn(body);
        expect(body, name).not.toMatch(/ciphertext|auth_?tag|verifier|key_?version|"iv"/i);
        if (!setupBearing.has(name)) {
          expect(body, name).not.toMatch(/otpauth|manualEntryKey|"setup"/);
        }
        if (!codeBearing.has(name)) {
          expect(body, name).not.toMatch(/"codes"/);
        }
        // Never the owner's identity details.
        expect(body, name).not.toContain(ACCOUNTS.partA.email);
        expect(body, name).not.toContain(ACCOUNTS.partA.firebase_uid);
        expect(body, name).not.toContain(ACCOUNTS.partA.id);
      }
      // Email OTP remains the fallback in every authenticator state.
      for (const name of ['statusPending', 'statusActive', 'statusDisabled', 'confirm', 'disable']) {
        expect(responses[name]!.body.emailOtpFallback, name).toBe(true);
        expect(responses[name]!.body.availableChallengeMethods, name).toContain('email_otp');
      }
      // Rotation retired every previously issued code; status still exposes only counts.
      expect(responses.codeStatusAfterRotation.body.recoveryCodes.batchId).not.toBe(
        responses.generate.body.recoveryCodes.batchId
      );
    });

    it('stores only ciphertext and verifiers — never a secret, setup URI, or raw code', async () => {
      await activeFor('partA');
      await codesFor('partA');
      await activeFor('adminB');
      await codesFor('adminB');
      const persisted = JSON.stringify({ enrollments: [...store.enrollments.values()], codes: store.codes });
      expectNoIssuedSecretsIn(persisted);
      expect(persisted).not.toContain('otpauth://');
      for (const code of store.codes) expect(code.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('writes no secret, code, setup URI, ciphertext, or verifier to logs across the full lifecycle', async () => {
      await activeFor('partA');
      const set = await codesFor('partA');
      await codesFor('partA', set.batchId);
      const replacement = await api('partA').replace();
      issuedSecrets.push(replacement.body.setup.manualEntryKey, replacement.body.setup.otpauthUri);
      const code = _totpCodeForTest(replacement.body.setup.manualEntryKey, new Date());
      issuedSecrets.push(code);
      const rotated = await api('partA').confirmReplacement(replacement.body.authenticator.enrollmentId, code);
      issuedSecrets.push(...rotated.body.recoveryCodes.codes);
      await api('partA').disable();

      const text = logs.text();
      expect(text).toContain('/api/auth/mfa/authenticator'); // the logger really ran
      expectNoIssuedSecretsIn(text);
      expectNoStorageMaterialIn(text);
      expect(text).not.toContain('otpauth://');
      expect(text).not.toContain('token-partA');
    });
  });

  describe('sanitized failures', () => {
    it('fails closed on corrupted ciphertext without exposing crypto material', async () => {
      const setup = await beginFor('partA');
      const row = store.enrollments.get(setup.enrollmentId)!;
      row.secret_auth_tag = Buffer.alloc(16, 1).toString('base64');

      const response = await api('partA').confirm(setup.enrollmentId, _totpCodeForTest(setup.secret, new Date()));
      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        error: 'Authenticator enrollment is temporarily unavailable. Please try again later.',
        code: 'AUTHENTICATOR_ENROLLMENT_UNAVAILABLE',
        retryable: true,
      });
      expect((await api('partA').status()).body.authenticator.status).toBe('pending');
      const text = `${JSON.stringify(response.body)}\n${logs.text()}`;
      expectNoStorageMaterialIn(text);
      expectNoIssuedSecretsIn(text);
      // Operators still get a safe, correlatable signal.
      expect(logs.text()).toMatch(/\[AUTHENTICATOR\] operation failed.*AUTHENTICATOR_ENROLLMENT_UNAVAILABLE/);
    });

    it('maps missing encryption configuration to a safe configuration error', async () => {
      protectorFactory = () => {
        throw new TotpEncryptionConfigurationError();
      };
      const response = await api('adminA').begin();
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('AUTHENTICATOR_CONFIGURATION_ERROR');
      expect(JSON.stringify(response.body)).not.toMatch(/TOTP_ENCRYPTION_KEY|base64|aes|key/i);
    });

    it('never echoes SQL/storage internals from a database failure', async () => {
      await activeFor('partB');
      store.failNext = new Error(
        'relation "authenticator_recovery_codes" violates constraint uq_authenticator_recovery_codes_participant_verifier DETAIL: Key (code_verifier)=(abc)'
      );
      const response = await api('partB').generate(null);
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('RECOVERY_CODES_UNAVAILABLE');
      const text = `${JSON.stringify(response.body)}\n${logs.text()}`;
      expect(text).not.toMatch(/relation|constraint|code_verifier|DETAIL/);
    });
  });
});

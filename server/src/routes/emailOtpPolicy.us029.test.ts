import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { mfaRepository } from '../db/mfa.repository.js';
import type { MfaAttempt, MfaChallenge, Participant } from '../db/types.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import { _resetRateLimiter } from '../utils/rateLimiter.js';
import { LOCKOUT_WINDOW_MS, OTP_EXPIRY_SECONDS } from '../utils/otp.js';
import { _resetMfaOtpEmailSender, _setMfaOtpEmailSender } from '../services/issueMfaOtp.js';
import { createTotpSecretProtector } from '../security/totpSecretEncryption.js';
import { createRecoveryCodeVerifier } from '../security/recoveryCodes.js';
import { _totpCodeForTest } from '../security/totp.js';
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
import { MemoryAuthenticatorStore } from './authenticatorMemoryStore.testUtils.js';

/**
 * US-029 / #271 — email OTP and the five-attempt / 15-minute lock still hold
 * alongside authenticator TOTP, recovery codes, and #269 reauthentication.
 *
 * Layer: route. Real Express stack, real US-004 services (issue/verify/lock
 * math), real US-029 persistent providers (AES-GCM/TOTP/HMAC) over in-memory
 * stores. The OTP store yields between calls so concurrent requests interleave
 * like a database, and performs compare-and-set / serialized reservation
 * atomically like PostgreSQL. Firebase Admin is mocked. Time uses fake Date.
 * This is not a live end-to-end test; the 0066 SQL is covered by PGlite.
 *
 * It exercises the path the React UI actually uses:
 * POST /api/auth/mfa/challenge + POST /api/auth/mfa/verify { challengeId, code }.
 */

const mockVerifyIdToken = vi.fn();
const mockGetUser = vi.fn();
const mockSetCustomUserClaims = vi.fn();
vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    getUser: (...args: unknown[]) => mockGetUser(...args),
    setCustomUserClaims: (...args: unknown[]) => mockSetCustomUserClaims(...args),
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

const T0 = Date.UTC(2026, 10, 12, 10, 0, 0);
const KEY = Buffer.alloc(32, 7).toString('base64');

function account(id: string, uid: string, role: 'PART' | 'ADMIN', extra: Partial<Participant> = {}): Participant {
  return {
    id,
    firebase_uid: uid,
    email: `${uid}@example.com`,
    full_name: uid,
    role,
    is_verified: true,
    is_suspended: false,
    is_deactivated: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

const ACCOUNTS = {
  part: account('10000000-0000-4000-8000-000000000001', 'fb-part', 'PART'),
  admin: account('10000000-0000-4000-8000-000000000002', 'fb-admin', 'ADMIN'),
  other: account('10000000-0000-4000-8000-000000000003', 'fb-other', 'PART'),
  suspended: account('10000000-0000-4000-8000-000000000004', 'fb-suspended', 'PART', { is_suspended: true }),
  deactivated: account('10000000-0000-4000-8000-000000000005', 'fb-deactivated', 'PART', { is_deactivated: true }),
  unverified: account('10000000-0000-4000-8000-000000000006', 'fb-unverified', 'PART', { is_verified: false }),
};
type AccountName = keyof typeof ACCOUNTS;

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

/** In-memory mfa_challenges / mfa_attempts with database-like atomicity. */
class MemoryMfaStore {
  challenges: MfaChallenge[] = [];
  attempts: MfaAttempt[] = [];
  consumeCalls = 0;
  failNext: { method: string; error: unknown } | null = null;
  private lastMs = 0;
  private seq = 0;

  private async enter(method: string) {
    await tick();
    if (this.failNext?.method === method) {
      const { error } = this.failNext;
      this.failNext = null;
      throw error;
    }
  }

  failures(participantId: string) {
    return this.attempts.filter((a) => a.participant_id === participantId && !a.success);
  }
  successes(participantId: string) {
    return this.attempts.filter((a) => a.participant_id === participantId && a.success);
  }

  install() {
    vi.spyOn(mfaRepository, 'createChallenge').mockImplementation(async (data) => {
      await this.enter('createChallenge');
      const now = new Date().toISOString();
      const challenge: MfaChallenge = {
        id: `20000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`,
        participant_id: data.participant_id,
        otp_hash: data.otp_hash,
        expires_at: data.expires_at,
        consumed_at: null,
        invalidated_at: null,
        created_at: now,
        updated_at: now,
      };
      this.challenges.push(challenge);
      return { ...challenge };
    });
    vi.spyOn(mfaRepository, 'getChallengeById').mockImplementation(async (id) => {
      await this.enter('getChallengeById');
      const found = this.challenges.find((c) => c.id === id);
      return found ? { ...found } : null;
    });
    vi.spyOn(mfaRepository, 'getLatestActiveChallenge').mockImplementation(async (participantId) => {
      await this.enter('getLatestActiveChallenge');
      const now = Date.now();
      const active = this.challenges
        .filter(
          (c) =>
            c.participant_id === participantId &&
            !c.consumed_at &&
            !c.invalidated_at &&
            Date.parse(c.expires_at) > now
        )
        .at(-1);
      return active ? { ...active } : null;
    });
    vi.spyOn(mfaRepository, 'invalidatePendingChallenges').mockImplementation(async (participantId) => {
      await this.enter('invalidatePendingChallenges');
      let count = 0;
      for (const c of this.challenges) {
        if (c.participant_id === participantId && !c.consumed_at && !c.invalidated_at) {
          c.invalidated_at = new Date().toISOString();
          count += 1;
        }
      }
      return count;
    });
    vi.spyOn(mfaRepository, 'markChallengeConsumed').mockImplementation(async (id) => {
      await this.enter('markChallengeConsumed');
      const c = this.challenges.find((row) => row.id === id);
      if (!c || c.consumed_at || c.invalidated_at) throw new Error('not consumable');
      c.consumed_at = new Date().toISOString();
      return { ...c };
    });
    vi.spyOn(mfaRepository, 'tryConsumeChallenge').mockImplementation(async (id, otpHash) => {
      await this.enter('tryConsumeChallenge');
      this.consumeCalls += 1;
      // Atomic compare-and-set, as the single UPDATE ... WHERE is in PostgreSQL.
      const c = this.challenges.find((row) => row.id === id);
      if (
        !c ||
        c.otp_hash !== otpHash ||
        c.consumed_at ||
        c.invalidated_at ||
        Date.parse(c.expires_at) <= Date.now()
      ) {
        return null;
      }
      c.consumed_at = new Date().toISOString();
      return { ...c };
    });
    vi.spyOn(mfaRepository, 'createAttempt').mockImplementation(async (data) => {
      await this.enter('createAttempt');
      return this.push(data.participant_id, data.challenge_id ?? null, data.success);
    });
    vi.spyOn(mfaRepository, 'reserveAttempt').mockImplementation(async (data) => {
      await this.enter('reserveAttempt');
      // Advisory-locked insert with clock_timestamp(): strictly ordered.
      return this.push(data.participant_id, data.challenge_id ?? null, false);
    });
    vi.spyOn(mfaRepository, 'markAttemptSucceeded').mockImplementation(async (id, participantId) => {
      await this.enter('markAttemptSucceeded');
      const a = this.attempts.find((row) => row.id === id && row.participant_id === participantId);
      if (a) a.success = true;
    });
    vi.spyOn(mfaRepository, 'discardAttempt').mockImplementation(async (id, participantId) => {
      await this.enter('discardAttempt');
      this.attempts = this.attempts.filter(
        (row) => !(row.id === id && row.participant_id === participantId && !row.success)
      );
    });
    vi.spyOn(mfaRepository, 'getRecentAttempts').mockImplementation(async (participantId, limit = 10) => {
      await this.enter('getRecentAttempts');
      return this.attempts
        .filter((a) => a.participant_id === participantId)
        .slice()
        .reverse()
        .slice(0, limit)
        .map((a) => ({ ...a }));
    });
    vi.spyOn(mfaRepository, 'countRecentChallenges').mockImplementation(async (participantId, since) => {
      await this.enter('countRecentChallenges');
      const sinceMs = new Date(since).getTime();
      return this.challenges.filter(
        (c) => c.participant_id === participantId && Date.parse(c.created_at) >= sinceMs
      ).length;
    });
  }

  private push(participantId: string, challengeId: string | null, success: boolean): MfaAttempt {
    this.lastMs = Math.max(this.lastMs + 1, Date.now());
    // Strictly ordered like clock_timestamp(); time moves forward rather than rows
    // being stamped ahead of "now" (a database never writes a future created_at).
    if (this.lastMs > Date.now()) vi.setSystemTime(this.lastMs);
    const attempt: MfaAttempt = {
      id: `30000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`,
      participant_id: participantId,
      challenge_id: challengeId,
      success,
      ip_address: null,
      created_at: new Date(this.lastMs).toISOString(),
    };
    this.attempts.push(attempt);
    return { ...attempt };
  }
}

describe('US-029 preserves email OTP and the five-attempt / 15-minute lock (#271)', () => {
  let otp: MemoryMfaStore;
  let authenticators: MemoryAuthenticatorStore;
  let claims: Record<string, Record<string, unknown>>;
  let tokens: Map<string, { account: Participant; authTime: number }>;
  let sentCodes: Array<{ email: string; code: string }>;
  let tokenSeq: number;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    _resetRateLimiter();
    otp = new MemoryMfaStore();
    otp.install();
    authenticators = new MemoryAuthenticatorStore();
    claims = {};
    tokens = new Map();
    sentCodes = [];
    tokenSeq = 0;
    for (const a of Object.values(ACCOUNTS)) claims[a.firebase_uid] = { role: a.role };

    _setMfaOtpEmailSender(async (email: string, code: string) => {
      sentCodes.push({ email, code });
    });
    mockGetUser.mockImplementation(async (uid: string) => ({ uid, customClaims: { ...claims[uid] } }));
    mockSetCustomUserClaims.mockImplementation(async (uid: string, next: Record<string, unknown>) => {
      claims[uid] = { ...next };
    });
    // A Firebase ID token carries the sign-in's auth_time plus the user's current custom claims.
    mockVerifyIdToken.mockImplementation(async (token: string) => {
      const entry = tokens.get(token);
      if (!entry) throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' });
      const { account: a, authTime } = entry;
      return {
        uid: a.firebase_uid,
        email: a.email,
        email_verified: a.is_verified,
        auth_time: authTime,
        iat: authTime,
        exp: authTime + 3600,
        firebase: { sign_in_provider: 'password', identities: {} },
        ...claims[a.firebase_uid],
      };
    });
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockImplementation(
      async (uid: string) => Object.values(ACCOUNTS).find((a) => a.firebase_uid === uid) ?? null
    );
    vi.spyOn(participantsRepository, 'findById').mockImplementation(
      async (id: string) => Object.values(ACCOUNTS).find((a) => a.id === id) ?? null
    );

    _setAuthenticatorEnrollmentProvider(
      createPersistentAuthenticatorEnrollmentProvider({
        repository: authenticators,
        getProtector: () => createTotpSecretProtector(KEY, 'v1'),
      })
    );
    _setAuthenticatorRecoveryControlsProvider(
      createPersistentAuthenticatorRecoveryControlsProvider({
        repository: authenticators,
        enrollmentRepository: authenticators,
        getProtector: () => createTotpSecretProtector(KEY, 'v1'),
        getVerifier: () => createRecoveryCodeVerifier(KEY, 'v1'),
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetMfaOtpEmailSender();
    _resetAuthenticatorEnrollmentProvider();
    _resetAuthenticatorRecoveryControlsProvider();
  });

  /** Firebase primary sign-in or reauthentication: a new token with a new auth_time. */
  function signIn(name: AccountName, at = Date.now()): string {
    const token = `token-${name}-${++tokenSeq}`;
    tokens.set(token, { account: ACCOUNTS[name], authTime: Math.floor(at / 1000) });
    return token;
  }
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const challenge = (token: string) => request(app).post('/api/auth/mfa/challenge').set(bearer(token));
  const verify = (token: string, challengeId: string, code: string) =>
    request(app).post('/api/auth/mfa/verify').set(bearer(token)).send({ challengeId, code });
  const authenticatorStatus = (token: string) =>
    request(app).get('/api/auth/mfa/authenticator/enrollment').set(bearer(token));
  const lastCode = () => sentCodes.at(-1)!.code;
  const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

  async function newChallenge(token: string) {
    _resetRateLimiter();
    const response = await challenge(token);
    expect(response.status).toBe(200);
    return { challengeId: response.body.challengeId as string, code: lastCode() };
  }

  /** Signs in and completes email OTP, so the session satisfies requireMfa. */
  async function mfaSession(name: AccountName) {
    const token = signIn(name);
    const c = await newChallenge(token);
    expect((await verify(token, c.challengeId, c.code)).status).toBe(200);
    return token;
  }

  async function failTimes(token: string, challengeId: string, code: string, times: number) {
    const statuses: number[] = [];
    for (let i = 0; i < times; i += 1) statuses.push((await verify(token, challengeId, wrong(code))).status);
    return statuses;
  }

  // ---------------------------------------------------------------- contract
  describe('existing US-004 contract on the UI path', () => {
    it.each(['part', 'admin'] as const)(
      '%s: issues a masked 10-minute challenge, accepts the code once, and sets mfa_auth_time = auth_time',
      async (name) => {
        const token = signIn(name);
        const issued = await challenge(token);
        expect(issued.status).toBe(200);
        expect(issued.body).toMatchObject({ requiresOtp: true, expiresInSeconds: OTP_EXPIRY_SECONDS });
        expect(issued.body.email).toMatch(/\*\*\*/);
        expect(JSON.stringify(issued.body)).not.toContain(lastCode());
        expect(issued.headers['cache-control']).toBe('no-store');

        // Before email OTP, the current session does not satisfy MFA.
        expect((await authenticatorStatus(token)).body.code).toBe('MFA_REQUIRED');

        const ok = await verify(token, issued.body.challengeId, lastCode());
        expect(ok.status).toBe(200);
        expect(ok.body).toEqual({ verified: true, message: expect.any(String) });
        expect(JSON.stringify(ok.body)).not.toContain(lastCode());
        expect(claims[ACCOUNTS[name].firebase_uid]![MFA_CLAIM]).toBe(Math.floor(T0 / 1000));

        // The refreshed token now satisfies requireMfa on a US-029 route.
        const status = await authenticatorStatus(token);
        expect(status.status).toBe(200);
        expect(status.body.availableChallengeMethods).toContain('email_otp');
        expect(status.body.emailOtpFallback).toBe(true);

        // One-time: the same code cannot be replayed.
        expect((await verify(token, issued.body.challengeId, lastCode())).body.code).toBe('OTP_CONSUMED');
        expect(otp.successes(ACCOUNTS[name].id)).toHaveLength(1);
        expect(otp.failures(ACCOUNTS[name].id)).toHaveLength(0);
      }
    );

    it.each(['part', 'admin'] as const)(
      '%s: attempts 1–4 fail normally, attempt 5 locks, attempt 6 is rejected without being compared',
      async (name) => {
        const token = signIn(name);
        const c = await newChallenge(token);

        for (let attempt = 1; attempt <= 4; attempt += 1) {
          const response = await verify(token, c.challengeId, wrong(c.code));
          expect(response.status, `attempt ${attempt}`).toBe(401);
          expect(response.body.code).toBe('INVALID_OTP');
          expect(otp.failures(ACCOUNTS[name].id)).toHaveLength(attempt);
        }

        const fifth = await verify(token, c.challengeId, wrong(c.code));
        expect(fifth.status).toBe(423);
        expect(fifth.body.code).toBe('ACCOUNT_LOCKED');
        expect(fifth.body.retryAfter).toBe(LOCKOUT_WINDOW_MS / 1000);
        expect(fifth.headers['retry-after']).toBe('900');
        // Lock invalidates outstanding challenges.
        expect(otp.challenges.every((row) => row.invalidated_at || row.consumed_at)).toBe(true);

        const comparisonsBefore = otp.consumeCalls;
        const sixth = await verify(token, c.challengeId, c.code); // even the correct code
        expect(sixth.status).toBe(423);
        expect(sixth.body.code).toBe('ACCOUNT_LOCKED');
        expect(otp.consumeCalls).toBe(comparisonsBefore);
        expect(otp.failures(ACCOUNTS[name].id)).toHaveLength(5);
        expect(claims[ACCOUNTS[name].firebase_uid]![MFA_CLAIM]).toBeUndefined();
      }
    );

    it('keeps the full 15 minutes: locked at −1 ms, over at exactly +15 min, usable after fresh sign-in', async () => {
      const stale = signIn('part');
      const c = await newChallenge(stale);
      await failTimes(stale, c.challengeId, c.code, 5);
      const lockStart = Date.parse(otp.failures(ACCOUNTS.part.id).at(-1)!.created_at);
      const lockEnd = lockStart + LOCKOUT_WINDOW_MS;

      // Just before expiry: both issuance and verification are still locked.
      vi.setSystemTime(lockEnd - 1);
      const lockedVerify = await verify(stale, c.challengeId, c.code);
      expect(lockedVerify.status).toBe(423);
      expect(lockedVerify.body.retryAfter).toBe(1);
      _resetRateLimiter();
      expect((await challenge(stale)).status).toBe(423);

      // Exactly at expiry the lock is over (policy: locked while now < end) — but a
      // sign-in that predates the lock must authenticate again (US-004-T6, aligned in #271).
      vi.setSystemTime(lockEnd);
      _resetRateLimiter();
      const staleIssue = await challenge(stale);
      expect(staleIssue.status).toBe(401);
      expect(staleIssue.body.code).toBe('FRESH_AUTH_REQUIRED');
      const staleVerify = await verify(stale, c.challengeId, c.code);
      expect(staleVerify.status).toBe(401);
      expect(staleVerify.body.code).toBe('FRESH_AUTH_REQUIRED');
      expect(otp.failures(ACCOUNTS.part.id)).toHaveLength(5); // neither request counted

      // Immediately after expiry, a fresh primary sign-in can complete email OTP.
      vi.setSystemTime(lockEnd + 1000);
      const fresh = signIn('part');
      const next = await newChallenge(fresh);
      const ok = await verify(fresh, next.challengeId, next.code);
      expect(ok.status).toBe(200);
      expect(claims[ACCOUNTS.part.firebase_uid]![MFA_CLAIM]).toBe(Math.floor((lockEnd + 1000) / 1000));
      expect((await authenticatorStatus(fresh)).status).toBe(200);

      // Success reset the cycle: four new failures do not lock (no permanent lock).
      const after = await newChallenge(fresh);
      expect(await failTimes(fresh, after.challengeId, after.code, 4)).toEqual([401, 401, 401, 401]);
    });

    it('invalid, expired, stale, consumed, and foreign submissions never count, reset, or lock', async () => {
      const token = signIn('part');
      const c = await newChallenge(token);
      await failTimes(token, c.challengeId, c.code, 4);
      const before = JSON.stringify(otp.attempts);

      for (const body of [
        { challengeId: c.challengeId, code: '12345' },
        { challengeId: c.challengeId, code: '1234567' },
        { challengeId: c.challengeId, code: '12ab56' },
        { challengeId: c.challengeId },
        { code: '123456' },
        { challengeId: '', code: '123456' },
      ]) {
        const response = await request(app).post('/api/auth/mfa/verify').set(bearer(token)).send(body);
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Validation failed');
      }
      expect(JSON.stringify(otp.attempts)).toBe(before);

      // Foreign challenge: indistinguishable "no longer valid", nothing recorded for either account.
      const otherToken = signIn('other');
      const foreign = await newChallenge(otherToken);
      const cross = await verify(token, foreign.challengeId, foreign.code);
      expect(cross.status).toBe(404);
      expect(cross.body.code).toBe('CHALLENGE_NOT_FOUND');
      expect(otp.attempts.filter((a) => a.participant_id === ACCOUNTS.other.id)).toHaveLength(0);
      expect(JSON.stringify(otp.attempts)).toBe(before);
      expect((await verify(otherToken, foreign.challengeId, foreign.code)).status).toBe(200);

      // The 5th genuine attempt is still available and still decisive.
      const ok = await verify(token, c.challengeId, c.code);
      expect(ok.status).toBe(200);

      // Consumed and expired challenges are rejected without counting.
      expect((await verify(token, c.challengeId, c.code)).body.code).toBe('OTP_CONSUMED');
      const expiring = await newChallenge(token);
      // Exactly at the 10-minute boundary the code is already expired (now >= expires_at).
      vi.setSystemTime(Date.now() + OTP_EXPIRY_SECONDS * 1000);
      const expired = await verify(token, expiring.challengeId, expiring.code);
      expect(expired.status).toBe(400);
      expect(expired.body.code).toBe('OTP_EXPIRED');
      expect(otp.failures(ACCOUNTS.part.id)).toHaveLength(4);
    });

    it('resend: reuses within cooldown, invalidates the predecessor, never resets attempts, and cannot escape a lock', async () => {
      const token = signIn('part');
      _resetRateLimiter();
      const first = await challenge(token);
      const firstCode = lastCode();
      const immediate = await challenge(token);
      expect(immediate.body.challengeId).toBe(first.body.challengeId); // #356 reuse
      expect(sentCodes).toHaveLength(1);

      await failTimes(token, first.body.challengeId, firstCode, 3);
      const second = await newChallenge(token); // after cooldown
      expect(second.challengeId).not.toBe(first.body.challengeId);
      const predecessor = await verify(token, first.body.challengeId, firstCode);
      expect(predecessor.body.code).toBe('OTP_EXPIRED');
      expect(otp.failures(ACCOUNTS.part.id)).toHaveLength(3); // stale code did not count

      expect((await verify(token, second.challengeId, wrong(second.code))).status).toBe(401);
      const lock = await verify(token, second.challengeId, wrong(second.code));
      expect(lock.status).toBe(423); // 3 + 2 = 5 across challenges

      _resetRateLimiter();
      const resendWhileLocked = await challenge(token);
      expect(resendWhileLocked.status).toBe(423);
      expect(resendWhileLocked.body.code).toBe('ACCOUNT_LOCKED');
      expect(sentCodes).toHaveLength(2); // no code was emailed while locked
      expect((await verify(token, second.challengeId, second.code)).status).toBe(423);
    });
  });

  // ------------------------------------------------------------ race safety
  describe('concurrency cannot raise the five-attempt limit (#271 fix)', () => {
    async function fourFailures() {
      const token = signIn('part');
      const c = await newChallenge(token);
      expect(await failTimes(token, c.challengeId, c.code, 4)).toEqual([401, 401, 401, 401]);
      return { token, ...c };
    }

    it('compares exactly one of 16 simultaneous wrong guesses after four failures', async () => {
      const { token, challengeId, code } = await fourFailures();
      const comparisonsBefore = otp.consumeCalls;
      const guesses = Array.from({ length: 16 }, (_, i) => String(100000 + i)).filter((g) => g !== code);

      const responses = await Promise.all(guesses.map((g) => verify(token, challengeId, g)));

      expect(otp.consumeCalls - comparisonsBefore).toBe(1);
      expect(responses.every((r) => r.status === 423 && r.body.code === 'ACCOUNT_LOCKED')).toBe(true);
      expect(otp.failures(ACCOUNTS.part.id)).toHaveLength(5);
      expect((await verify(token, challengeId, code)).status).toBe(423);
    });

    it('a correct guess inside a burst succeeds only if it holds the single remaining slot', async () => {
      const { token, challengeId, code } = await fourFailures();
      const comparisonsBefore = otp.consumeCalls;
      const burst = [...Array.from({ length: 15 }, (_, i) => wrong(code).slice(0, 5) + (i % 10)), code];

      const responses = await Promise.all(burst.map((g) => verify(token, challengeId, g)));
      const successes = responses.filter((r) => r.status === 200);

      expect(otp.consumeCalls - comparisonsBefore).toBe(1);
      expect(successes.length).toBeLessThanOrEqual(1);
      if (successes.length === 1) {
        // It was the 5th and only compared attempt; nothing else was evaluated.
        expect(otp.failures(ACCOUNTS.part.id)).toHaveLength(4);
      } else {
        expect(otp.failures(ACCOUNTS.part.id)).toHaveLength(5);
      }
    });

    it('concurrent submissions of the same valid code consume it exactly once and count nothing', async () => {
      const token = signIn('admin');
      const c = await newChallenge(token);
      const [a, b] = await Promise.all([verify(token, c.challengeId, c.code), verify(token, c.challengeId, c.code)]);
      expect([a.status, b.status].sort()).toEqual([200, 400]);
      expect([a.body.code, b.body.code]).toContain('OTP_CONSUMED');
      expect(otp.successes(ACCOUNTS.admin.id)).toHaveLength(1);
      expect(otp.failures(ACCOUNTS.admin.id)).toHaveLength(0);
    });

    it('a resend racing a verification never counts a failure or accepts a superseded code twice', async () => {
      const token = signIn('part');
      const c = await newChallenge(token);
      _resetRateLimiter();
      const [verified, resent] = await Promise.all([verify(token, c.challengeId, c.code), challenge(token)]);
      expect(resent.status).toBe(200);
      expect([200, 400]).toContain(verified.status);
      expect(otp.failures(ACCOUNTS.part.id)).toHaveLength(0);
      expect(otp.successes(ACCOUNTS.part.id).length).toBeLessThanOrEqual(1);
    });
  });

  // ----------------------------------------------------------- coexistence
  describe('authenticator TOTP and recovery codes coexist without touching email OTP state', () => {
    it('authenticator setup, failed TOTP, recovery rotation, replacement, and disable never reset or clear the email OTP counter', async () => {
      const session = await mfaSession('part');
      const loginAgain = signIn('part');
      const c = await newChallenge(loginAgain);
      await failTimes(loginAgain, c.challengeId, c.code, 4);
      const attemptsBefore = JSON.stringify(otp.attempts);
      const challengesBefore = JSON.stringify(otp.challenges);

      const auth = (path: string, body: object = {}) =>
        request(app).post(`/api/auth/mfa/authenticator${path}`).set(bearer(session)).send(body);
      const begun = await auth('/enrollment');
      expect(begun.status).toBe(201);
      for (let i = 0; i < 3; i += 1) {
        expect((await auth('/enrollment/confirm', { enrollmentId: begun.body.authenticator.enrollmentId, code: '000000' })).status).toBe(401);
      }
      const totp = _totpCodeForTest(begun.body.setup.manualEntryKey, new Date());
      expect((await auth('/enrollment/confirm', { enrollmentId: begun.body.authenticator.enrollmentId, code: totp })).status).toBe(200);
      const codes = await auth('/recovery-codes', { expectedBatchId: null });
      expect(codes.status).toBe(201);
      expect((await auth('/recovery-codes', { expectedBatchId: codes.body.recoveryCodes.batchId })).status).toBe(201);
      const replacement = await auth('/replacement');
      const replacementCode = _totpCodeForTest(replacement.body.setup.manualEntryKey, new Date());
      expect(
        (await auth('/replacement/confirm', { enrollmentId: replacement.body.authenticator.enrollmentId, code: replacementCode })).status
      ).toBe(200);
      expect((await auth('/disable')).status).toBe(200);

      // Email OTP state is byte-for-byte unchanged by every authenticator operation.
      expect(JSON.stringify(otp.attempts)).toBe(attemptsBefore);
      expect(JSON.stringify(otp.challenges)).toBe(challengesBefore);
      // So the 5th email failure still locks exactly as before.
      expect((await verify(loginAgain, c.challengeId, wrong(c.code))).status).toBe(423);
    });

    it('email OTP remains a working fallback with an active, replaced, rotated, or disabled authenticator', async () => {
      let session = await mfaSession('admin');
      const auth = (path: string, body: object = {}) =>
        request(app).post(`/api/auth/mfa/authenticator${path}`).set(bearer(session)).send(body);
      const completeEmailOtp = async () => {
        vi.setSystemTime(Date.now() + 1000); // a later sign-in gets a new auth_time
        const login = signIn('admin');
        const issued = await newChallenge(login);
        expect((await verify(login, issued.challengeId, issued.code)).status).toBe(200);
        const status = await authenticatorStatus(login);
        expect(status.status).toBe(200);
        expect(status.body.availableChallengeMethods).toContain('email_otp');
        expect(status.body.emailOtpFallback).toBe(true);
        // mfa_auth_time is per user: the newest sign-in's OTP supersedes older sessions (US-004).
        expect((await authenticatorStatus(session)).body.code).toBe('MFA_REQUIRED');
        session = login;
        return status.body.authenticator.status as string;
      };

      const begun = await auth('/enrollment');
      await auth('/enrollment/confirm', {
        enrollmentId: begun.body.authenticator.enrollmentId,
        code: _totpCodeForTest(begun.body.setup.manualEntryKey, new Date()),
      });
      expect(await completeEmailOtp()).toBe('active');

      await auth('/recovery-codes', { expectedBatchId: null });
      expect(await completeEmailOtp()).toBe('active');

      const replacement = await auth('/replacement');
      await auth('/replacement/confirm', {
        enrollmentId: replacement.body.authenticator.enrollmentId,
        code: _totpCodeForTest(replacement.body.setup.manualEntryKey, new Date()),
      });
      expect(await completeEmailOtp()).toBe('active');

      await auth('/disable');
      expect(await completeEmailOtp()).toBe('not_enrolled');
    });
  });

  // ---------------------------------------------------------- reauthentication
  describe('#269 reauthentication reuses email OTP with the same policy', () => {
    it('Firebase reauth → new auth_time → email OTP → mfa_auth_time updated → sensitive action proceeds', async () => {
      const session = await mfaSession('part');
      expect((await authenticatorStatus(session)).status).toBe(200);

      vi.setSystemTime(T0 + 11 * 60_000); // past the 10-minute recent-auth window
      expect((await authenticatorStatus(session)).body.code).toBe('REAUTHENTICATION_REQUIRED');

      const reauth = signIn('part'); // Firebase primary reauthentication
      expect((await authenticatorStatus(reauth)).body.code).toBe('MFA_REQUIRED');
      const c = await newChallenge(reauth);
      expect((await verify(reauth, c.challengeId, c.code)).status).toBe(200);
      expect(claims[ACCOUNTS.part.firebase_uid]![MFA_CLAIM]).toBe(Math.floor((T0 + 11 * 60_000) / 1000));
      expect((await request(app).post('/api/auth/mfa/authenticator/enrollment').set(bearer(reauth)).send({})).status).toBe(201);
    });

    it('failed codes during reauthentication count toward — and cannot bypass — the same lock', async () => {
      // Four failures earlier (e.g. an attacker's login attempt) carry over into reauth.
      const earlier = signIn('admin');
      const first = await newChallenge(earlier);
      await failTimes(earlier, first.challengeId, first.code, 4);

      vi.setSystemTime(T0 + 60_000);
      const reauth = signIn('admin');
      const c = await newChallenge(reauth);
      const fifth = await verify(reauth, c.challengeId, wrong(c.code));
      expect(fifth.status).toBe(423);
      expect((await verify(reauth, c.challengeId, c.code)).status).toBe(423);
      expect((await authenticatorStatus(reauth)).body.code).toBe('MFA_REQUIRED');

      // After the lock, the reauth sign-in predates it: verify again, then succeed.
      const lockEnd = Date.parse(otp.failures(ACCOUNTS.admin.id).at(-1)!.created_at) + LOCKOUT_WINDOW_MS;
      vi.setSystemTime(lockEnd + 1000);
      _resetRateLimiter();
      expect((await challenge(reauth)).body.code).toBe('FRESH_AUTH_REQUIRED');
      const again = signIn('admin');
      const next = await newChallenge(again);
      expect((await verify(again, next.challengeId, next.code)).status).toBe(200);
      expect((await authenticatorStatus(again)).status).toBe(200);
    });
  });

  // ------------------------------------------------------ authorization & failures
  describe('authorization, account state, and failure handling', () => {
    it('rejects unauthenticated, suspended, deactivated, and unverified callers before any OTP state changes', async () => {
      expect((await request(app).post('/api/auth/mfa/challenge')).status).toBe(401);
      expect((await request(app).post('/api/auth/mfa/verify').send({ challengeId: 'x', code: '123456' })).status).toBe(401);
      for (const [name, code] of [
        ['suspended', 'ACCOUNT_SUSPENDED'],
        ['deactivated', 'ACCOUNT_SUSPENDED'],
        ['unverified', 'EMAIL_NOT_VERIFIED'],
      ] as const) {
        const token = signIn(name);
        const issue = await challenge(token);
        expect(issue.status, name).toBe(403);
        expect(issue.body.code, name).toBe(code);
        const check = await verify(token, '20000000-0000-4000-8000-000000000001', '123456');
        expect(check.status, name).toBe(403);
      }
      expect(otp.challenges).toHaveLength(0);
      expect(otp.attempts).toHaveLength(0);
      expect(sentCodes).toHaveLength(0);
    });

    it('email provider failure returns a safe retryable 502 and leaves no usable challenge or counted attempt', async () => {
      _setMfaOtpEmailSender(async () => {
        throw new Error('SMTP 554 relay denied for smtp.internal:587');
      });
      const response = await challenge(signIn('part'));
      expect(response.status).toBe(502);
      expect(response.body).toMatchObject({ code: 'EMAIL_DELIVERY_FAILED', retryable: true });
      expect(JSON.stringify(response.body)).not.toMatch(/SMTP|relay|smtp\.internal/);
      expect(otp.challenges.every((c) => c.invalidated_at)).toBe(true);
      expect(otp.attempts).toHaveLength(0);
    });

    it('storage failures are generic and never count as incorrect attempts', async () => {
      const token = signIn('part');
      const c = await newChallenge(token);

      otp.failNext = { method: 'reserveAttempt', error: new Error('connection reset by mfa_attempts host 10.0.0.9') };
      const duringReserve = await verify(token, c.challengeId, wrong(c.code));
      expect(duringReserve.status).toBe(500);
      expect(duringReserve.body).toEqual({ error: 'Internal Server Error' });

      otp.failNext = { method: 'tryConsumeChallenge', error: new Error('deadlock detected on mfa_challenges') };
      const duringCompare = await verify(token, c.challengeId, wrong(c.code));
      expect(duringCompare.status).toBe(500);
      expect(JSON.stringify(duringCompare.body)).not.toMatch(/deadlock|mfa_/);

      expect(otp.failures(ACCOUNTS.part.id)).toHaveLength(0); // reservation was discarded
      expect((await verify(token, c.challengeId, c.code)).status).toBe(200);
    });

    it('a missing MFA store maps to 503 without counting', async () => {
      const token = signIn('part');
      const c = await newChallenge(token);
      otp.failNext = { method: 'getRecentAttempts', error: { code: '42P01', message: 'relation "mfa_attempts" does not exist' } };
      const response = await verify(token, c.challengeId, c.code);
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('MFA_STORE_UNAVAILABLE');
      expect(otp.attempts).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------- privacy
  describe('#270 logging hardening still protects email OTP values', () => {
    it('never logs emailed codes, submitted codes, tokens, or malformed JSON bodies', async () => {
      const lines: string[] = [];
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
        })
      );
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const token = signIn('part');
        const c = await newChallenge(token);
        const badGuess = c.code === '913579' ? '913580' : '913579';
        await verify(token, c.challengeId, badGuess);
        await verify(token, c.challengeId, c.code);
        await request(app)
          .post('/api/auth/mfa/verify')
          .set(bearer(token))
          .set('Content-Type', 'application/json')
          .send(`{"challengeId":"${c.challengeId}","code":"${c.code}",`);
        await request(app).post('/api/auth/mfa/verify').set(bearer(token)).send({ challengeId: c.challengeId, otp: c.code });

        const text = lines.join('\n');
        expect(text).toContain('/api/auth/mfa/verify'); // the request logger really ran
        for (const sent of sentCodes) expect(text).not.toContain(sent.code);
        expect(text).not.toContain(badGuess);
        expect(text).not.toContain(token);
      } finally {
        process.env.NODE_ENV = originalEnv;
        spies.forEach((spy) => spy.mockRestore());
      }
    });
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { createPgliteSupabaseClient } from '../db/pgliteSupabase.testUtils.js';
import { _totpCodeForTest } from '../security/totp.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import { _resetRateLimiter } from '../utils/rateLimiter.js';
import { _resetMfaOtpEmailSender, _setMfaOtpEmailSender } from '../services/issueMfaOtp.js';

/**
 * US-029 / #272 — authenticator setup failure and activation, integration-style.
 *
 * Path under test: HTTP (supertest) → Express middleware (Firebase auth, active
 * account, current-session MFA, PART/ADMIN role, recent auth) → controllers →
 * services → PRODUCTION persistent providers (real AES-256-GCM, TOTP, HMAC) →
 * REAL repository query code → PostgreSQL (PGlite) with the full migration chain
 * 0001 → 0003 → 0010 → 0039 → 0063 → 0064 → 0065 → 0066.
 *
 * Mocked external boundaries (this is NOT a live end-to-end test):
 *  - Firebase Admin token verification / custom claims (in-memory claim store);
 *  - the email OTP transport (codes are captured instead of sent);
 *  - the Supabase client is a PGlite adapter emulating PostgREST semantics;
 *  - the JS clock (fake Date, only moved forward). PostgreSQL NOW() is real, so
 *    JS-side expiry checks are exercised here and SQL-side expiry by PGlite suites.
 *  - PGlite is a single connection: concurrent requests interleave statement by
 *    statement; cross-connection advisory-lock contention is PostgreSQL's guarantee.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../db/client.js', () => ({
  getSupabaseClient: () => holder.client,
  supabaseClient: new Proxy({}, { get: (_target, prop) => (holder.client as Record<string | symbol, unknown>)[prop] }),
}));

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations');
const CHAIN = [
  '0001_create_participants_table.sql',
  '0003_create_mfa_records.sql',
  '0010_add_participant_suspension.sql',
  '0039_account_enforcement_models.sql',
  '0063_create_authenticator_enrollments.sql',
  '0064_restart_pending_authenticator_enrollment.sql',
  '0065_add_authenticator_recovery_controls.sql',
  '0066_serialize_mfa_verification_attempts.sql',
];
const US029_FUNCTIONS = [
  'begin_authenticator_enrollment',
  'restart_authenticator_enrollment',
  'activate_authenticator_enrollment',
  'begin_authenticator_replacement',
  'activate_authenticator_replacement',
  'disable_authenticator',
  'replace_authenticator_recovery_codes',
  'reserve_mfa_verification_attempt',
];
const RECOVERY_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){2}$/;

async function applyChain(db: PGlite, supabaseDefaults: boolean) {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  `);
  if (supabaseDefaults) {
    await db.exec(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    `);
  }
  for (const file of CHAIN) await db.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
}

const ACCOUNTS = {
  partA: { id: '10000000-0000-4000-8000-0000000000a1', uid: 'fb-part-a', role: 'PART' },
  partB: { id: '10000000-0000-4000-8000-0000000000b1', uid: 'fb-part-b', role: 'PART' },
  adminA: { id: '10000000-0000-4000-8000-0000000000a2', uid: 'fb-admin-a', role: 'ADMIN' },
  adminB: { id: '10000000-0000-4000-8000-0000000000b2', uid: 'fb-admin-b', role: 'ADMIN' },
  unverified: { id: '10000000-0000-4000-8000-0000000000c1', uid: 'fb-unverified', role: 'PART' },
} as const;
type AccountName = keyof typeof ACCOUNTS;
const RANDOM_UUID = '99999999-9999-4999-8999-999999999999';

describe('US-029 authenticator setup, failure, and activation — full migration chain (#272)', () => {
  let db: PGlite;
  let claims: Record<string, Record<string, unknown>>;
  let tokens: Map<string, { name: AccountName; authTime: number; roleOverride?: string }>;
  let sentCodes: string[];
  let tokenSeq = 0;
  let app: typeof import('../app.js').app;

  const sql = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await db.query<T>(text, params)).rows;

  beforeAll(async () => {
    process.env.TOTP_ENCRYPTION_KEY_BASE64 = Buffer.alloc(32, 29).toString('base64');
    process.env.TOTP_ENCRYPTION_KEY_VERSION = 'v1';
    db = new PGlite();
    await applyChain(db, false);
    for (const [name, a] of Object.entries(ACCOUNTS)) {
      await db.query(
        `INSERT INTO participants (id, firebase_uid, email, full_name, role, is_verified)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [a.id, a.uid, `${a.uid}@example.com`, name, a.role, name !== 'unverified']
      );
    }
    holder.client = createPgliteSupabaseClient(db);
    ({ app } = await import('../app.js'));
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now()); // fake clock starts at real time; only moved forward
    _resetRateLimiter();
    await db.exec(`
      DROP TRIGGER IF EXISTS zz_fail_activation ON authenticator_enrollments;
      DROP TRIGGER IF EXISTS zz_fail_recovery_insert ON authenticator_recovery_codes;
      DELETE FROM authenticator_recovery_codes;
      DELETE FROM authenticator_enrollments;
      DELETE FROM mfa_attempts;
      DELETE FROM mfa_challenges;
      UPDATE participants SET
        is_deactivated = FALSE, deactivated_at = NULL, deactivated_by = NULL, deactivation_reason = NULL,
        is_suspended = FALSE, suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL;
    `);
    // A fresh adapter per test models a reconstructed repository/request context.
    holder.client = createPgliteSupabaseClient(db);
    claims = {};
    for (const a of Object.values(ACCOUNTS)) claims[a.uid] = { role: a.role };
    tokens = new Map();
    sentCodes = [];
    _setMfaOtpEmailSender(async (_email: string, code: string) => {
      sentCodes.push(code);
    });
    mockGetUser.mockImplementation(async (uid: string) => ({ uid, customClaims: { ...claims[uid] } }));
    mockSetCustomUserClaims.mockImplementation(async (uid: string, next: Record<string, unknown>) => {
      claims[uid] = { ...next };
    });
    mockVerifyIdToken.mockImplementation(async (token: string) => {
      const entry = tokens.get(token);
      if (!entry) throw Object.assign(new Error('Firebase ID token has invalid signature'), { code: 'auth/argument-error' });
      const a = ACCOUNTS[entry.name];
      return {
        uid: a.uid,
        email: `${a.uid}@example.com`,
        email_verified: entry.name !== 'unverified',
        auth_time: entry.authTime,
        iat: entry.authTime,
        exp: entry.authTime + 3600,
        firebase: { sign_in_provider: 'password', identities: {} },
        ...claims[a.uid],
        ...(entry.roleOverride ? { role: entry.roleOverride } : {}),
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetMfaOtpEmailSender();
  });

  // ------------------------------------------------------------------ helpers
  /** Firebase primary sign-in / reauthentication: a new token with a new auth_time. */
  function signIn(name: AccountName, extra: { roleOverride?: string } = {}) {
    const token = `token-${name}-${++tokenSeq}`;
    tokens.set(token, { name, authTime: Math.floor(Date.now() / 1000), ...extra });
    return token;
  }
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  async function completeEmailOtp(token: string) {
    _resetRateLimiter();
    const issued = await request(app).post('/api/auth/mfa/challenge').set(bearer(token));
    expect(issued.status).toBe(200);
    const verified = await request(app)
      .post('/api/auth/mfa/verify')
      .set(bearer(token))
      .send({ challengeId: issued.body.challengeId, code: sentCodes.at(-1) });
    expect(verified.status).toBe(200);
    return issued.body.challengeId as string;
  }
  async function session(name: AccountName) {
    const token = signIn(name);
    await completeEmailOtp(token);
    return token;
  }
  const api = (token: string) => {
    const base = '/api/auth/mfa/authenticator';
    const post = (p: string, body: object = {}) => request(app).post(`${base}${p}`).set(bearer(token)).send(body);
    return {
      status: () => request(app).get(`${base}/enrollment`).set(bearer(token)),
      begin: () => post('/enrollment'),
      restart: () => post('/enrollment/restart'),
      confirm: (enrollmentId: string, code: string) => post('/enrollment/confirm', { enrollmentId, code }),
      replace: () => post('/replacement'),
      confirmReplacement: (enrollmentId: string, code: string) => post('/replacement/confirm', { enrollmentId, code }),
      disable: () => post('/disable'),
      codeStatus: () => request(app).get(`${base}/recovery-codes`).set(bearer(token)),
      generate: (expectedBatchId: string | null) => post('/recovery-codes', { expectedBatchId }),
    };
  };
  const totp = (secret: string, offsetMs = 0) => _totpCodeForTest(secret, new Date(Date.now() + offsetMs));
  const wrongTotp = (secret: string) => (totp(secret) === '000000' ? '111111' : '000000');

  async function beginSetup(token: string) {
    const response = await api(token).begin();
    expect(response.status).toBe(201);
    return {
      enrollmentId: response.body.authenticator.enrollmentId as string,
      secret: response.body.setup.manualEntryKey as string,
      otpauthUri: response.body.setup.otpauthUri as string,
      expiresAt: Date.parse(response.body.authenticator.expiresAt),
    };
  }
  async function activeAuthenticator(token: string) {
    const setup = await beginSetup(token);
    expect((await api(token).confirm(setup.enrollmentId, totp(setup.secret))).status).toBe(200);
    return setup;
  }
  const rowsFor = (name: AccountName) =>
    sql<{
      id: string;
      status: string;
      secret_ciphertext: string;
      secret_iv: string;
      secret_auth_tag: string;
      encryption_key_version: string;
      pending_expires_at: Date | null;
      activated_at: Date | null;
      retired_at: Date | null;
    }>('SELECT * FROM authenticator_enrollments WHERE participant_id = $1 ORDER BY created_at, id', [ACCOUNTS[name].id]);
  /** created_at can tie within PGlite's clock resolution, so compare by id or as a multiset. */
  const statusById = async (name: AccountName) =>
    Object.fromEntries((await rowsFor(name)).map((r) => [r.id, r.status]));
  const sortedStatuses = async (name: AccountName) => (await rowsFor(name)).map((r) => r.status).sort();
  const currentCodes = (name: AccountName) =>
    sql<{ batch_id: string; code_verifier: string }>(
      'SELECT batch_id, code_verifier FROM authenticator_recovery_codes WHERE participant_id = $1 AND revoked_at IS NULL',
      [ACCOUNTS[name].id]
    );
  const emailOtpState = async () =>
    JSON.stringify({
      attempts: await sql('SELECT id, participant_id, success, created_at FROM mfa_attempts ORDER BY created_at, id'),
      challenges: await sql('SELECT id, consumed_at, invalidated_at FROM mfa_challenges ORDER BY created_at, id'),
    });
  async function injectActivationFailure() {
    await db.exec(`
      CREATE OR REPLACE FUNCTION zz_fail_activation_fn() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.status = 'Pending' AND NEW.status = 'Active' THEN
          RAISE EXCEPTION 'injected failure: relation authenticator_enrollments trigger zz_fail_activation';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER zz_fail_activation BEFORE UPDATE ON authenticator_enrollments
        FOR EACH ROW EXECUTE FUNCTION zz_fail_activation_fn();
    `);
  }

  // =========================================================== migration chain
  describe('full migration chain and browser-role privileges (real SQL)', () => {
    it('applies 0001→0066 together and keeps every US-029 / #271 object server-only', async () => {
      const chainDb = new PGlite();
      try {
        await applyChain(chainDb, true); // with Supabase-style default grants
        const fns = await chainDb.query<{ proname: string; prosecdef: boolean; proconfig: string[] }>(
          `SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname = ANY($1)`,
          [US029_FUNCTIONS]
        );
        expect(fns.rows.map((f) => f.proname).sort()).toEqual([...US029_FUNCTIONS].sort());
        fns.rows.forEach((f) => {
          expect(f.prosecdef, f.proname).toBe(true);
          expect(f.proconfig, f.proname).toContain('search_path=public');
        });

        for (const role of ['anon', 'authenticated']) {
          await chainDb.exec(`SET ROLE ${role}`);
          try {
            for (const table of ['authenticator_enrollments', 'authenticator_recovery_codes']) {
              await expect(chainDb.query(`SELECT * FROM ${table}`), `${role} ${table}`).rejects.toThrow(/permission denied/i);
            }
            await expect(
              chainDb.query('SELECT * FROM disable_authenticator($1)', [ACCOUNTS.partA.id])
            ).rejects.toThrow(/permission denied for function/i);
            await expect(
              chainDb.query('SELECT * FROM reserve_mfa_verification_attempt($1, NULL, NULL)', [ACCOUNTS.partA.id])
            ).rejects.toThrow(/permission denied for function/i);
            // 0003 relies on RLS with no policies: browser roles see no OTP rows and cannot insert.
            expect((await chainDb.query('SELECT * FROM mfa_challenges')).rows).toEqual([]);
            await expect(
              chainDb.query(`INSERT INTO mfa_attempts (participant_id, success) VALUES ($1, FALSE)`, [ACCOUNTS.partA.id])
            ).rejects.toThrow(/row-level security|permission denied/i);
          } finally {
            await chainDb.exec('RESET ROLE');
          }
        }
      } finally {
        await chainDb.close();
      }
    });
  });

  // ========================================================= first enrollment
  describe('first-time enrollment and activation', () => {
    it.each(['partA', 'adminA'] as const)(
      '%s: begin → encrypted Pending row → wrong code keeps it → valid TOTP activates → secret-free Active status',
      async (name) => {
        const token = await session(name);
        expect((await api(token).status()).body).toEqual({
          authenticator: { status: 'not_enrolled' },
          availableChallengeMethods: ['email_otp'],
          emailOtpFallback: true,
        });

        const begin = await api(token).begin();
        expect(begin.status).toBe(201);
        expect(begin.headers['cache-control']).toBe('no-store');
        const secret = begin.body.setup.manualEntryKey as string;
        const enrollmentId = begin.body.authenticator.enrollmentId as string;
        expect(begin.body.setup.otpauthUri).toMatch(/^otpauth:\/\/totp\/HackMatch/);
        expect(begin.body.availableChallengeMethods).toEqual(['email_otp']);

        const [pending] = await rowsFor(name);
        expect(pending).toMatchObject({ id: enrollmentId, status: 'Pending', encryption_key_version: 'v1', activated_at: null });
        expect(Buffer.from(pending!.secret_iv, 'base64')).toHaveLength(12);
        expect(Buffer.from(pending!.secret_auth_tag, 'base64')).toHaveLength(16);
        expect(JSON.stringify(pending)).not.toContain(secret);

        const pendingStatus = await api(token).status();
        expect(pendingStatus.body.authenticator.status).toBe('pending');
        expect(JSON.stringify(pendingStatus.body)).not.toMatch(new RegExp(`${secret}|otpauth|ciphertext`));

        const wrong = await api(token).confirm(enrollmentId, wrongTotp(secret));
        expect(wrong.status).toBe(401);
        expect(wrong.body.code).toBe('INVALID_AUTHENTICATOR_CODE');
        expect((await rowsFor(name))[0]!.status).toBe('Pending');

        const ok = await api(token).confirm(enrollmentId, totp(secret));
        expect(ok.status).toBe(200);
        expect(ok.body).toEqual({
          authenticator: { status: 'active', activatedAt: expect.any(String) },
          availableChallengeMethods: ['authenticator_totp', 'email_otp'],
          emailOtpFallback: true,
        });

        const [active] = await rowsFor(name);
        expect(active).toMatchObject({ status: 'Active', pending_expires_at: null, retired_at: null });
        expect(active!.activated_at).toBeInstanceOf(Date);
        const status = await api(token).status();
        expect(status.body).toEqual({
          authenticator: { status: 'active', activatedAt: expect.any(String) },
          availableChallengeMethods: ['authenticator_totp', 'email_otp'],
          emailOtpFallback: true,
        });
        expect((await api(token).begin()).body.code).toBe('AUTHENTICATOR_ALREADY_ACTIVE');
        expect((await api(token).confirm(enrollmentId, totp(secret))).body.code).toBe('AUTHENTICATOR_ALREADY_ACTIVE');
      }
    );

    it('accepts the adjacent 30-second step, rejects two steps back, and requires exactly six digits', async () => {
      const token = await session('partA');
      const setup = await beginSetup(token);
      for (const code of ['12345', '1234567', '12ab56', ' 12 34 ']) {
        const response = await api(token).confirm(setup.enrollmentId, code);
        expect(response.status, code).toBe(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
        expect(JSON.stringify(response.body)).not.toContain(code.trim() || 'x');
      }
      expect((await api(token).confirm(setup.enrollmentId, totp(setup.secret, -60_000))).status).toBe(401);
      expect((await api(token).confirm(setup.enrollmentId, totp(setup.secret, -30_000))).status).toBe(200);
    });
  });

  // ===================================================== persistence & restart
  describe('persistence, refresh, and restart', () => {
    it('Pending survives a rebuilt context, never re-exposes setup, and restart makes the old id unusable', async () => {
      const token = await session('partA');
      const first = await beginSetup(token);

      holder.client = createPgliteSupabaseClient(db); // reconstructed repository / request context
      const refreshed = await api(token).status();
      expect(refreshed.body.authenticator).toEqual({ status: 'pending', expiresAt: expect.any(String) });
      expect(JSON.stringify(refreshed.body)).not.toContain(first.secret);

      const restarted = await api(token).restart();
      expect(restarted.status).toBe(201);
      const second = {
        enrollmentId: restarted.body.authenticator.enrollmentId as string,
        secret: restarted.body.setup.manualEntryKey as string,
      };
      expect(second.enrollmentId).not.toBe(first.enrollmentId);
      expect(second.secret).not.toBe(first.secret);
      expect(await statusById('partA')).toEqual({
        [first.enrollmentId]: 'Canceled',
        [second.enrollmentId]: 'Pending',
      });
      const ciphertexts = (await rowsFor('partA')).map((r) => r.secret_ciphertext);
      expect(new Set(ciphertexts).size).toBe(2);

      const stale = await api(token).confirm(first.enrollmentId, totp(first.secret));
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('AUTHENTICATOR_ENROLLMENT_STALE');
      expect((await api(token).confirm(second.enrollmentId, totp(second.secret))).status).toBe(200);
      expect(await statusById('partA')).toEqual({
        [first.enrollmentId]: 'Canceled',
        [second.enrollmentId]: 'Active',
      });
    });

    it('restart is refused without a pending setup or with an active authenticator', async () => {
      const token = await session('adminA');
      expect((await api(token).restart()).body.code).toBe('AUTHENTICATOR_ENROLLMENT_NOT_PENDING');
      await activeAuthenticator(token);
      expect((await api(token).restart()).body.code).toBe('AUTHENTICATOR_ALREADY_ACTIVE');
      expect((await rowsFor('adminA')).map((r) => r.status)).toEqual(['Active']);
    });
  });

  // ==================================================== invalid confirmations
  describe('setup failures never activate and never disturb an existing authenticator', () => {
    it('missing, foreign, canceled, and already-active ids fail safely and identically where they must', async () => {
      const owner = await session('partA');
      const victim = await session('partB');
      const victimSetup = await beginSetup(victim);

      const missing = await api(owner).confirm(RANDOM_UUID, '123456');
      const foreign = await api(owner).confirm(victimSetup.enrollmentId, totp(victimSetup.secret));
      expect(missing.status).toBe(409);
      expect(foreign.body).toEqual(missing.body); // no enumeration signal
      expect((await rowsFor('partB'))[0]!.status).toBe('Pending');
      expect(await rowsFor('partA')).toEqual([]);

      const first = await beginSetup(owner);
      await api(owner).restart();
      const canceled = await api(owner).confirm(first.enrollmentId, totp(first.secret));
      expect(canceled.body.code).toBe('AUTHENTICATOR_ENROLLMENT_STALE');

      for (const body of [missing.body, foreign.body, canceled.body]) {
        expect(JSON.stringify(body)).not.toMatch(/TOTP_|relation|ciphertext|secret|stack/i);
      }
      expect((await api(victim).confirm(victimSetup.enrollmentId, totp(victimSetup.secret))).status).toBe(200);
    });

    it('enrollment expiry: valid 1 ms before, expired exactly at expiry and after, restart recovers', async () => {
      const early = await session('partA');
      const a = await beginSetup(early);
      vi.setSystemTime(a.expiresAt - 1);
      expect((await api(early).confirm(a.enrollmentId, totp(a.secret))).status).toBe(200);

      vi.setSystemTime(Date.now() + 1000);
      const late = await session('adminA');
      const b = await beginSetup(late);
      vi.setSystemTime(b.expiresAt);
      const atExpiry = await api(late).confirm(b.enrollmentId, totp(b.secret));
      expect(atExpiry.status).toBe(410);
      expect(atExpiry.body.code).toBe('AUTHENTICATOR_ENROLLMENT_EXPIRED');
      // After expiry the original sign-in is also past the 10-minute recent-auth window
      // (enrollment TTL == recent-auth window), so a fresh sign-in sees the same 410.
      vi.setSystemTime(b.expiresAt + 30_000);
      expect((await api(late).confirm(b.enrollmentId, totp(b.secret))).body.code).toBe('REAUTHENTICATION_REQUIRED');
      const relogin = await session('adminA');
      const afterExpiry = await api(relogin).confirm(b.enrollmentId, totp(b.secret));
      expect(afterExpiry.status).toBe(410);
      expect(afterExpiry.body.code).toBe('AUTHENTICATOR_ENROLLMENT_EXPIRED');
      expect((await rowsFor('adminA')).every((r) => r.status !== 'Active')).toBe(true);

      // The expired setup is not offered as pending, and a restart issues fresh material.
      expect((await api(relogin).status()).body.authenticator.status).toBe('not_enrolled');
      const restarted = await api(relogin).restart();
      expect(restarted.status).toBe(201);
      const code = totp(restarted.body.setup.manualEntryKey);
      expect((await api(relogin).confirm(restarted.body.authenticator.enrollmentId, code)).status).toBe(200);
      expect((await api(relogin).confirm(b.enrollmentId, totp(b.secret))).status).toBe(409);
    });
  });

  // ==================================================== atomicity/concurrency
  describe('activation atomicity and concurrency (real SQL)', () => {
    it('a database failure during activation rolls back completely; a retry then activates once', async () => {
      const token = await session('partA');
      const setup = await beginSetup(token);
      await injectActivationFailure();

      const failed = await api(token).confirm(setup.enrollmentId, totp(setup.secret));
      expect(failed.status).toBe(503);
      expect(failed.body.code).toBe('AUTHENTICATOR_ENROLLMENT_UNAVAILABLE');
      expect(JSON.stringify(failed.body)).not.toMatch(/injected|relation|trigger|authenticator_enrollments/);
      const [row] = await rowsFor('partA');
      expect(row).toMatchObject({ status: 'Pending', activated_at: null, retired_at: null });

      await db.exec('DROP TRIGGER zz_fail_activation ON authenticator_enrollments');
      expect((await api(token).confirm(setup.enrollmentId, totp(setup.secret))).status).toBe(200);
      expect((await rowsFor('partA')).map((r) => r.status)).toEqual(['Active']);
    });

    it('concurrent confirmations of one pending enrollment activate exactly once', async () => {
      const token = await session('adminA');
      const setup = await beginSetup(token);
      const code = totp(setup.secret);
      const responses = await Promise.all(
        Array.from({ length: 4 }, () => api(token).confirm(setup.enrollmentId, code))
      );
      expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
      responses
        .filter((r) => r.status !== 200)
        .forEach((r) => expect(['AUTHENTICATOR_ALREADY_ACTIVE', 'AUTHENTICATOR_ENROLLMENT_STALE']).toContain(r.body.code));
      const rows = await rowsFor('adminA');
      expect(rows.filter((r) => r.status === 'Active')).toHaveLength(1);
      expect(rows[0]).toMatchObject({ pending_expires_at: null, retired_at: null });
    });
  });

  // ========================================== replacement + recovery (PART)
  describe('PART: recovery codes and replacement rotation', () => {
    it('generates, protects, regenerates, and rotates recovery codes only on a confirmed replacement', async () => {
      const token = await session('partA');
      const original = await activeAuthenticator(token);

      // Initial generation: 10 well-formed codes, shown once, stored as verifiers only.
      const generated = await api(token).generate(null);
      expect(generated.status).toBe(201);
      const firstSet = generated.body.recoveryCodes as { batchId: string; codes: string[] };
      expect(firstSet.codes).toHaveLength(10);
      firstSet.codes.forEach((c) => expect(c).toMatch(RECOVERY_CODE));
      expect(new Set(firstSet.codes).size).toBe(10);
      const stored = await currentCodes('partA');
      expect(stored).toHaveLength(10);
      const dump = JSON.stringify(await sql('SELECT * FROM authenticator_recovery_codes'));
      firstSet.codes.forEach((c) => {
        expect(dump).not.toContain(c);
        expect(dump).not.toContain(c.replace(/-/g, ''));
      });
      const status = await api(token).codeStatus();
      expect(status.body.recoveryCodes).toEqual({
        status: 'generated',
        batchId: firstSet.batchId,
        total: 10,
        remaining: 10,
        generatedAt: expect.any(String),
      });

      // Stale regeneration is refused and changes nothing.
      expect((await api(token).generate(null)).body.code).toBe('RECOVERY_CODES_STALE');
      expect(new Set((await currentCodes('partA')).map((c) => c.batch_id))).toEqual(new Set([firstSet.batchId]));

      // Failed regeneration (DB failure after revoke) rolls back and preserves the set.
      await db.exec(`
        CREATE OR REPLACE FUNCTION zz_fail_recovery_fn() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'injected failure inserting authenticator_recovery_codes'; END $$;
        CREATE TRIGGER zz_fail_recovery_insert BEFORE INSERT ON authenticator_recovery_codes
          FOR EACH ROW EXECUTE FUNCTION zz_fail_recovery_fn();
      `);
      const failedRegen = await api(token).generate(firstSet.batchId);
      expect(failedRegen.status).toBe(503);
      expect(failedRegen.body.code).toBe('RECOVERY_CODES_UNAVAILABLE');
      expect(JSON.stringify(failedRegen.body)).not.toMatch(/injected|authenticator_recovery_codes/);
      expect(new Set((await currentCodes('partA')).map((c) => c.batch_id))).toEqual(new Set([firstSet.batchId]));
      await db.exec('DROP TRIGGER zz_fail_recovery_insert ON authenticator_recovery_codes');

      // Successful regeneration revokes the old set.
      const regenerated = await api(token).generate(firstSet.batchId);
      const secondSet = regenerated.body.recoveryCodes as { batchId: string; codes: string[] };
      expect(regenerated.status).toBe(201);
      expect(new Set((await currentCodes('partA')).map((c) => c.batch_id))).toEqual(new Set([secondSet.batchId]));

      // Replacement Pending: old factor and its codes stay valid.
      const replacement = await api(token).replace();
      expect(replacement.status).toBe(201);
      expect(replacement.body.currentAuthenticator).toEqual({ status: 'active' });
      const newSecret = replacement.body.setup.manualEntryKey as string;
      const replacementId = replacement.body.authenticator.enrollmentId as string;
      const pendingState = { [original.enrollmentId]: 'Active', [replacementId]: 'Pending' };
      expect(await statusById('partA')).toEqual(pendingState);
      expect((await currentCodes('partA')).every((c) => c.batch_id === secondSet.batchId)).toBe(true);

      // Wrong TOTP, the original confirm path, and a DB failure all preserve old factor + codes.
      expect((await api(token).confirmReplacement(replacementId, wrongTotp(newSecret))).status).toBe(401);
      const legacy = await api(token).confirm(replacementId, totp(newSecret));
      expect(legacy.status).toBe(409);
      expect(legacy.body.code).toBe('AUTHENTICATOR_REPLACEMENT_CONFIRMATION_REQUIRED');
      await injectActivationFailure();
      const dbFailure = await api(token).confirmReplacement(replacementId, totp(newSecret));
      expect(dbFailure.status).toBe(503);
      expect(JSON.stringify(dbFailure.body)).not.toMatch(/recoveryCodes|codes|injected/);
      await db.exec('DROP TRIGGER zz_fail_activation ON authenticator_enrollments');
      expect(await statusById('partA')).toEqual(pendingState); // retire was rolled back too
      expect((await currentCodes('partA')).every((c) => c.batch_id === secondSet.batchId)).toBe(true);

      // Confirmed replacement: old Retired, new Active, old set revoked, fresh set returned once.
      const confirmed = await api(token).confirmReplacement(replacementId, totp(newSecret));
      expect(confirmed.status).toBe(200);
      const freshSet = confirmed.body.recoveryCodes as { batchId: string; codes: string[] };
      expect(freshSet.codes).toHaveLength(10);
      expect(freshSet.batchId).not.toBe(secondSet.batchId);
      expect(await statusById('partA')).toEqual({
        [original.enrollmentId]: 'Retired',
        [replacementId]: 'Active',
      });
      const current = await currentCodes('partA');
      expect(current).toHaveLength(10);
      expect(new Set(current.map((c) => c.batch_id))).toEqual(new Set([freshSet.batchId]));
      expect(JSON.stringify(await api(token).codeStatus())).not.toMatch(/"codes"/);
      expect((await api(token).confirmReplacement(replacementId, totp(newSecret))).body.code).toBe('AUTHENTICATOR_ALREADY_ACTIVE');
    });

    it('cancel (restart), expiry, and concurrent confirmation of a replacement keep exactly one factor and one set', async () => {
      const token = await session('partA');
      await activeAuthenticator(token);
      const set = (await api(token).generate(null)).body.recoveryCodes.batchId as string;

      const first = await api(token).replace();
      const second = await api(token).replace(); // restart replacement
      expect(await sortedStatuses('partA')).toEqual(['Active', 'Canceled', 'Pending']);
      expect((await statusById('partA'))[first.body.authenticator.enrollmentId]).toBe('Canceled');
      const canceled = await api(token).confirmReplacement(
        first.body.authenticator.enrollmentId,
        totp(first.body.setup.manualEntryKey)
      );
      expect(canceled.body.code).toBe('AUTHENTICATOR_ENROLLMENT_STALE');

      vi.setSystemTime(Date.parse(second.body.authenticator.expiresAt));
      const expired = await api(token).confirmReplacement(
        second.body.authenticator.enrollmentId,
        totp(second.body.setup.manualEntryKey)
      );
      expect(expired.status).toBe(410);
      expect((await currentCodes('partA')).every((c) => c.batch_id === set)).toBe(true);

      const fresh = await session('partA');
      const third = await api(fresh).replace();
      const code = totp(third.body.setup.manualEntryKey);
      const responses = await Promise.all(
        Array.from({ length: 3 }, () => api(fresh).confirmReplacement(third.body.authenticator.enrollmentId, code))
      );
      expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
      const rows = await rowsFor('partA');
      expect(rows.filter((r) => r.status === 'Active')).toHaveLength(1);
      expect(rows.filter((r) => r.status === 'Retired')).toHaveLength(1);
      const current = await currentCodes('partA');
      expect(current).toHaveLength(10);
      expect(new Set(current.map((c) => c.batch_id)).size).toBe(1);
      const batches = await sql<{ n: number }>(
        'SELECT COUNT(DISTINCT batch_id)::int AS n FROM authenticator_recovery_codes WHERE participant_id = $1',
        [ACCOUNTS.partA.id]
      );
      expect(batches[0]!.n).toBe(2); // original + exactly one rotation, no duplicate set
    });
  });

  // ========================================================== ADMIN + disable
  describe('ADMIN: activation and disable', () => {
    it('disables an active factor, cancels pending replacement, revokes codes, and keeps email OTP', async () => {
      const token = await session('adminA');
      await activeAuthenticator(token);
      await api(token).generate(null);
      await api(token).replace();

      const disabled = await api(token).disable();
      expect(disabled.status).toBe(200);
      expect(disabled.body).toMatchObject({
        authenticator: { status: 'not_enrolled' },
        availableChallengeMethods: ['email_otp'],
        emailOtpFallback: true,
      });
      expect(await sortedStatuses('adminA')).toEqual(['Canceled', 'Retired']);
      expect(await currentCodes('adminA')).toEqual([]);
      expect(
        (await sql('SELECT id FROM authenticator_recovery_codes WHERE participant_id = $1', [ACCOUNTS.adminA.id])).length
      ).toBe(10); // history retained, revoked

      for (const response of [await api(token).disable(), await api(token).replace(), await api(token).generate(null)]) {
        expect(response.status).toBe(409);
        expect(response.body.code).toBe('AUTHENTICATOR_NOT_ACTIVE');
      }
      // Email OTP still works on a new sign-in, and a fresh enrollment is possible.
      vi.setSystemTime(Date.now() + 1000);
      const relogin = await session('adminA');
      expect((await api(relogin).status()).body.availableChallengeMethods).toEqual(['email_otp']);
      await activeAuthenticator(relogin);
    });
  });

  // ======================================================= reauthentication
  describe('reauthentication: stale sign-in → REAUTH → MFA_REQUIRED → real email OTP → one retry', () => {
    type Op = 'begin' | 'restart' | 'replace' | 'regenerate' | 'disable';
    const cases: Array<[Op, AccountName, number]> = [
      ['begin', 'partA', 201],
      ['restart', 'adminA', 201],
      ['replace', 'partA', 201],
      ['regenerate', 'adminA', 201],
      ['disable', 'partA', 200],
    ];

    it.each(cases)('%s (%s)', async (op, name, expectedStatus) => {
      const first = await session(name);
      let batch: string | null = null;
      if (op === 'restart') await beginSetup(first);
      if (op === 'replace' || op === 'regenerate' || op === 'disable') await activeAuthenticator(first);
      if (op === 'regenerate') batch = (await api(first).generate(null)).body.recoveryCodes.batchId;
      const run = (token: string) =>
        op === 'begin'
          ? api(token).begin()
          : op === 'restart'
            ? api(token).restart()
            : op === 'replace'
              ? api(token).replace()
              : op === 'regenerate'
                ? api(token).generate(batch)
                : api(token).disable();

      const authTime = tokens.get(first)!.authTime;
      vi.setSystemTime((authTime + 601) * 1000); // 1 s past the 10-minute window
      const stale = await run(first);
      expect(stale.status).toBe(401);
      expect(stale.body.code).toBe('REAUTHENTICATION_REQUIRED');

      const reauth = signIn(name); // mocked Firebase primary reauth: new auth_time
      expect(tokens.get(reauth)!.authTime).toBeGreaterThan(authTime);
      const needsMfa = await run(reauth);
      expect(needsMfa.status).toBe(403);
      expect(needsMfa.body.code).toBe('MFA_REQUIRED');

      await completeEmailOtp(reauth); // real 0003/0066 storage
      expect(claims[ACCOUNTS[name].uid]![MFA_CLAIM]).toBe(tokens.get(reauth)!.authTime);
      const retried = await run(reauth); // the original action, retried once
      expect(retried.status).toBe(expectedStatus);
    });

    it('the 10-minute recent-auth window is inclusive at exactly 600 s', async () => {
      const token = await session('partA');
      const authTime = tokens.get(token)!.authTime;
      vi.setSystemTime((authTime + 600) * 1000);
      expect((await api(token).status()).status).toBe(200);
      vi.setSystemTime((authTime + 601) * 1000);
      expect((await api(token).status()).body.code).toBe('REAUTHENTICATION_REQUIRED');
    });

    it('a concurrent wrong-code burst during reauthentication is held to the same five-attempt lock', async () => {
      const first = await session('adminA');
      await activeAuthenticator(first);
      vi.setSystemTime((tokens.get(first)!.authTime + 601) * 1000);
      const reauth = signIn('adminA');
      _resetRateLimiter();
      const issued = await request(app).post('/api/auth/mfa/challenge').set(bearer(reauth));
      const challengeId = issued.body.challengeId as string;
      const code = sentCodes.at(-1)!;
      const wrong = (n: number) => String(100000 + n === Number(code) ? 100001 + n : 100000 + n);
      for (let i = 0; i < 4; i += 1) {
        expect((await request(app).post('/api/auth/mfa/verify').set(bearer(reauth)).send({ challengeId, code: wrong(i) })).status).toBe(401);
      }
      const burst = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          request(app).post('/api/auth/mfa/verify').set(bearer(reauth)).send({ challengeId, code: wrong(10 + i) })
        )
      );
      expect(burst.every((r) => r.status === 423)).toBe(true);
      const failures = await sql<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM mfa_attempts WHERE participant_id = $1 AND success = FALSE',
        [ACCOUNTS.adminA.id]
      );
      expect(failures[0]!.n).toBe(5); // real-SQL reservations: exactly five counted
      expect((await request(app).post('/api/auth/mfa/verify').set(bearer(reauth)).send({ challengeId, code })).status).toBe(423);
      expect((await api(reauth).disable()).body.code).toBe('MFA_REQUIRED');
      expect((await rowsFor('adminA')).map((r) => r.status)).toEqual(['Active']);
    });
  });

  // ===================================================== email OTP coexistence
  describe('email OTP coexistence (real SQL)', () => {
    it('no authenticator or recovery operation touches email OTP rows; the 5th email failure still locks', async () => {
      const token = await session('partA');
      const login = signIn('partA');
      _resetRateLimiter();
      const issued = await request(app).post('/api/auth/mfa/challenge').set(bearer(login));
      const challengeId = issued.body.challengeId as string;
      const code = sentCodes.at(-1)!;
      const bad = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 4; i += 1) {
        await request(app).post('/api/auth/mfa/verify').set(bearer(login)).send({ challengeId, code: bad });
      }
      const before = await emailOtpState();

      const setup = await beginSetup(token);
      for (let i = 0; i < 3; i += 1) await api(token).confirm(setup.enrollmentId, wrongTotp(setup.secret));
      await api(token).confirm(setup.enrollmentId, totp(setup.secret));
      const batch = (await api(token).generate(null)).body.recoveryCodes.batchId;
      await api(token).generate(batch);
      const replacement = await api(token).replace();
      await api(token).confirmReplacement(replacement.body.authenticator.enrollmentId, totp(replacement.body.setup.manualEntryKey));
      await api(token).disable();

      expect(await emailOtpState()).toBe(before);
      const fifth = await request(app).post('/api/auth/mfa/verify').set(bearer(login)).send({ challengeId, code: bad });
      expect(fifth.status).toBe(423);
    });
  });

  // ================================================ authorization & isolation
  describe('unauthorized access and cross-account isolation (real SQL)', () => {
    const routes: Array<[string, 'get' | 'post', object?]> = [
      ['/enrollment', 'get'],
      ['/enrollment', 'post', {}],
      ['/enrollment/restart', 'post', {}],
      ['/enrollment/confirm', 'post', { enrollmentId: RANDOM_UUID, code: '123456' }],
      ['/replacement', 'post', {}],
      ['/replacement/confirm', 'post', { enrollmentId: RANDOM_UUID, code: '123456' }],
      ['/disable', 'post', {}],
      ['/recovery-codes', 'get'],
      ['/recovery-codes', 'post', { expectedBatchId: null }],
    ];
    const call = (token: string | null, [p, method, body]: (typeof routes)[number]) => {
      const req = request(app)[method](`/api/auth/mfa/authenticator${p}`);
      if (token) req.set(bearer(token));
      return method === 'post' ? req.send(body) : req;
    };

    it('rejects unauthenticated, invalid-token, unsupported-role, unverified, suspended, and deactivated callers on every route', async () => {
      const unsupported = signIn('partA', { roleOverride: 'SUPERUSER' });
      claims[ACCOUNTS.partA.uid] = { role: 'PART', [MFA_CLAIM]: tokens.get(unsupported)!.authTime };
      const unverified = signIn('unverified');
      claims[ACCOUNTS.unverified.uid] = { role: 'PART', [MFA_CLAIM]: tokens.get(unverified)!.authTime }; // even a forged MFA claim
      const suspended = await session('partB');
      await db.query(
        `UPDATE participants SET is_suspended = TRUE, suspended_at = NOW(), suspension_reason = 'Policy review'
         WHERE id = $1`,
        [ACCOUNTS.partB.id]
      );
      const deactivated = await session('adminB');
      await db.query(
        `UPDATE participants SET
           is_suspended = TRUE, suspended_at = NOW(), suspension_reason = 'Account closed',
           is_deactivated = TRUE, deactivated_at = NOW(), deactivation_reason = 'Account closed'
         WHERE id = $1`,
        [ACCOUNTS.adminB.id]
      );

      for (const route of routes) {
        const label = `${route[1]} ${route[0]}`;
        expect((await call(null, route)).status, label).toBe(401);
        expect((await call('not-a-real-token', route)).status, label).toBe(401);
        expect((await call(unsupported, route)).body.code, label).toBe('INVALID_ROLE_CLAIM');
        expect((await call(unverified, route)).body.code, label).toBe('EMAIL_NOT_VERIFIED');
        expect((await call(suspended, route)).body.code, label).toBe('ACCOUNT_SUSPENDED');
        expect((await call(deactivated, route)).body.code, label).toBe('ACCOUNT_SUSPENDED');
      }
      expect(await sql('SELECT id FROM authenticator_enrollments')).toEqual([]);
      expect(await sql('SELECT id FROM authenticator_recovery_codes')).toEqual([]);
    });

    it.each([
      ['partA', 'partB'],
      ['partA', 'adminA'],
      ['adminA', 'partA'],
      ['adminA', 'adminB'],
    ] as const)('%s cannot read or use %s’s enrollment or recovery batch', async (attackerName, victimName) => {
      const victim = await session(victimName);
      const attacker = await session(attackerName);
      const victimSetup = await beginSetup(victim);
      const foreignConfirm = await api(attacker).confirm(victimSetup.enrollmentId, totp(victimSetup.secret));
      const randomConfirm = await api(attacker).confirm(RANDOM_UUID, totp(victimSetup.secret));
      expect(foreignConfirm.body).toEqual(randomConfirm.body);
      await api(victim).confirm(victimSetup.enrollmentId, totp(victimSetup.secret));
      const victimBatch = (await api(victim).generate(null)).body.recoveryCodes.batchId as string;

      await activeAuthenticator(attacker);
      const foreignBatch = await api(attacker).generate(victimBatch);
      const randomBatch = await api(attacker).generate(RANDOM_UUID);
      expect(foreignBatch.status).toBe(409);
      expect(foreignBatch.body).toEqual(randomBatch.body);
      const attackerView = JSON.stringify([(await api(attacker).status()).body, (await api(attacker).codeStatus()).body]);
      expect(attackerView).not.toContain(victimBatch);
      expect(attackerView).not.toContain(victimSetup.enrollmentId);
      expect((await currentCodes(victimName)).every((c) => c.batch_id === victimBatch)).toBe(true);
    });
  });

  // ================================================================ privacy
  describe('privacy across the full lifecycle (real SQL + real request logger)', () => {
    it('stores no plaintext secret or raw code and logs no secret, code, OTP, or token', async () => {
      const lines: string[] = [];
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
        vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
          lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
        })
      );
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const secrets: string[] = [];
      try {
        const token = await session('partA');
        const setup = await activeAuthenticator(token);
        secrets.push(setup.secret, setup.otpauthUri, totp(setup.secret));
        const codes = (await api(token).generate(null)).body.recoveryCodes.codes as string[];
        secrets.push(...codes);
        const replacement = await api(token).replace();
        secrets.push(replacement.body.setup.manualEntryKey, replacement.body.setup.otpauthUri);
        const rotated = await api(token).confirmReplacement(
          replacement.body.authenticator.enrollmentId,
          totp(replacement.body.setup.manualEntryKey)
        );
        secrets.push(...(rotated.body.recoveryCodes.codes as string[]));
        await request(app)
          .post('/api/auth/mfa/authenticator/enrollment/confirm')
          .set(bearer(token))
          .set('Content-Type', 'application/json')
          .send(`{"enrollmentId":"x","code":"${totp(setup.secret)}",`);
        secrets.push(...sentCodes, token);
        await injectActivationFailure();
        const failure = await api(token).replace();
        const failureBody = JSON.stringify(failure.body);
        expect(failureBody).not.toMatch(/injected|trigger|relation/);
      } finally {
        process.env.NODE_ENV = originalEnv;
        spies.forEach((s) => s.mockRestore());
      }

      const logs = lines.join('\n');
      expect(logs).toContain('/api/auth/mfa/authenticator');
      const database = JSON.stringify({
        enrollments: await sql('SELECT * FROM authenticator_enrollments'),
        codes: await sql('SELECT * FROM authenticator_recovery_codes'),
        challenges: await sql('SELECT * FROM mfa_challenges'),
        attempts: await sql('SELECT * FROM mfa_attempts'),
      });
      for (const secret of secrets) {
        expect(logs).not.toContain(secret);
        expect(database).not.toContain(secret);
      }
      expect(database).not.toContain('otpauth://');
    });
  });
});

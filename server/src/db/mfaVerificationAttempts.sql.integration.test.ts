import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

/**
 * US-029 / #271 real-SQL coverage for 0066 reserve_mfa_verification_attempt.
 *
 * Layer: PGlite (real PostgreSQL). PGlite is a single connection, so it proves
 * the function's ordering, defaults, validation, and grants — not cross-session
 * advisory-lock contention, which PostgreSQL guarantees by pg_advisory_xact_lock.
 * The race-safety of the full verify flow is covered at the route layer.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, '../../../supabase/migrations');
const sqlOf = (file: string): string => fs.readFileSync(path.join(DIR, file), 'utf8');

const OWNER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';

let db: PGlite;
let challengeId: string;

const reserve = (participant: string | null, challenge: string | null = challengeId, ip: string | null = '203.0.113.7') =>
  db.query<{ attempt_id: string; attempted_at: Date }>(
    'SELECT * FROM reserve_mfa_verification_attempt($1, $2, $3)',
    [participant, challenge, ip]
  );

describe('reserve_mfa_verification_attempt (0066, #271)', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    `);
    await db.exec(sqlOf('0001_create_participants_table.sql'));
    await db.exec(sqlOf('0003_create_mfa_records.sql'));
    await db.exec(sqlOf('0066_serialize_mfa_verification_attempts.sql'));
    await db.query(
      `INSERT INTO participants (id, firebase_uid, email, full_name, role, is_verified)
       VALUES ($1, 'fb-owner', 'owner@example.test', 'Owner', 'PART', TRUE),
              ($2, 'fb-other', 'other@example.test', 'Other', 'ADMIN', TRUE)`,
      [OWNER, OTHER]
    );
    const challenge = await db.query<{ id: string }>(
      `INSERT INTO mfa_challenges (participant_id, otp_hash, expires_at)
       VALUES ($1, 'hash', NOW() + INTERVAL '10 minutes') RETURNING id`,
      [OWNER]
    );
    challengeId = challenge.rows[0]!.id;
  }, 60_000);

  afterEach(async () => {
    await db.query('DELETE FROM mfa_attempts');
  });

  afterAll(async () => db?.close());

  it('records a reservation as a failed attempt, with no code or hash stored', async () => {
    const result = await reserve(OWNER);
    expect(result.rows).toHaveLength(1);
    const rows = await db.query<Record<string, unknown>>('SELECT * FROM mfa_attempts');
    expect(rows.rows).toEqual([
      expect.objectContaining({
        id: result.rows[0]!.attempt_id,
        participant_id: OWNER,
        challenge_id: challengeId,
        success: false,
        ip_address: '203.0.113.7',
      }),
    ]);
    expect(Object.keys(rows.rows[0]!)).not.toEqual(expect.arrayContaining(['otp', 'code', 'otp_hash']));
  });

  it('stamps reservations with strictly increasing, tie-free timestamps in call order', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => reserve(OWNER)));
    const ids = results.map((r) => r.rows[0]!.attempt_id);
    const ordered = await db.query<{ id: string }>(
      'SELECT id FROM mfa_attempts WHERE participant_id = $1 ORDER BY created_at ASC',
      [OWNER]
    );
    expect(ordered.rows.map((r) => r.id)).toEqual(ids);
    const strict = await db.query<{ ok: boolean; distinct_times: number }>(
      `SELECT bool_and(created_at < next_at) AS ok,
              (SELECT COUNT(DISTINCT created_at)::int FROM mfa_attempts WHERE participant_id = $1) AS distinct_times
       FROM (
         SELECT created_at, LEAD(created_at) OVER (ORDER BY created_at) AS next_at
         FROM mfa_attempts WHERE participant_id = $1
       ) AS ordered WHERE next_at IS NOT NULL`,
      [OWNER]
    );
    expect(strict.rows[0]).toEqual({ ok: true, distinct_times: 25 });
  });

  it('never stamps a reservation at or before an existing attempt, even one recorded in the future', async () => {
    await db.query(
      `INSERT INTO mfa_attempts (participant_id, challenge_id, success, created_at)
       VALUES ($1, $2, FALSE, NOW() + INTERVAL '1 minute')`,
      [OWNER, challengeId]
    );
    const reserved = await reserve(OWNER);
    const newest = await db.query<{ id: string }>(
      'SELECT id FROM mfa_attempts WHERE participant_id = $1 ORDER BY created_at DESC LIMIT 1',
      [OWNER]
    );
    expect(newest.rows[0]!.id).toBe(reserved.rows[0]!.attempt_id);
  });

  it('is owner-scoped, accepts a null challenge, truncates the IP, and rejects a null participant', async () => {
    await reserve(OTHER, null, 'x'.repeat(80));
    const row = await db.query<{ participant_id: string; challenge_id: string | null; ip_address: string }>(
      'SELECT participant_id, challenge_id, ip_address FROM mfa_attempts'
    );
    expect(row.rows[0]).toEqual({ participant_id: OTHER, challenge_id: null, ip_address: 'x'.repeat(45) });
    await expect(reserve(null)).rejects.toThrow(/MFA_ATTEMPT_VALIDATION_ERROR/);
  });

  it('cannot be executed by browser-facing roles even with Supabase default grants', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      try {
        await expect(reserve(OWNER)).rejects.toThrow(/permission denied for function/i);
      } finally {
        await db.exec('RESET ROLE');
      }
    }
    await db.exec('SET ROLE service_role');
    try {
      await expect(reserve(OWNER)).resolves.toBeTruthy();
    } finally {
      await db.exec('RESET ROLE');
    }
  });

  it('is SECURITY DEFINER with a pinned search_path, idempotent, and owns migration number 0066', async () => {
    const fn = await db.query<{ prosecdef: boolean; proconfig: string[] }>(
      `SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'reserve_mfa_verification_attempt'`
    );
    expect(fn.rows[0]!.prosecdef).toBe(true);
    expect(fn.rows[0]!.proconfig).toContain('search_path=public');
    await expect(db.exec(sqlOf('0066_serialize_mfa_verification_attempts.sql'))).resolves.not.toThrow();
    expect(fs.readdirSync(DIR).filter((file) => file.startsWith('0066_'))).toEqual([
      '0066_serialize_mfa_verification_attempts.sql',
    ]);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

/**
 * US-029 / #270 real-SQL privilege proof (PGlite).
 *
 * Supabase grants new public-schema tables/functions to `anon` and
 * `authenticated` by default; this suite reproduces those default privileges
 * BEFORE applying migrations 0063–0065, then actually switches into each
 * browser-facing role and attempts reads, writes, and RPC calls.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, '../../../supabase/migrations');
const sqlOf = (file: string): string => fs.readFileSync(path.join(DIR, file), 'utf8');

const OWNER = '10000000-0000-4000-8000-000000000001';
const ENROLLMENT = '20000000-0000-4000-8000-000000000001';
const BATCH = '30000000-0000-4000-8000-00000000000a';
const verifier = (label: string) => label.padEnd(43, 'x').slice(0, 43);

const TABLES = ['authenticator_enrollments', 'authenticator_recovery_codes'] as const;
const RPC_CALLS: Array<[string, string, unknown[]]> = [
  [
    'begin_authenticator_enrollment',
    'SELECT * FROM begin_authenticator_enrollment($1, $2, $3, $4, $5, $6, $7)',
    [OWNER, '20000000-0000-4000-8000-000000000009', 'Y2lwaGVydGV4dC12YWx1ZQ==', 'aXYtdmFsdWUtMTI=', 'dGFnLXZhbHVlLTEyMzQ1Ng==', 'v1', new Date(Date.now() + 600_000).toISOString()],
  ],
  [
    'restart_authenticator_enrollment',
    'SELECT * FROM restart_authenticator_enrollment($1, $2, $3, $4, $5, $6, $7)',
    [OWNER, '20000000-0000-4000-8000-000000000009', 'Y2lwaGVydGV4dC12YWx1ZQ==', 'aXYtdmFsdWUtMTI=', 'dGFnLXZhbHVlLTEyMzQ1Ng==', 'v1', new Date(Date.now() + 600_000).toISOString()],
  ],
  ['activate_authenticator_enrollment', 'SELECT * FROM activate_authenticator_enrollment($1, $2)', [OWNER, ENROLLMENT]],
  [
    'begin_authenticator_replacement',
    'SELECT * FROM begin_authenticator_replacement($1, $2, $3, $4, $5, $6, $7)',
    [OWNER, '20000000-0000-4000-8000-000000000009', 'Y2lwaGVydGV4dC12YWx1ZQ==', 'aXYtdmFsdWUtMTI=', 'dGFnLXZhbHVlLTEyMzQ1Ng==', 'v1', new Date(Date.now() + 600_000).toISOString()],
  ],
  [
    'activate_authenticator_replacement',
    'SELECT * FROM activate_authenticator_replacement($1, $2, $3, $4, $5)',
    [OWNER, ENROLLMENT, BATCH, [verifier('a')], 'v1'],
  ],
  ['disable_authenticator', 'SELECT * FROM disable_authenticator($1)', [OWNER]],
  [
    'replace_authenticator_recovery_codes',
    'SELECT * FROM replace_authenticator_recovery_codes($1, $2, $3, $4, $5)',
    [OWNER, BATCH, null, [verifier('b')], 'v1'],
  ],
];

let db: PGlite;

async function asRole<T>(role: string, run: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await run();
  } finally {
    await db.exec('RESET ROLE');
  }
}

async function failureAs(role: string, sql: string, params: unknown[] = []): Promise<string> {
  return asRole(role, async () => {
    try {
      await db.query(sql, params);
      return '';
    } catch (error) {
      return (error as Error).message;
    }
  });
}

describe('US-029 browser-role privileges (real SQL, #270)', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      -- Supabase-style defaults: every new table/function is granted to browser roles.
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    `);
    await db.exec(sqlOf('0001_create_participants_table.sql'));
    await db.exec(sqlOf('0010_add_participant_suspension.sql'));
    await db.exec('ALTER TABLE participants ADD COLUMN is_deactivated BOOLEAN NOT NULL DEFAULT FALSE;');
    await db.exec(sqlOf('0063_create_authenticator_enrollments.sql'));
    await db.exec(sqlOf('0064_restart_pending_authenticator_enrollment.sql'));
    await db.exec(sqlOf('0065_add_authenticator_recovery_controls.sql'));
    await db.query(
      `INSERT INTO participants (id, firebase_uid, email, full_name, role, is_verified)
       VALUES ($1, 'fb-owner', 'owner@example.test', 'Owner', 'PART', TRUE)`,
      [OWNER]
    );
    await db.query(
      `INSERT INTO authenticator_enrollments
         (id, participant_id, secret_ciphertext, secret_iv, secret_auth_tag, encryption_key_version, status, activated_at)
       VALUES ($1, $2, 'Y2lwaGVydGV4dC1zZWNyZXQ=', 'aXYtdmFsdWUtMTI=', 'dGFnLXZhbHVlLTEyMzQ1Ng==', 'v1', 'Active', NOW())`,
      [ENROLLMENT, OWNER]
    );
    await db.query(
      `INSERT INTO authenticator_recovery_codes (participant_id, batch_id, code_verifier, verifier_key_version)
       VALUES ($1, $2, $3, 'v1')`,
      [OWNER, BATCH, verifier('stored')]
    );
  }, 60_000);

  afterAll(async () => db?.close());

  it('control: the simulated defaults really do expose objects that lack the migrations’ REVOKEs', async () => {
    await db.exec('CREATE TABLE privilege_probe (value TEXT); INSERT INTO privilege_probe VALUES (\'visible\');');
    try {
      const rows = await asRole('anon', () => db.query<{ value: string }>('SELECT value FROM privilege_probe'));
      expect(rows.rows).toEqual([{ value: 'visible' }]);
    } finally {
      await db.exec('DROP TABLE privilege_probe');
    }
  });

  describe.each(['anon', 'authenticated'])('%s (browser-facing) role', (role) => {
    it.each(TABLES)('cannot read %s, even with Supabase default grants', async (table) => {
      expect(await failureAs(role, `SELECT * FROM ${table}`)).toMatch(/permission denied/i);
      expect(await failureAs(role, `SELECT count(*) FROM ${table}`)).toMatch(/permission denied/i);
    });

    it('cannot insert, update, or delete protected rows', async () => {
      expect(
        await failureAs(
          role,
          `INSERT INTO authenticator_recovery_codes (participant_id, batch_id, code_verifier, verifier_key_version)
           VALUES ($1, $2, $3, 'v1')`,
          [OWNER, BATCH, verifier('forged')]
        )
      ).toMatch(/permission denied/i);
      expect(
        await failureAs(role, `UPDATE authenticator_enrollments SET status = 'Retired'`)
      ).toMatch(/permission denied/i);
      expect(await failureAs(role, 'DELETE FROM authenticator_recovery_codes')).toMatch(
        /permission denied/i
      );
    });

    it.each(RPC_CALLS)('cannot execute %s', async (_name, sql, params) => {
      expect(await failureAs(role, sql, params)).toMatch(/permission denied for function/i);
    });
  });

  it('left protected rows untouched after every browser-role attempt', async () => {
    const enrollments = await db.query<{ status: string }>('SELECT status FROM authenticator_enrollments');
    expect(enrollments.rows).toEqual([{ status: 'Active' }]);
    const codes = await db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM authenticator_recovery_codes WHERE revoked_at IS NULL'
    );
    expect(codes.rows[0]!.count).toBe(1);
  });

  it('allows the server-only service_role path', async () => {
    const rows = await asRole('service_role', () =>
      db.query('SELECT id FROM authenticator_enrollments WHERE participant_id = $1', [OWNER])
    );
    expect(rows.rows).toHaveLength(1);
  });

  it('keeps RLS enabled with no policies, so a future accidental grant still exposes no rows', async () => {
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY($1) ORDER BY relname`,
      [[...TABLES]]
    );
    expect(rls.rows.every((row) => row.relrowsecurity)).toBe(true);
    const policies = await db.query(
      `SELECT policyname FROM pg_policies WHERE tablename = ANY($1)`,
      [[...TABLES]]
    );
    expect(policies.rows).toEqual([]);
  });

  it('defines every US-029 RPC as SECURITY DEFINER with a pinned search_path', async () => {
    const functions = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      `SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname = ANY($1) ORDER BY proname`,
      [RPC_CALLS.map(([name]) => name)]
    );
    expect(functions.rows.map((row) => row.proname).sort()).toEqual(
      RPC_CALLS.map(([name]) => name).sort()
    );
    for (const fn of functions.rows) {
      expect(fn.prosecdef, fn.proname).toBe(true);
      expect(fn.proconfig, fn.proname).toContain('search_path=public');
    }
  });

  it('exposes no RPC that returns secret, ciphertext, or verifier columns', async () => {
    const outputs = await db.query<{ proname: string; columns: string }>(
      `SELECT p.proname, pg_get_function_result(p.oid) AS columns
       FROM pg_proc p WHERE p.proname = ANY($1)`,
      [RPC_CALLS.map(([name]) => name)]
    );
    for (const fn of outputs.rows) {
      expect(fn.columns, fn.proname).not.toMatch(/secret|ciphertext|auth_tag|iv\b|verifier|key_version/i);
    }
  });
});

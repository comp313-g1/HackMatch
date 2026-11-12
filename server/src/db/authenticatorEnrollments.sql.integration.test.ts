import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, '../../../supabase/migrations');
const sqlOf = (file: string): string => fs.readFileSync(path.join(DIR, file), 'utf8');

const ids = {
  owner: '10000000-0000-4000-8000-000000000001',
  other: '10000000-0000-4000-8000-000000000002',
  first: '20000000-0000-4000-8000-000000000001',
  second: '20000000-0000-4000-8000-000000000002',
  third: '20000000-0000-4000-8000-000000000003',
} as const;

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> =>
  (await db.query(sql, params)).rows as T[];
const failure = async (sql: string, params?: unknown[]): Promise<string> => {
  try {
    await db.query(sql, params);
    return '';
  } catch (error) {
    return (error as Error).message;
  }
};

function future(minutes = 10): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function begin(enrollmentId: string, participantId = ids.owner, expiresAt = future()) {
  return rows<{
    enrollment_id: string;
    enrollment_status: string;
    expires_at: Date;
  }>(
    'SELECT * FROM begin_authenticator_enrollment($1, $2, $3, $4, $5, $6, $7)',
    [
      participantId,
      enrollmentId,
      'ZW5jcnlwdGVkLXNlY3JldC1jaXBoZXJ0ZXh0',
      'MTIzNDU2Nzg5MDEy',
      'MTIzNDU2Nzg5MDEyMzQ1Ng==',
      'v1',
      expiresAt,
    ]
  );
}

function restart(enrollmentId: string, participantId = ids.owner, expiresAt = future()) {
  return rows<{
    enrollment_id: string;
    enrollment_status: string;
    expires_at: Date;
  }>(
    'SELECT * FROM restart_authenticator_enrollment($1, $2, $3, $4, $5, $6, $7)',
    [
      participantId,
      enrollmentId,
      'ZnJlc2gtZW5jcnlwdGVkLXNlY3JldA==',
      'ZnJlc2gtaXYtMTIz',
      'ZnJlc2gtYXV0aC10YWctMTIzNA==',
      'v1',
      expiresAt,
    ]
  );
}

describe('protected authenticator enrollment SQL (US-029 / #267)', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;'
    );
    await db.exec(sqlOf('0001_create_participants_table.sql'));
    await db.exec(sqlOf('0010_add_participant_suspension.sql'));
    await db.exec(
      'ALTER TABLE participants ADD COLUMN is_deactivated BOOLEAN NOT NULL DEFAULT FALSE;'
    );
    await db.exec(sqlOf('0063_create_authenticator_enrollments.sql'));
    await db.exec(sqlOf('0064_restart_pending_authenticator_enrollment.sql'));
    await db.query(
      `INSERT INTO participants
         (id, firebase_uid, email, full_name, role, is_verified)
       VALUES
         ($1, 'fb-owner', 'owner@example.test', 'Owner', 'PART', TRUE),
         ($2, 'fb-other', 'other@example.test', 'Other', 'PART', TRUE)`,
      [ids.owner, ids.other]
    );
  }, 60_000);

  afterEach(async () => {
    await db.query('DELETE FROM authenticator_enrollments');
  });

  afterAll(async () => db?.close());

  it('persists one owner-scoped pending row containing ciphertext rather than plaintext', async () => {
    const result = await begin(ids.first);
    expect(result[0]).toMatchObject({
      enrollment_id: ids.first,
      enrollment_status: 'Pending',
    });

    const stored = await rows<{
      participant_id: string;
      secret_ciphertext: string;
      secret_iv: string;
      secret_auth_tag: string;
      encryption_key_version: string;
      status: string;
    }>('SELECT participant_id, secret_ciphertext, secret_iv, secret_auth_tag, encryption_key_version, status FROM authenticator_enrollments');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ participant_id: ids.owner, status: 'Pending', encryption_key_version: 'v1' });
    expect(JSON.stringify(stored[0])).not.toContain('RAW_TOTP_SECRET');
  });

  it('enforces deterministic duplicate begin behavior, including concurrent calls', async () => {
    await begin(ids.first);
    expect(await failure(
      'SELECT * FROM begin_authenticator_enrollment($1, $2, $3, $4, $5, $6, $7)',
      [ids.owner, ids.second, 'ciphertext-value', 'initial-vector', 'authentication-tag', 'v1', future()]
    )).toMatch(/TOTP_ENROLLMENT_PENDING/);

    await db.query('DELETE FROM authenticator_enrollments');
    const attempts = await Promise.allSettled([begin(ids.first), begin(ids.second)]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    expect(await rows('SELECT id FROM authenticator_enrollments WHERE status = $1', ['Pending'])).toHaveLength(1);
  });

  it('atomically activates pending state and enforces one active credential', async () => {
    await begin(ids.first);
    const activated = await rows<{
      outcome: string;
      enrollment_id: string;
      activation_time: Date;
    }>('SELECT * FROM activate_authenticator_enrollment($1, $2)', [ids.owner, ids.first]);
    expect(activated[0]).toMatchObject({ outcome: 'Activated', enrollment_id: ids.first });

    const state = await rows<{ status: string; pending_expires_at: Date | null; activated_at: Date | null }>(
      'SELECT status, pending_expires_at, activated_at FROM authenticator_enrollments WHERE id = $1',
      [ids.first]
    );
    expect(state[0].status).toBe('Active');
    expect(state[0].pending_expires_at).toBeNull();
    expect(state[0].activated_at).not.toBeNull();

    expect(await failure(
      `INSERT INTO authenticator_enrollments
         (id, participant_id, secret_ciphertext, secret_iv, secret_auth_tag,
          encryption_key_version, status, activated_at)
       VALUES ($1, $2, 'ciphertext-value', 'initial-vector', 'authentication-tag', 'v1', 'Active', NOW())`,
      [ids.second, ids.owner]
    )).toMatch(/uq_authenticator_enrollments_active_participant|duplicate key/i);
  });

  it('serializes concurrent confirmations so only one activation succeeds', async () => {
    await begin(ids.first);
    const attempts = await Promise.allSettled([
      rows('SELECT * FROM activate_authenticator_enrollment($1, $2)', [ids.owner, ids.first]),
      rows('SELECT * FROM activate_authenticator_enrollment($1, $2)', [ids.owner, ids.first]),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    const state = await rows<{ status: string }>(
      'SELECT status FROM authenticator_enrollments WHERE participant_id = $1',
      [ids.owner]
    );
    expect(state).toEqual([{ status: 'Active' }]);
  });

  it('does not let another owner activate or infer an enrollment', async () => {
    await begin(ids.first);
    expect(await failure(
      'SELECT * FROM activate_authenticator_enrollment($1, $2)',
      [ids.other, ids.first]
    )).toMatch(/TOTP_ENROLLMENT_NOT_PENDING/);
    const state = await rows<{ status: string }>(
      'SELECT status FROM authenticator_enrollments WHERE id = $1',
      [ids.first]
    );
    expect(state[0].status).toBe('Pending');
  });

  it('expires stale pending state without activating it', async () => {
    await db.query(
      `INSERT INTO authenticator_enrollments
         (id, participant_id, secret_ciphertext, secret_iv, secret_auth_tag,
          encryption_key_version, status, pending_expires_at, created_at)
       VALUES ($1, $2, 'ciphertext-value', 'initial-vector', 'authentication-tag',
               'v1', 'Pending', NOW() - INTERVAL '1 second', NOW() - INTERVAL '2 seconds')`,
      [ids.first, ids.owner]
    );
    const result = await rows<{ outcome: string }>(
      'SELECT * FROM activate_authenticator_enrollment($1, $2)',
      [ids.owner, ids.first]
    );
    expect(result[0].outcome).toBe('Expired');
    const state = await rows<{ status: string; activated_at: Date | null }>(
      'SELECT status, activated_at FROM authenticator_enrollments WHERE id = $1',
      [ids.first]
    );
    expect(state[0]).toEqual({ status: 'Expired', activated_at: null });
  });

  it('cannot activate a superseded enrollment after a newer begin', async () => {
    await db.query(
      `INSERT INTO authenticator_enrollments
         (id, participant_id, secret_ciphertext, secret_iv, secret_auth_tag,
          encryption_key_version, status, pending_expires_at, created_at)
       VALUES ($1, $2, 'old-ciphertext-value', 'old-initial-vector',
               'old-authentication-tag', 'v1', 'Pending',
               NOW() - INTERVAL '1 second', NOW() - INTERVAL '2 seconds')`,
      [ids.first, ids.owner]
    );
    await begin(ids.second);

    expect(await failure(
      'SELECT * FROM activate_authenticator_enrollment($1, $2)',
      [ids.owner, ids.first]
    )).toMatch(/TOTP_ENROLLMENT_STALE/);
    const states = await rows<{ id: string; status: string }>(
      'SELECT id, status FROM authenticator_enrollments WHERE participant_id = $1 ORDER BY id',
      [ids.owner]
    );
    expect(states).toEqual([
      { id: ids.first, status: 'Expired' },
      { id: ids.second, status: 'Pending' },
    ]);
  });

  it('atomically replaces pending setup after refresh and makes the old enrollment stale', async () => {
    await begin(ids.first);
    const replacement = await restart(ids.second);
    expect(replacement[0]).toMatchObject({
      enrollment_id: ids.second,
      enrollment_status: 'Pending',
    });

    expect(await failure(
      'SELECT * FROM activate_authenticator_enrollment($1, $2)',
      [ids.owner, ids.first]
    )).toMatch(/TOTP_ENROLLMENT_STALE/);
    const states = await rows<{ id: string; status: string }>(
      'SELECT id, status FROM authenticator_enrollments WHERE participant_id = $1 ORDER BY id',
      [ids.owner]
    );
    expect(states).toEqual([
      { id: ids.first, status: 'Canceled' },
      { id: ids.second, status: 'Pending' },
    ]);
  });

  it('applies the same owner-scoped restart behavior to ADMIN accounts', async () => {
    await db.query(
      `UPDATE participants SET role = 'ADMIN' WHERE id = $1`,
      [ids.owner]
    );
    try {
      await begin(ids.first);
      await expect(restart(ids.second)).resolves.toHaveLength(1);
      const states = await rows<{ status: string }>(
        'SELECT status FROM authenticator_enrollments WHERE participant_id = $1 ORDER BY created_at, id',
        [ids.owner]
      );
      expect(states.map((row) => row.status).sort()).toEqual(['Canceled', 'Pending']);
    } finally {
      await db.query(`UPDATE participants SET role = 'PART' WHERE id = $1`, [ids.owner]);
    }
  });

  it('retires an old active factor only inside successful replacement activation', async () => {
    await begin(ids.first);
    await rows('SELECT * FROM activate_authenticator_enrollment($1, $2)', [ids.owner, ids.first]);

    expect(await failure(
      'SELECT * FROM begin_authenticator_enrollment($1, $2, $3, $4, $5, $6, $7)',
      [ids.owner, ids.second, 'ciphertext-value', 'initial-vector', 'authentication-tag', 'v1', future()]
    )).toMatch(/TOTP_AUTHENTICATOR_ALREADY_ACTIVE/);
    expect((await rows<{ status: string }>('SELECT status FROM authenticator_enrollments WHERE id = $1', [ids.first]))[0].status).toBe('Active');

    // #269 may authorize replacement by creating a protected pending row.
    await db.query(
      `INSERT INTO authenticator_enrollments
         (id, participant_id, secret_ciphertext, secret_iv, secret_auth_tag,
          encryption_key_version, status, pending_expires_at)
       VALUES ($1, $2, 'replacement-ciphertext', 'replacement-iv',
               'replacement-auth-tag', 'v1', 'Pending', $3)`,
      [ids.second, ids.owner, future()]
    );

    await rows('SELECT * FROM activate_authenticator_enrollment($1, $2)', [ids.owner, ids.second]);
    const states = await rows<{ id: string; status: string }>(
      'SELECT id, status FROM authenticator_enrollments WHERE participant_id = $1 ORDER BY id',
      [ids.owner]
    );
    expect(states).toEqual([
      { id: ids.first, status: 'Retired' },
      { id: ids.second, status: 'Active' },
    ]);
  });

  it('keeps the table and RPCs inaccessible to browser roles', async () => {
    const tableGrants = await rows<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type
       FROM information_schema.role_table_grants
       WHERE table_name = 'authenticator_enrollments'`
    );
    expect(tableGrants.some((grant) => grant.grantee === 'service_role')).toBe(true);
    expect(tableGrants.some((grant) => ['PUBLIC', 'anon', 'authenticated'].includes(grant.grantee))).toBe(false);

    const functionGrants = await rows<{ routine_name: string; grantee: string }>(
      `SELECT routine_name, grantee
       FROM information_schema.routine_privileges
       WHERE routine_name IN ('begin_authenticator_enrollment', 'restart_authenticator_enrollment', 'activate_authenticator_enrollment')`
    );
    for (const routine of ['begin_authenticator_enrollment', 'restart_authenticator_enrollment', 'activate_authenticator_enrollment']) {
      const grantees = functionGrants.filter((row) => row.routine_name === routine).map((row) => row.grantee);
      expect(grantees).toContain('service_role');
      expect(grantees).not.toContain('PUBLIC');
      expect(grantees).not.toContain('anon');
      expect(grantees).not.toContain('authenticated');
    }
  });

  it('is additive/idempotent and owns the unique next migration number', async () => {
    await expect(db.exec(sqlOf('0063_create_authenticator_enrollments.sql'))).resolves.not.toThrow();
    await expect(db.exec(sqlOf('0064_restart_pending_authenticator_enrollment.sql'))).resolves.not.toThrow();
    expect(fs.readdirSync(DIR).filter((file) => file.startsWith('0063_'))).toEqual([
      '0063_create_authenticator_enrollments.sql',
    ]);
    expect(fs.readdirSync(DIR).filter((file) => file.startsWith('0064_'))).toEqual([
      '0064_restart_pending_authenticator_enrollment.sql',
    ]);
  });
});

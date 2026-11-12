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
  admin: '10000000-0000-4000-8000-000000000003',
  first: '20000000-0000-4000-8000-000000000001',
  second: '20000000-0000-4000-8000-000000000002',
  third: '20000000-0000-4000-8000-000000000003',
  batchA: '30000000-0000-4000-8000-00000000000a',
  batchB: '30000000-0000-4000-8000-00000000000b',
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

const future = (minutes = 10) => new Date(Date.now() + minutes * 60_000).toISOString();
/** Deterministic 43-char base64url stand-ins for HMAC verifiers. */
const verifier = (label: string) => label.padEnd(43, 'x').slice(0, 43);
const verifierSet = (prefix: string, count = 10) =>
  Array.from({ length: count }, (_, index) => verifier(`${prefix}${index}`));

const ENROLLMENT_ARGS = [
  'ZW5jcnlwdGVkLXNlY3JldC1jaXBoZXJ0ZXh0',
  'MTIzNDU2Nzg5MDEy',
  'MTIzNDU2Nzg5MDEyMzQ1Ng==',
  'v1',
];

async function activate(enrollmentId: string, participantId: string = ids.owner) {
  await rows('SELECT * FROM begin_authenticator_enrollment($1, $2, $3, $4, $5, $6, $7)', [
    participantId,
    enrollmentId,
    ...ENROLLMENT_ARGS,
    future(),
  ]);
  await rows('SELECT * FROM activate_authenticator_enrollment($1, $2)', [participantId, enrollmentId]);
}

function replaceCodes(
  batchId: string,
  expectedBatch: string | null,
  verifiers: string[],
  participantId: string = ids.owner
) {
  return rows<{ batch_id: string; code_count: number; generated_at: Date }>(
    'SELECT * FROM replace_authenticator_recovery_codes($1, $2, $3, $4, $5)',
    [participantId, batchId, expectedBatch, verifiers, 'v1']
  );
}

function beginReplacement(enrollmentId: string, participantId: string = ids.owner) {
  return rows<{ enrollment_id: string; enrollment_status: string }>(
    'SELECT * FROM begin_authenticator_replacement($1, $2, $3, $4, $5, $6, $7)',
    [participantId, enrollmentId, ...ENROLLMENT_ARGS, future()]
  );
}

const statuses = (participantId: string = ids.owner) =>
  rows<{ id: string; status: string }>(
    'SELECT id, status FROM authenticator_enrollments WHERE participant_id = $1 ORDER BY id',
    [participantId]
  );

const currentCodes = (participantId: string = ids.owner) =>
  rows<{ batch_id: string; code_verifier: string }>(
    `SELECT batch_id, code_verifier FROM authenticator_recovery_codes
     WHERE participant_id = $1 AND revoked_at IS NULL ORDER BY code_verifier`,
    [participantId]
  );

describe('authenticator recovery controls SQL (US-029 / #269)', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;'
    );
    await db.exec(sqlOf('0001_create_participants_table.sql'));
    await db.exec(sqlOf('0010_add_participant_suspension.sql'));
    await db.exec('ALTER TABLE participants ADD COLUMN is_deactivated BOOLEAN NOT NULL DEFAULT FALSE;');
    await db.exec(sqlOf('0063_create_authenticator_enrollments.sql'));
    await db.exec(sqlOf('0064_restart_pending_authenticator_enrollment.sql'));
    await db.exec(sqlOf('0065_add_authenticator_recovery_controls.sql'));
    await db.query(
      `INSERT INTO participants (id, firebase_uid, email, full_name, role, is_verified)
       VALUES
         ($1, 'fb-owner', 'owner@example.test', 'Owner', 'PART', TRUE),
         ($2, 'fb-other', 'other@example.test', 'Other', 'PART', TRUE),
         ($3, 'fb-admin', 'admin@example.test', 'Admin', 'ADMIN', TRUE)`,
      [ids.owner, ids.other, ids.admin]
    );
  }, 60_000);

  afterEach(async () => {
    await db.query('DELETE FROM authenticator_recovery_codes');
    await db.query('DELETE FROM authenticator_enrollments');
    await db.query('UPDATE participants SET is_suspended = FALSE');
  });

  afterAll(async () => db?.close());

  describe('recovery-code generation', () => {
    it('stores only verifiers for an owner with an active authenticator (PART and ADMIN)', async () => {
      for (const participant of [ids.owner, ids.admin]) {
        await activate(participant === ids.owner ? ids.first : ids.second, participant);
        const result = await replaceCodes(
          participant === ids.owner ? ids.batchA : ids.batchB,
          null,
          verifierSet(participant === ids.owner ? 'p' : 'a'),
          participant
        );
        expect(result[0]).toMatchObject({ code_count: 10 });
      }

      const columns = await rows<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'authenticator_recovery_codes' ORDER BY ordinal_position`
      );
      expect(columns.map((column) => column.column_name)).toEqual([
        'id',
        'participant_id',
        'batch_id',
        'code_verifier',
        'verifier_key_version',
        'created_at',
        'used_at',
        'revoked_at',
      ]);
      expect(await currentCodes(ids.owner)).toHaveLength(10);
      expect(await currentCodes(ids.admin)).toHaveLength(10);
      expect(await currentCodes(ids.other)).toHaveLength(0);
    });

    it('rejects plaintext-shaped or malformed verifiers and duplicate sets', async () => {
      await activate(ids.first);
      expect(await failure(
        'SELECT * FROM replace_authenticator_recovery_codes($1, $2, $3, $4, $5)',
        [ids.owner, ids.batchA, null, ['ABCD-EFGH-JKMN'], 'v1']
      )).toMatch(/RECOVERY_CODES_VALIDATION_ERROR/);
      expect(await failure(
        'SELECT * FROM replace_authenticator_recovery_codes($1, $2, $3, $4, $5)',
        [ids.owner, ids.batchA, null, [verifier('same'), verifier('same')], 'v1']
      )).toMatch(/RECOVERY_CODES_VALIDATION_ERROR/);
      expect(await failure(
        'SELECT * FROM replace_authenticator_recovery_codes($1, $2, $3, $4, $5)',
        [ids.owner, ids.batchA, null, [], 'v1']
      )).toMatch(/RECOVERY_CODES_VALIDATION_ERROR/);
      expect(await failure(
        `INSERT INTO authenticator_recovery_codes (participant_id, batch_id, code_verifier, verifier_key_version)
         VALUES ($1, $2, 'ABCD-EFGH-JKMN', 'v1')`,
        [ids.owner, ids.batchA]
      )).toMatch(/check constraint|code_verifier/i);
      expect(await currentCodes()).toHaveLength(0);
    });

    it('requires an active authenticator and an eligible account', async () => {
      expect(await failure(
        'SELECT * FROM replace_authenticator_recovery_codes($1, $2, $3, $4, $5)',
        [ids.owner, ids.batchA, null, verifierSet('p'), 'v1']
      )).toMatch(/TOTP_AUTHENTICATOR_NOT_ACTIVE/);

      await activate(ids.first);
      await db.query('UPDATE participants SET is_suspended = TRUE WHERE id = $1', [ids.owner]);
      expect(await failure(
        'SELECT * FROM replace_authenticator_recovery_codes($1, $2, $3, $4, $5)',
        [ids.owner, ids.batchA, null, verifierSet('p'), 'v1']
      )).toMatch(/TOTP_PARTICIPANT_NOT_ELIGIBLE/);
      expect(await currentCodes()).toHaveLength(0);
    });

    it('regenerates atomically: the old set is revoked only when the new set commits', async () => {
      await activate(ids.first);
      await replaceCodes(ids.batchA, null, verifierSet('old'));

      await replaceCodes(ids.batchB, ids.batchA, verifierSet('new'));
      const current = await currentCodes();
      expect(current).toHaveLength(10);
      expect(new Set(current.map((row) => row.batch_id))).toEqual(new Set([ids.batchB]));
      const revoked = await rows<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM authenticator_recovery_codes
         WHERE batch_id = $1 AND revoked_at IS NOT NULL`,
        [ids.batchA]
      );
      expect(revoked[0].count).toBe(10);
      // The active authenticator is preserved by regeneration.
      expect(await statuses()).toEqual([{ id: ids.first, status: 'Active' }]);
    });

    it('preserves the previous valid set when replacement fails mid-transaction', async () => {
      await activate(ids.first);
      await replaceCodes(ids.batchA, null, verifierSet('old'));
      // A verifier equal to an existing row violates the per-owner unique index
      // after the revoke UPDATE has run — the whole function must roll back.
      const collision = [...verifierSet('new', 9), verifier('old0')];
      expect(await failure(
        'SELECT * FROM replace_authenticator_recovery_codes($1, $2, $3, $4, $5)',
        [ids.owner, ids.batchB, ids.batchA, collision, 'v1']
      )).toMatch(/uq_authenticator_recovery_codes_participant_verifier|duplicate key/i);

      const current = await currentCodes();
      expect(current).toHaveLength(10);
      expect(new Set(current.map((row) => row.batch_id))).toEqual(new Set([ids.batchA]));
    });

    it('rejects a stale regeneration so codes shown in another session are not silently invalidated', async () => {
      await activate(ids.first);
      await replaceCodes(ids.batchA, null, verifierSet('first'));
      // A second session that still believes no set exists.
      expect(await failure(
        'SELECT * FROM replace_authenticator_recovery_codes($1, $2, $3, $4, $5)',
        [ids.owner, ids.batchB, null, verifierSet('second'), 'v1']
      )).toMatch(/RECOVERY_CODES_STALE/);
      expect(new Set((await currentCodes()).map((row) => row.batch_id))).toEqual(
        new Set([ids.batchA])
      );
    });

    it('serializes concurrent regenerations so exactly one set remains current', async () => {
      await activate(ids.first);
      await replaceCodes(ids.batchA, null, verifierSet('base'));
      const attempts = await Promise.allSettled([
        replaceCodes(ids.batchB, ids.batchA, verifierSet('left')),
        replaceCodes('30000000-0000-4000-8000-00000000000c', ids.batchA, verifierSet('right')),
      ]);
      expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
      expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
      const current = await currentCodes();
      expect(current).toHaveLength(10);
      expect(new Set(current.map((row) => row.batch_id)).size).toBe(1);
    });

    it('never touches another account when the owner regenerates', async () => {
      await activate(ids.first, ids.owner);
      await activate(ids.second, ids.other);
      await replaceCodes(ids.batchB, null, verifierSet('other'), ids.other);
      await replaceCodes(ids.batchA, null, verifierSet('owner'), ids.owner);
      await replaceCodes('30000000-0000-4000-8000-00000000000c', ids.batchA, verifierSet('again'), ids.owner);
      expect(new Set((await currentCodes(ids.other)).map((row) => row.batch_id))).toEqual(
        new Set([ids.batchB])
      );
    });
  });

  describe('authenticator replacement', () => {
    const BATCH_FRESH = '30000000-0000-4000-8000-0000000000ff';

    const confirmReplacement = (
      enrollmentId: string,
      verifiers: string[] = verifierSet('fresh'),
      participantId: string = ids.owner,
      batchId: string = BATCH_FRESH
    ) =>
      rows<{
        outcome: string;
        enrollment_id: string;
        activation_time: Date | null;
        recovery_batch_id: string | null;
        recovery_code_count: number;
      }>('SELECT * FROM activate_authenticator_replacement($1, $2, $3, $4, $5)', [
        participantId,
        enrollmentId,
        batchId,
        verifiers,
        'v1',
      ]);

    /** "Valid" = present in the current set and unused — what any future redemption must require. */
    const isCurrentCode = async (code: string, participantId: string = ids.owner) =>
      (
        await rows<{ valid: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM authenticator_recovery_codes
             WHERE participant_id = $1 AND code_verifier = $2
               AND revoked_at IS NULL AND used_at IS NULL
           ) AS valid`,
          [participantId, code]
        )
      )[0].valid;

    async function activeWithCodes(participantId: string = ids.owner) {
      await activate(ids.first, participantId);
      await replaceCodes(ids.batchA, null, verifierSet('old'), participantId);
    }

    it('keeps the old factor and recovery codes valid while replacement is merely pending', async () => {
      await activeWithCodes();
      const pending = await beginReplacement(ids.second);
      expect(pending[0]).toMatchObject({ enrollment_id: ids.second, enrollment_status: 'Pending' });
      expect(await statuses()).toEqual([
        { id: ids.first, status: 'Active' },
        { id: ids.second, status: 'Pending' },
      ]);
      expect(await currentCodes()).toHaveLength(10);
      expect(await isCurrentCode(verifier('old0'))).toBe(true);
    });

    it.each([
      ['PART', ids.owner],
      ['ADMIN', ids.admin],
    ])(
      'on successful %s confirmation retires the old factor, revokes the old set, and stores a fresh one atomically',
      async (_role, participantId) => {
        await activeWithCodes(participantId);
        await beginReplacement(ids.second, participantId);

        const result = await confirmReplacement(ids.second, verifierSet('fresh'), participantId);
        expect(result[0]).toMatchObject({
          outcome: 'Activated',
          enrollment_id: ids.second,
          recovery_batch_id: BATCH_FRESH,
          recovery_code_count: 10,
        });
        expect(result[0].activation_time).not.toBeNull();

        expect(await statuses(participantId)).toEqual([
          { id: ids.first, status: 'Retired' },
          { id: ids.second, status: 'Active' },
        ]);
        const current = await currentCodes(participantId);
        expect(current).toHaveLength(10);
        expect(new Set(current.map((row) => row.batch_id))).toEqual(new Set([BATCH_FRESH]));
        // Old codes are no longer valid; fresh ones are.
        for (let index = 0; index < 10; index += 1) {
          expect(await isCurrentCode(verifier(`old${index}`), participantId)).toBe(false);
        }
        expect(await isCurrentCode(verifier('fresh0'), participantId)).toBe(true);
        // The revoked rows remain as history and share one revocation instant with activation.
        const revoked = await rows<{ same_instant: boolean }>(
          `SELECT bool_and(c.revoked_at = e.activated_at) AS same_instant
           FROM authenticator_recovery_codes c
           JOIN authenticator_enrollments e ON e.id = $2
           WHERE c.participant_id = $1 AND c.batch_id = $3`,
          [participantId, ids.second, ids.batchA]
        );
        expect(revoked[0].same_instant).toBe(true);
      }
    );

    it('preserves the old factor and recovery set when the confirmation transaction fails', async () => {
      await activeWithCodes();
      await beginReplacement(ids.second);
      // A colliding verifier violates the unique index after the retire/revoke
      // statements ran — the whole replacement must roll back.
      const collision = [...verifierSet('fresh', 9), verifier('old0')];
      expect(await failure(
        'SELECT * FROM activate_authenticator_replacement($1, $2, $3, $4, $5)',
        [ids.owner, ids.second, BATCH_FRESH, collision, 'v1']
      )).toMatch(/uq_authenticator_recovery_codes_participant_verifier|duplicate key/i);

      expect(await statuses()).toEqual([
        { id: ids.first, status: 'Active' },
        { id: ids.second, status: 'Pending' },
      ]);
      expect(new Set((await currentCodes()).map((row) => row.batch_id))).toEqual(new Set([ids.batchA]));
      expect(await isCurrentCode(verifier('old0'))).toBe(true);

      // Malformed fresh verifiers are rejected before anything changes.
      expect(await failure(
        'SELECT * FROM activate_authenticator_replacement($1, $2, $3, $4, $5)',
        [ids.owner, ids.second, BATCH_FRESH, ['RAW-CODE'], 'v1']
      )).toMatch(/RECOVERY_CODES_VALIDATION_ERROR/);
      expect(await currentCodes()).toHaveLength(10);
    });

    it('preserves the old factor and recovery set when replacement is cancelled/restarted', async () => {
      await activeWithCodes();
      await beginReplacement(ids.second);
      await beginReplacement(ids.third);
      expect(await statuses()).toEqual([
        { id: ids.first, status: 'Active' },
        { id: ids.second, status: 'Canceled' },
        { id: ids.third, status: 'Pending' },
      ]);
      expect(await failure(
        'SELECT * FROM activate_authenticator_replacement($1, $2, $3, $4, $5)',
        [ids.owner, ids.second, BATCH_FRESH, verifierSet('fresh'), 'v1']
      )).toMatch(/TOTP_ENROLLMENT_STALE/);
      expect(new Set((await currentCodes()).map((row) => row.batch_id))).toEqual(new Set([ids.batchA]));
    });

    it('preserves the old factor and recovery set when the replacement expires', async () => {
      await activeWithCodes();
      await beginReplacement(ids.second);
      await db.query(
        `UPDATE authenticator_enrollments
         SET pending_expires_at = NOW() - INTERVAL '1 second', created_at = NOW() - INTERVAL '2 seconds'
         WHERE id = $1`,
        [ids.second]
      );
      const expired = await confirmReplacement(ids.second);
      expect(expired[0]).toMatchObject({ outcome: 'Expired', recovery_batch_id: null, recovery_code_count: 0 });
      expect(await statuses()).toEqual([
        { id: ids.first, status: 'Active' },
        { id: ids.second, status: 'Expired' },
      ]);
      expect(new Set((await currentCodes()).map((row) => row.batch_id))).toEqual(new Set([ids.batchA]));
      expect(await isCurrentCode(verifier('old0'))).toBe(true);
    });

    it('refuses to finish a replacement that is not beside an active factor or belongs to another owner', async () => {
      await activate(ids.first);
      // A first-time pending row (no other active factor) is not a replacement.
      await rows('SELECT * FROM disable_authenticator($1)', [ids.owner]);
      await rows('SELECT * FROM begin_authenticator_enrollment($1, $2, $3, $4, $5, $6, $7)', [
        ids.owner,
        ids.second,
        ...ENROLLMENT_ARGS,
        future(),
      ]);
      expect(await failure(
        'SELECT * FROM activate_authenticator_replacement($1, $2, $3, $4, $5)',
        [ids.owner, ids.second, BATCH_FRESH, verifierSet('fresh'), 'v1']
      )).toMatch(/TOTP_AUTHENTICATOR_NOT_ACTIVE/);

      await db.query('DELETE FROM authenticator_enrollments');
      await activeWithCodes();
      await beginReplacement(ids.second);
      expect(await failure(
        'SELECT * FROM activate_authenticator_replacement($1, $2, $3, $4, $5)',
        [ids.other, ids.second, BATCH_FRESH, verifierSet('fresh'), 'v1']
      )).toMatch(/TOTP_ENROLLMENT_NOT_PENDING/);
      expect((await statuses())[0]).toEqual({ id: ids.first, status: 'Active' });
      expect(await currentCodes()).toHaveLength(10);
    });

    it('serializes concurrent confirmations so exactly one replacement and one fresh set win', async () => {
      await activeWithCodes();
      await beginReplacement(ids.second);
      const attempts = await Promise.allSettled([
        confirmReplacement(ids.second, verifierSet('left'), ids.owner, BATCH_FRESH),
        confirmReplacement(ids.second, verifierSet('right'), ids.owner, ids.batchB),
      ]);
      expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
      const rejected = attempts.find((attempt) => attempt.status === 'rejected') as PromiseRejectedResult;
      expect(String(rejected.reason)).toMatch(/TOTP_AUTHENTICATOR_ALREADY_ACTIVE/);
      expect(await statuses()).toEqual([
        { id: ids.first, status: 'Retired' },
        { id: ids.second, status: 'Active' },
      ]);
      const current = await currentCodes();
      expect(current).toHaveLength(10);
      expect(new Set(current.map((row) => row.batch_id)).size).toBe(1);
    });

    it('serializes replacement confirmation with a concurrent regeneration (no mixed sets)', async () => {
      await activeWithCodes();
      await beginReplacement(ids.second);
      const attempts = await Promise.allSettled([
        confirmReplacement(ids.second),
        replaceCodes(ids.batchB, ids.batchA, verifierSet('regen')),
      ]);
      // Whichever commits second sees a changed batch (stale) or still succeeds
      // in order; either way exactly one non-revoked batch remains.
      expect(attempts.some((attempt) => attempt.status === 'fulfilled')).toBe(true);
      const current = await currentCodes();
      expect(current).toHaveLength(10);
      expect(new Set(current.map((row) => row.batch_id)).size).toBe(1);
      expect((await statuses()).find((row) => row.id === ids.second)?.status).toBe('Active');
    });

    it('requires an active factor and does not let another owner replace it', async () => {
      expect(await failure(
        'SELECT * FROM begin_authenticator_replacement($1, $2, $3, $4, $5, $6, $7)',
        [ids.owner, ids.second, ...ENROLLMENT_ARGS, future()]
      )).toMatch(/TOTP_AUTHENTICATOR_NOT_ACTIVE/);

      await activate(ids.first);
      expect(await failure(
        'SELECT * FROM begin_authenticator_replacement($1, $2, $3, $4, $5, $6, $7)',
        [ids.other, ids.second, ...ENROLLMENT_ARGS, future()]
      )).toMatch(/TOTP_AUTHENTICATOR_NOT_ACTIVE/);
      expect(await statuses()).toEqual([{ id: ids.first, status: 'Active' }]);
    });
  });

  describe('authenticator disable', () => {
    it('retires the active factor, cancels pending replacement, and revokes recovery codes together', async () => {
      await activate(ids.first);
      await replaceCodes(ids.batchA, null, verifierSet('gone'));
      await beginReplacement(ids.second);

      const result = await rows<{ disabled_at: Date; revoked_recovery_codes: number }>(
        'SELECT * FROM disable_authenticator($1)',
        [ids.owner]
      );
      expect(result[0].revoked_recovery_codes).toBe(10);
      expect(await statuses()).toEqual([
        { id: ids.first, status: 'Retired' },
        { id: ids.second, status: 'Canceled' },
      ]);
      expect(await currentCodes()).toHaveLength(0);
      // Lifecycle history and revoked verifier rows are retained, not deleted.
      expect(await rows('SELECT id FROM authenticator_recovery_codes WHERE participant_id = $1', [ids.owner])).toHaveLength(10);
    });

    it('is owner-scoped, rejects a second disable, and allows fresh enrollment afterwards', async () => {
      await activate(ids.first, ids.owner);
      await activate(ids.second, ids.other);
      await rows('SELECT * FROM disable_authenticator($1)', [ids.owner]);

      expect(await statuses(ids.other)).toEqual([{ id: ids.second, status: 'Active' }]);
      expect(await failure('SELECT * FROM disable_authenticator($1)', [ids.owner])).toMatch(
        /TOTP_AUTHENTICATOR_NOT_ACTIVE/
      );
      await activate(ids.third, ids.owner);
      expect((await statuses(ids.owner)).find((row) => row.id === ids.third)?.status).toBe('Active');
    });

    it('rejects suspended accounts without changing state', async () => {
      await activate(ids.first);
      await db.query('UPDATE participants SET is_suspended = TRUE WHERE id = $1', [ids.owner]);
      expect(await failure('SELECT * FROM disable_authenticator($1)', [ids.owner])).toMatch(
        /TOTP_PARTICIPANT_NOT_ELIGIBLE/
      );
      expect(await statuses()).toEqual([{ id: ids.first, status: 'Active' }]);
    });
  });

  it('keeps the recovery table and RPCs inaccessible to browser roles', async () => {
    const tableGrants = await rows<{ grantee: string }>(
      `SELECT grantee FROM information_schema.role_table_grants
       WHERE table_name = 'authenticator_recovery_codes'`
    );
    expect(tableGrants.some((grant) => grant.grantee === 'service_role')).toBe(true);
    expect(tableGrants.some((grant) => ['PUBLIC', 'anon', 'authenticated'].includes(grant.grantee))).toBe(false);

    const routines = [
      'begin_authenticator_replacement',
      'activate_authenticator_replacement',
      'disable_authenticator',
      'replace_authenticator_recovery_codes',
    ];
    const functionGrants = await rows<{ routine_name: string; grantee: string }>(
      `SELECT routine_name, grantee FROM information_schema.routine_privileges
       WHERE routine_name = ANY($1)`,
      [routines]
    );
    for (const routine of routines) {
      const grantees = functionGrants.filter((row) => row.routine_name === routine).map((row) => row.grantee);
      expect(grantees).toContain('service_role');
      expect(grantees).not.toContain('PUBLIC');
      expect(grantees).not.toContain('anon');
      expect(grantees).not.toContain('authenticated');
    }
    const rls = await rows<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'authenticator_recovery_codes'`
    );
    expect(rls[0].relrowsecurity).toBe(true);
  });

  it('is additive/idempotent and owns the unique 0065 migration number', async () => {
    await expect(db.exec(sqlOf('0065_add_authenticator_recovery_controls.sql'))).resolves.not.toThrow();
    expect(fs.readdirSync(DIR).filter((file) => file.startsWith('0065_'))).toEqual([
      '0065_add_authenticator_recovery_controls.sql',
    ]);
  });
});

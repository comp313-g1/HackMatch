import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  __dirname,
  '../../../supabase/migrations/0063_create_authenticator_enrollments.sql'
);
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('0063 protected authenticator enrollment schema (US-029 / #267)', () => {
  it('stores only protected secret fields with owner and lifecycle metadata', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS authenticator_enrollments/i);
    expect(sql).toMatch(/participant_id UUID NOT NULL REFERENCES participants\(id\) ON DELETE CASCADE/i);
    expect(sql).toMatch(/secret_ciphertext TEXT NOT NULL/i);
    expect(sql).toMatch(/secret_iv TEXT NOT NULL/i);
    expect(sql).toMatch(/secret_auth_tag TEXT NOT NULL/i);
    expect(sql).toMatch(/encryption_key_version VARCHAR\(32\) NOT NULL/i);
    expect(sql).not.toMatch(/secret_plaintext|raw_secret/i);
  });

  it('enforces one pending and one active enrollment per participant', () => {
    expect(sql).toMatch(/UNIQUE INDEX IF NOT EXISTS uq_authenticator_enrollments_pending_participant[\s\S]*WHERE status = 'Pending'/i);
    expect(sql).toMatch(/UNIQUE INDEX IF NOT EXISTS uq_authenticator_enrollments_active_participant[\s\S]*WHERE status = 'Active'/i);
    expect(sql).toMatch(/idx_authenticator_enrollments_pending_expiry/i);
  });

  it('uses service-role-only atomic begin and activation functions', () => {
    expect(sql).toMatch(/FUNCTION begin_authenticator_enrollment/i);
    expect(sql).toMatch(/FUNCTION activate_authenticator_enrollment/i);
    expect(sql.match(/pg_advisory_xact_lock/gi)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toMatch(/REVOKE ALL ON TABLE authenticator_enrollments FROM PUBLIC, anon, authenticated/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION begin_authenticator_enrollment[\s\S]*TO service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION activate_authenticator_enrollment[\s\S]*TO service_role/i);
  });
});

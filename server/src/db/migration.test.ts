import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('0001_create_participants_table.sql Migration DDL', () => {
  const migrationPath = path.resolve(__dirname, '../../../supabase/migrations/0001_create_participants_table.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('enforces Row Level Security explicitly on participants table', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+participants\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i);
  });

  it('enforces strict role constraints for PART and ADMIN', () => {
    expect(sql).toMatch(/CHECK\s*\(\s*role\s+IN\s*\(\s*'PART'\s*,\s*'ADMIN'\s*\)\s*\)/i);
  });

  it('defaults is_verified to FALSE', () => {
    expect(sql).toMatch(/is_verified\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE/i);
  });

  it('enforces unique constraints on firebase_uid and case-insensitive email', () => {
    expect(sql).toMatch(/firebase_uid.*UNIQUE/i);
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX.*ON\s+participants\s*\(\s*LOWER\s*\(\s*email\s*\)\s*\)/i);
  });

  it('attaches automatic updated_at trigger and function', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+set_updated_at\s*\(\)/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_participants_updated_at/i);
  });
});

describe('0002_create_provider_identities_table.sql Migration DDL', () => {
  const migrationPath = path.resolve(__dirname, '../../../supabase/migrations/0002_create_provider_identities_table.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('enforces Row Level Security explicitly on provider_identities table', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+provider_identities\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i);
  });

  it('enforces foreign key cascading delete to participants', () => {
    expect(sql).toMatch(/REFERENCES\s+participants\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
  });

  it('enforces provider CHECK constraint restricting to allowed OAuth providers', () => {
    expect(sql).toMatch(/CHECK\s*\(\s*provider\s+IN\s*\(\s*'google'\s*,\s*'github'\s*,\s*'google\.com'\s*,\s*'github\.com'\s*\)\s*\)/i);
  });

  it('enforces unique constraints on (provider, provider_uid) and (participant_id, provider)', () => {
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX.*ON\s+provider_identities\s*\(\s*provider\s*,\s*provider_uid\s*\)/i);
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX.*ON\s+provider_identities\s*\(\s*participant_id\s*,\s*provider\s*\)/i);
  });

  it('attaches automatic updated_at trigger', () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_provider_identities_updated_at/i);
  });

  it('attaches ADMIN role restriction trigger', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+check_provider_identity_participant_role/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_check_provider_identity_role/i);
  });
});

describe('0003_create_mfa_records.sql Migration DDL', () => {
  const migrationPath = path.resolve(__dirname, '../../../supabase/migrations/0003_create_mfa_records.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('enforces Row Level Security explicitly on mfa_challenges and mfa_attempts', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+mfa_challenges\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+mfa_attempts\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i);
  });

  it('enforces foreign key cascading delete to participants', () => {
    expect(sql).toMatch(/mfa_challenges[\s\S]*?REFERENCES\s+participants\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
    expect(sql).toMatch(/mfa_attempts[\s\S]*?REFERENCES\s+participants\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
  });

  it('enforces foreign key on challenge_id with ON DELETE SET NULL in mfa_attempts', () => {
    expect(sql).toMatch(/REFERENCES\s+mfa_challenges\s*\(\s*id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i);
  });

  it('enforces check constraint on mfa_challenges lifecycle state', () => {
    expect(sql).toMatch(/CONSTRAINT\s+chk_mfa_challenges_state\s+CHECK\s*\(\s*consumed_at\s+IS\s+NULL\s+OR\s+invalidated_at\s+IS\s+NULL\s*\)/i);
  });

  it('creates composite indexes on mfa_challenges and mfa_attempts', () => {
    expect(sql).toMatch(/CREATE\s+INDEX.*ON\s+mfa_challenges\s*\(\s*participant_id\s*,\s*created_at\s+DESC\s*\)/i);
    expect(sql).toMatch(/CREATE\s+INDEX.*ON\s+mfa_challenges\s*\(\s*participant_id\s*,\s*expires_at\s*\)/i);
    expect(sql).toMatch(/CREATE\s+INDEX.*ON\s+mfa_attempts\s*\(\s*participant_id\s*,\s*created_at\s+DESC\s*\)/i);
  });

  it('attaches automatic updated_at trigger on mfa_challenges', () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_mfa_challenges_updated_at/i);
  });
});


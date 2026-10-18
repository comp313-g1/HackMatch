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

describe('0004_create_profile_tables.sql Migration DDL', () => {
  const migrationPath = path.resolve(__dirname, '../../../supabase/migrations/0004_create_profile_tables.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('enforces Row Level Security explicitly on participant_profiles, participant_skills, and participant_portfolios', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+participant_profiles\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+participant_skills\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+participant_portfolios\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i);
  });

  it('enforces foreign key cascading delete to participants across all profile tables', () => {
    expect(sql).toMatch(/participant_profiles[\s\S]*?REFERENCES\s+participants\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
    expect(sql).toMatch(/participant_skills[\s\S]*?REFERENCES\s+participants\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
    expect(sql).toMatch(/participant_portfolios[\s\S]*?REFERENCES\s+participants\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
  });

  it('enforces primary_role check constraint restricting to canonical roles', () => {
    expect(sql).toMatch(/CHECK\s*\(\s*primary_role\s+IN\s*\(\s*'Frontend'\s*,\s*'Backend'\s*,\s*'Mobile'\s*,\s*'AI\/ML'\s*,\s*'UI\/UX'\s*,\s*'Pitch'\s*\)\s*\)/i);
  });

  it('enforces HTTPS and minimum length check constraint on portfolio url', () => {
    expect(sql).toMatch(/CHECK\s*\(\s*url\s+LIKE\s+'https:\/\/%'\s+AND\s+LENGTH\s*\(\s*url\s*\)\s*>\s*8\s*\)/i);
  });

  it('creates case-insensitive unique index on handle', () => {
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX.*ON\s+participant_profiles\s*\(\s*LOWER\s*\(\s*handle\s*\)\s*\)\s+WHERE\s+handle\s+IS\s+NOT\s+NULL/i);
  });

  it('creates unique index on participant_id and skill_name, and search index on skill_name', () => {
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX.*ON\s+participant_skills\s*\(\s*participant_id\s*,\s*LOWER\s*\(\s*skill_name\s*\)\s*\)/i);
    expect(sql).toMatch(/CREATE\s+INDEX.*ON\s+participant_skills\s*\(\s*LOWER\s*\(\s*skill_name\s*\)\s*\)/i);
  });

  it('creates index on participant_portfolios for participant_id lookup', () => {
    expect(sql).toMatch(/CREATE\s+INDEX.*ON\s+participant_portfolios\s*\(\s*participant_id\s*\)/i);
  });

  it('attaches automatic updated_at trigger on participant_profiles and participant_portfolios', () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_participant_profiles_updated_at/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_participant_portfolios_updated_at/i);
  });

  it('attaches ADMIN role restriction trigger on participant_profiles', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+check_participant_profile_role/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_check_participant_profile_role/i);
  });
});

describe('0005_create_pending_event_submissions.sql Migration DDL', () => {
  const migrationPath = path.resolve(__dirname, '../../../supabase/migrations/0005_create_pending_event_submissions.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('enforces Row Level Security explicitly on pending_event_submissions', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+pending_event_submissions\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i);
  });

  it('enforces foreign key cascading delete to participants on submitter_id', () => {
    expect(sql).toMatch(/submitter_id[\s\S]*?REFERENCES\s+participants\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
  });

  it('defines canonical_event_id column as UUID without blocking on unmerged events table', () => {
    expect(sql).toMatch(/canonical_event_id\s+UUID/i);
  });

  it('defines event_edition column', () => {
    expect(sql).toMatch(/event_edition\s+VARCHAR\(\d+\)/i);
  });

  it('enforces HTTPS check constraint on official_url', () => {
    expect(sql).toMatch(/CHECK\s*\(\s*official_url\s+LIKE\s+'https:\/\/%'/i);
  });

  it('enforces date chronology check constraint (end_date >= start_date)', () => {
    expect(sql).toMatch(/CHECK\s*\(\s*end_date\s*>=\s*start_date\s*\)/i);
  });

  it('enforces null-safe positive team size check constraints', () => {
    expect(sql).toMatch(/CHECK\s*\(\s*min_team_size\s+IS\s+NULL\s+OR\s+min_team_size\s*>\s*0\s*\)/i);
    expect(sql).toMatch(/CHECK\s*\(\s*max_team_size\s+IS\s+NULL\s+OR\s+max_team_size\s*>\s*0\s*\)/i);
    expect(sql).toMatch(/CHECK\s*\(\s*min_team_size\s+IS\s+NULL\s+OR\s+max_team_size\s+IS\s+NULL\s+OR\s+max_team_size\s*>=\s*min_team_size\s*\)/i);
  });

  it('enforces status check constraint restricting to valid states', () => {
    expect(sql).toMatch(/CHECK\s*\(\s*status\s+IN\s*\(\s*'Pending'\s*,\s*'Approved'\s*,\s*'Rejected'\s*,\s*'Merged'\s*\)\s*\)/i);
  });

  it('creates partial unique index for active pending submissions to block simultaneous duplicates while allowing resubmission', () => {
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX[\s\S]*?ON\s+pending_event_submissions\s*\(\s*normalized_url\s*,\s*start_date\s*\)[\s\S]*?WHERE\s+status\s*=\s*'Pending'/i);
  });

  it('creates indexes on submitter_id and status', () => {
    expect(sql).toMatch(/CREATE\s+INDEX[\s\S]*?ON\s+pending_event_submissions\s*\(\s*submitter_id\s*\)/i);
    expect(sql).toMatch(/CREATE\s+INDEX[\s\S]*?ON\s+pending_event_submissions\s*\(\s*status\s*\)/i);
  });

  it('attaches automatic updated_at trigger on pending_event_submissions', () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_pending_event_submissions_updated_at/i);
  });
});

describe('0006_create_event_action_records.sql Migration DDL', () => {
  const migrationPath = path.resolve(__dirname, '../../../supabase/migrations/0006_create_event_action_records.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('enforces Row Level Security explicitly on event_action_records', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+event_action_records\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i);
  });

  it('enforces foreign key with ON DELETE RESTRICT on actor_id referencing participants', () => {
    expect(sql).toMatch(/actor_id[\s\S]*?REFERENCES\s+participants\s*\(\s*id\s*\)\s+ON\s+DELETE\s+RESTRICT/i);
  });

  it('defines target_id as UUID without hard-coupling to unmerged tables', () => {
    expect(sql).toMatch(/target_id\s+UUID\s+NOT\s+NULL/i);
  });

  it('defines safe_state_summary as JSONB NOT NULL', () => {
    expect(sql).toMatch(/safe_state_summary\s+JSONB\s+NOT\s+NULL/i);
  });

  it('enforces non-empty check constraints on mandatory text fields', () => {
    expect(sql).toMatch(/target_type\s+VARCHAR\(\d+\)\s+NOT\s+NULL\s+CHECK\s*\(\s*LENGTH\s*\(\s*TRIM\s*\(\s*target_type\s*\)\s*\)\s*>\s*0\s*\)/i);
    expect(sql).toMatch(/action_type\s+VARCHAR\(\d+\)\s+NOT\s+NULL\s+CHECK\s*\(\s*LENGTH\s*\(\s*TRIM\s*\(\s*action_type\s*\)\s*\)\s*>\s*0\s*\)/i);
    expect(sql).toMatch(/reason\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*LENGTH\s*\(\s*TRIM\s*\(\s*reason\s*\)\s*\)\s*>\s*0\s*\)/i);
    expect(sql).toMatch(/outcome\s+VARCHAR\(\d+\)\s+NOT\s+NULL\s+CHECK\s*\(\s*LENGTH\s*\(\s*TRIM\s*\(\s*outcome\s*\)\s*\)\s*>\s*0\s*\)/i);
  });

  it('creates performance indexes on target_id, actor_id, created_at, and action_type', () => {
    expect(sql).toMatch(/CREATE\s+INDEX[\s\S]*?ON\s+event_action_records\s*\(\s*target_id\s*\)/i);
    expect(sql).toMatch(/CREATE\s+INDEX[\s\S]*?ON\s+event_action_records\s*\(\s*actor_id\s*\)/i);
    expect(sql).toMatch(/CREATE\s+INDEX[\s\S]*?ON\s+event_action_records\s*\(\s*created_at\s+DESC\s*\)/i);
    expect(sql).toMatch(/CREATE\s+INDEX[\s\S]*?ON\s+event_action_records\s*\(\s*action_type\s*\)/i);
  });

  it('attaches ADMIN role enforcement trigger on actor_id', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+check_event_action_actor_role/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_check_event_action_actor_role\s+BEFORE\s+INSERT\s+ON\s+event_action_records/i);
  });

  it('attaches append-only triggers preventing UPDATE, DELETE, and TRUNCATE', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+prevent_event_action_modification/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_event_action_records_prevent_modification\s+BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+event_action_records/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_event_action_records_prevent_truncate\s+BEFORE\s+TRUNCATE\s+ON\s+event_action_records/i);
  });
});

describe('0007_create_events_table.sql Migration DDL', () => {
  const migrationPath = path.resolve(__dirname, '../../../supabase/migrations/0007_create_events_table.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('enforces Row Level Security explicitly on events table', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+events\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i);
  });

  it('defines required columns with correct types including is_link_disabled', () => {
    expect(sql).toMatch(/title\s+VARCHAR\(150\)\s+NOT\s+NULL/i);
    expect(sql).toMatch(/official_url\s+VARCHAR\(2048\)\s+NOT\s+NULL/i);
    expect(sql).toMatch(/normalized_url\s+VARCHAR\(2048\)\s+NOT\s+NULL/i);
    expect(sql).toMatch(/start_date\s+TIMESTAMPTZ\s+NOT\s+NULL/i);
    expect(sql).toMatch(/end_date\s+TIMESTAMPTZ\s+NOT\s+NULL/i);
    expect(sql).toMatch(/format\s+VARCHAR\(50\)\s+NOT\s+NULL/i);
    expect(sql).toMatch(/is_link_disabled\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE/i);
    expect(sql).toMatch(/status\s+VARCHAR\(20\)\s+NOT\s+NULL\s+DEFAULT\s+'Published'/i);
  });

  it('enforces HTTPS check constraint on official_url', () => {
    expect(sql).toMatch(/CHECK\s*\(\s*official_url\s+LIKE\s+'https:\/\/%'/i);
  });

  it('enforces date chronology check constraint (end_date >= start_date)', () => {
    expect(sql).toMatch(/CHECK\s*\(\s*end_date\s*>=\s*start_date\s*\)/i);
  });

  it('enforces null-safe positive team size check constraints', () => {
    expect(sql).toMatch(/CHECK\s*\(\s*min_team_size\s+IS\s+NULL\s+OR\s+min_team_size\s*>\s*0\s*\)/i);
    expect(sql).toMatch(/CHECK\s*\(\s*max_team_size\s+IS\s+NULL\s+OR\s+max_team_size\s*>\s*0\s*\)/i);
    expect(sql).toMatch(/CHECK\s*\(\s*min_team_size\s+IS\s+NULL\s+OR\s+max_team_size\s+IS\s+NULL\s+OR\s+max_team_size\s*>=\s*min_team_size\s*\)/i);
  });

  it('enforces status check constraint restricting to valid states', () => {
    expect(sql).toMatch(/CHECK\s*\(\s*status\s+IN\s*\(\s*'Published'\s*,\s*'Archived'\s*,\s*'Disabled'\s*\)\s*\)/i);
  });

  it('creates unique index on normalized_url and start_date for deduplication', () => {
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX[\s\S]*?ON\s+events\s*\(\s*normalized_url\s*,\s*start_date\s*\)/i);
  });

  it('creates query indexes on status, start_date, end_date, and format', () => {
    expect(sql).toMatch(/CREATE\s+INDEX[\s\S]*?ON\s+events\s*\(\s*status\s*\)/i);
    expect(sql).toMatch(/CREATE\s+INDEX[\s\S]*?ON\s+events\s*\(\s*start_date\s*\)/i);
    expect(sql).toMatch(/CREATE\s+INDEX[\s\S]*?ON\s+events\s*\(\s*end_date\s*\)/i);
    expect(sql).toMatch(/CREATE\s+INDEX[\s\S]*?ON\s+events\s*\(\s*format\s*\)/i);
  });

  it('attaches automatic updated_at trigger on events', () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_events_updated_at/i);
  });

  it('adds foreign key constraint on pending_event_submissions referencing events', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+pending_event_submissions[\s\S]*?ADD\s+CONSTRAINT\s+fk_canonical_event[\s\S]*?FOREIGN\s+KEY\s*\(\s*canonical_event_id\s*\)\s+REFERENCES\s+events\s*\(\s*id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i);
  });
});

describe('0008_create_verification_guard_helpers.sql Migration DDL', () => {
  const migrationPath = path.resolve(__dirname, '../../../supabase/migrations/0008_create_verification_guard_helpers.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('defines is_participant_verified function accepting UUID parameter and returning BOOLEAN', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+is_participant_verified\s*\(\s*p_participant_id\s+UUID\s*\)\s+RETURNS\s+BOOLEAN/i);
  });

  it('declares function as STABLE and SECURITY DEFINER', () => {
    expect(sql).toMatch(/LANGUAGE\s+sql/i);
    expect(sql).toMatch(/STABLE/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
  });

  it('coalesces participant verification state with fallback to FALSE', () => {
    expect(sql).toMatch(/SELECT\s+COALESCE\s*\(\s*\(\s*SELECT\s+is_verified\s+FROM\s+participants\s+WHERE\s+id\s*=\s*p_participant_id\s*\)\s*,\s*FALSE\s*\)/i);
  });
});

describe('0009_protect_admin_role_provisioning.sql Migration DDL', () => {
  const migrationPath = path.resolve(__dirname, '../../../supabase/migrations/0009_protect_admin_role_provisioning.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('defines provision_admin_participant function returning SETOF participants', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+provision_admin_participant\s*\(\s*p_firebase_uid\s+VARCHAR\(\d+\)\s*,\s*p_email\s+VARCHAR\(\d+\)\s*,\s*p_full_name\s+VARCHAR\(\d+\)\s*\)\s+RETURNS\s+SETOF\s+participants/i);
  });

  it('declares function with SECURITY DEFINER and plpgsql language', () => {
    expect(sql).toMatch(/LANGUAGE\s+plpgsql/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
  });

  it('upserts participant with role ADMIN and is_verified TRUE', () => {
    expect(sql).toMatch(/INSERT\s+INTO\s+participants\s*\(\s*firebase_uid,\s*email,\s*full_name,\s*role,\s*is_verified\s*\)\s*VALUES\s*\(\s*p_firebase_uid,\s*p_email,\s*p_full_name,\s*'ADMIN',\s*TRUE\s*\)/i);
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(\s*firebase_uid\s*\)\s*DO\s+UPDATE/i);
    expect(sql).toMatch(/SET\s+role\s*=\s*'ADMIN'/i);
    expect(sql).toMatch(/is_verified\s*=\s*TRUE/i);
    expect(sql).toMatch(/RETURNING\s+\*;/i);
  });

  it('adds descriptive operator documentation comment on the function', () => {
    expect(sql).toMatch(/COMMENT\s+ON\s+FUNCTION\s+provision_admin_participant/i);
    expect(sql).toMatch(/authorized\s+deployment\s+operator/i);
  });
});

describe('0010_add_participant_suspension.sql Migration DDL', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0010_add_participant_suspension.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('adds is_suspended with a safe default of FALSE', () => {
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+is_suspended\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE/i);
  });

  it('adds nullable suspended_at timestamp', () => {
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+suspended_at\s+TIMESTAMPTZ/i);
  });

  it('indexes suspended accounts for auth lookups', () => {
    expect(sql).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_participants_is_suspended/i);
    expect(sql).toMatch(/WHERE\s+is_suspended\s*=\s*TRUE/i);
  });
});

describe('0011_create_team_recruitment_tables.sql Migration DDL (US-012 / #118)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0011_create_team_recruitment_tables.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('enforces Row Level Security explicitly on all 6 recruitment tables', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+teams\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+team_memberships\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+team_vacancies\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+team_requests\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+participant_notifications\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+event_availability\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i);
  });

  it('ensures team_memberships table schema guards profile.repository.ts areConfirmedTeammates query', () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+team_memberships/i);
    expect(sql).toMatch(/team_id\s+UUID\s+NOT\s+NULL/i);
    expect(sql).toMatch(/participant_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+participants\(id\)/i);
    expect(sql).toMatch(/status\s+VARCHAR\(20\)\s+NOT\s+NULL\s+DEFAULT\s+'Confirmed'/i);
    expect(sql).toMatch(/CHECK\s*\(\s*status\s+IN\s*\(\s*'Confirmed'\s*,\s*'Removed'\s*,\s*'Released'\s*\)\s*\)/i);
  });

  it('enforces FR-083 single confirmed membership per participant per event via partial unique index', () => {
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_team_memberships_confirmed_per_event\s+ON\s+team_memberships\s*\(\s*event_id,\s*participant_id\s*\)\s+WHERE\s+status\s*=\s*'Confirmed'/i
    );
  });

  it('enforces single confirmed owner per team and single pending invitation per invitee', () => {
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_team_memberships_one_owner\s+ON\s+team_memberships\s*\(\s*team_id\s*\)\s+WHERE\s+role\s*=\s*'Owner'\s+AND\s+status\s*=\s*'Confirmed'/i
    );
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_team_requests_pending_invite\s+ON\s+team_requests\s*\(\s*team_id,\s*participant_id\s*\)\s+WHERE\s+request_type\s*=\s*'Invitation'\s+AND\s+status\s*=\s*'Pending'/i
    );
  });

  it('enforces strict team domain constraints for pitch, goals, hours, status, and communication links', () => {
    expect(sql).toMatch(/pitch\s+VARCHAR\(500\)\s+NOT\s+NULL/i);
    expect(sql).toMatch(/goal\s+VARCHAR\(30\)\s+NOT\s+NULL\s+CHECK\s*\(\s*goal\s+IN\s*\(\s*'Learning'\s*,\s*'Project Completion'\s*,\s*'Competitive'\s*\)\s*\)/i);
    expect(sql).toMatch(/commitment_hours\s+NUMERIC\(4,1\)\s+NOT\s+NULL\s+CHECK\s*\(\s*commitment_hours\s*>=\s*0\s+AND\s+commitment_hours\s*<=\s*168\.0\s*\)/i);
    expect(sql).toMatch(/recruitment_status\s+VARCHAR\(20\)\s+NOT\s+NULL\s+DEFAULT\s+'Open'/i);
    expect(sql).toMatch(/CHECK\s*\(\s*recruitment_status\s+IN\s*\(\s*'Open'\s*,\s*'Locked'\s*,\s*'Disbanded'\s*\)\s*\)/i);
    expect(sql).toMatch(/communication_link\s+VARCHAR\(2048\)\s+CHECK\s*\(\s*communication_link\s+IS\s+NULL\s+OR\s*\(\s*communication_link\s+LIKE\s+'https:\/\/%'/i);
  });

  it('preserves historical integrity: RESTRICT on participant deletion for teams and memberships', () => {
    expect(sql).toMatch(/owner_participant_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+participants\(id\)\s+ON\s+DELETE\s+RESTRICT/i);
    expect(sql).toMatch(/participant_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+participants\(id\)\s+ON\s+DELETE\s+RESTRICT/i);
    expect(sql).toMatch(/CONSTRAINT\s+fk_team_memberships_team_event\s+FOREIGN\s+KEY\s*\(\s*team_id,\s*event_id\s*\)\s+REFERENCES\s+teams\s*\(\s*id,\s*event_id\s*\)\s+ON\s+DELETE\s+RESTRICT/i);
  });

  it('enforces vacancy skills cardinality constraint of at most 10 skills', () => {
    expect(sql).toMatch(/cardinality\(skills\)\s*<=\s*10/i);
  });

  it('attaches automatic set_updated_at triggers across mutable tables', () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_teams_updated_at/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_team_memberships_updated_at/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_team_vacancies_updated_at/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_team_requests_updated_at/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_event_availability_updated_at/i);
  });
});

describe('0012_create_team_with_owner_function.sql Migration DDL', () => {
  const migrationPath = path.resolve(__dirname, '../../../supabase/migrations/0012_create_team_with_owner_function.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('declares create_team_with_owner function with SECURITY DEFINER and search_path = public', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+create_team_with_owner/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
  });

  it('enforces serialisation locks: FOR UPDATE on participants and FOR SHARE on events', () => {
    expect(sql).toMatch(/FROM\s+participants[\s\S]*?FOR\s+UPDATE/i);
    expect(sql).toMatch(/FROM\s+events[\s\S]*?FOR\s+SHARE/i);
  });

  it('raises explicit domain exceptions with P0001 code for failure conditions', () => {
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'PARTICIPANT_NOT_ELIGIBLE'\s+USING\s+ERRCODE\s*=\s*'P0001'/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'EVENT_NOT_FOUND'\s+USING\s+ERRCODE\s*=\s*'P0001'/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'EVENT_NOT_RECRUITING'\s+USING\s+ERRCODE\s*=\s*'P0001'/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'ALREADY_CONFIRMED_MEMBER'\s+USING\s+ERRCODE\s*=\s*'P0001'/i);
  });

  it('secures function from anon and public execution and grants only to service_role', () => {
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+create_team_with_owner[\s\S]*?FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+create_team_with_owner[\s\S]*?TO\s+service_role/i);
  });

  it('updates participant event availability to false and cancels pending requests with OWNER_CREATED_TEAM', () => {
    expect(sql).toMatch(/UPDATE\s+event_availability\s+SET\s+is_looking\s*=\s*FALSE/i);
    expect(sql).toMatch(/cancel_reason\s*=\s*'OWNER_CREATED_TEAM'/i);
  });
});

describe('0013_create_team_listing_functions.sql Migration DDL', () => {
  const migrationPath = path.resolve(__dirname, '../../../supabase/migrations/0013_create_team_listing_functions.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('declares all four listing management functions with SECURITY DEFINER and search_path = public', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+lock_team_for_owner_mutation/i);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+update_team_listing/i);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+add_team_vacancy/i);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+update_team_vacancy/i);
    const securityDefinerCount = (sql.match(/SECURITY\s+DEFINER/gi) || []).length;
    expect(securityDefinerCount).toBeGreaterThanOrEqual(4);
  });

  it('enforces serialisation and status checks in lock_team_for_owner_mutation', () => {
    expect(sql).toMatch(/FROM\s+teams[\s\S]*?FOR\s+UPDATE/i);
    expect(sql).toMatch(/FROM\s+events[\s\S]*?FOR\s+SHARE/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'TEAM_NOT_FOUND'/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'FORBIDDEN_NOT_TEAM_OWNER'/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'TEAM_NOT_MUTABLE'/i);
  });

  it('allows explicit clearing of communication_link via JSONB existence operator', () => {
    expect(sql).toMatch(/p_patch\s*\?\s*'communication_link'/i);
  });

  it('calculates capacity boundaries and raises CAPACITY_EXCEEDED with structured DETAIL in add_team_vacancy', () => {
    expect(sql).toMatch(/SELECT\s+COALESCE\(\s*max_team_size,\s*4\s*\)/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'CAPACITY_EXCEEDED'/i);
    expect(sql).toMatch(/DETAIL\s*=\s*jsonb_build_object\s*\(\s*'max'/i);
  });

  it('scopes vacancy update strictly to team_id and vacancy id', () => {
    expect(sql).toMatch(/WHERE\s+id\s*=\s*p_vacancy\s+AND\s+team_id\s*=\s*p_team/i);
  });

  it('secures all four functions from public/anon access and grants only to service_role', () => {
    const revokeCount = (sql.match(/REVOKE\s+ALL\s+ON\s+FUNCTION/gi) || []).length;
    const grantCount = (sql.match(/GRANT\s+EXECUTE\s+ON\s+FUNCTION/gi) || []).length;
    expect(revokeCount).toBe(4);
    expect(grantCount).toBe(4);
  });
});


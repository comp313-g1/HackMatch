import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Supabase migration ordering', () => {
  it('uses each numeric migration version exactly once', () => {
    const migrationDirectory = path.resolve(__dirname, '../../../supabase/migrations');
    const versions = fs
      .readdirSync(migrationDirectory)
      .map((name) => /^(\d+)_/.exec(name)?.[1])
      .filter((version): version is string => Boolean(version));
    const duplicates = versions.filter(
      (version, index) => versions.indexOf(version) !== index
    );

    expect(duplicates).toEqual([]);
  });
});

describe('0031_approve_team_application.sql atomic approval DDL (#190)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0031_approve_team_application.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('creates a service-role-only security-definer approval function', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+approve_team_application/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE[\s\S]*TO\s+service_role/i);
  });

  it('serializes participant-event and team placement with the invitation lock keys', () => {
    expect(sql).toMatch(/pg_advisory_xact_lock[\s\S]*hackmatch:accept:participant-event/i);
    expect(sql).toMatch(/pg_advisory_xact_lock[\s\S]*hackmatch:accept:team/i);
  });

  it('revalidates owner, pending state, recruiting state, applicant, slot, and capacity', () => {
    expect(sql).toMatch(/owner_participant_id\s*<>\s*p_actor/i);
    expect(sql).toMatch(/v_req\.status\s*<>\s*'Pending'/i);
    expect(sql).toMatch(/v_team\.recruitment_status\s*<>\s*'Open'/i);
    expect(sql).toMatch(/v_event\.status\s*<>\s*'Published'/i);
    expect(sql).toMatch(/v_applicant\.is_verified\s+IS\s+NOT\s+TRUE/i);
    expect(sql).toMatch(/v_vacancy\.status\s*<>\s*'Open'/i);
    expect(sql).toMatch(/v_member_count\s*>=\s*v_max_team_size/i);
    expect(sql).toMatch(/uq_team_memberships_confirmed_per_event|unique_violation/i);
  });

  it('commits availability, membership, vacancy, request, and applicant alert together', () => {
    expect(sql).toMatch(/UPDATE\s+event_availability[\s\S]*event_id\s*=\s*v_team\.event_id/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+team_memberships/i);
    expect(sql).toMatch(/UPDATE\s+team_vacancies[\s\S]*status\s*=\s*'Filled'/i);
    expect(sql).toMatch(/UPDATE\s+team_requests[\s\S]*status\s*=\s*'Accepted'/i);
    expect(sql).toMatch(/team_application_approved/i);
  });
});

describe('0032_cancel_competing_requests_after_approval.sql cascade DDL (#191)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0032_cancel_competing_requests_after_approval.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('wraps #190 approval behind a secured service-role-only entry point', () => {
    expect(sql).toMatch(
      /ALTER\s+FUNCTION\s+approve_team_application[\s\S]*?RENAME\s+TO\s+approve_team_application_without_cascade/i
    );
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+approve_team_application/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+approve_team_application_without_cascade[\s\S]*?service_role/i
    );
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+approve_team_application[\s\S]*?TO\s+service_role/i
    );
  });

  it('runs the competing-request cascade in the approval transaction', () => {
    const approvalCall = sql.indexOf(
      'approve_team_application_without_cascade(p_actor, p_application)'
    );
    const cascadeCall = sql.indexOf('cancel_competing_requests_on_placement(');

    expect(approvalCall).toBeGreaterThan(-1);
    expect(cascadeCall).toBeGreaterThan(approvalCall);
    expect(sql).toMatch(/'cascade'\s*,\s*v_cascade/i);
    expect(sql).toMatch(/'notice'[\s\S]*competing pending requests were cleared/i);
  });

  it('passes winner, participant, event, team, vacancy, and capacity state', () => {
    expect(sql).toMatch(/p_application\s*,[\s\S]*participant_id[\s\S]*event_id[\s\S]*team_id[\s\S]*vacancy_id[\s\S]*v_team_now_full/i);
    expect(sql).toMatch(/memberCount[\s\S]*>=\s*[\s\S]*maxTeamSize/i);
  });
});

describe('0033_decline_team_application.sql decline DDL (#192)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0033_decline_team_application.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('creates a secured service-role-only decline function', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+decline_team_application/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(sql).toMatch(
      /REVOKE\s+ALL[\s\S]*?FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i
    );
    expect(sql).toMatch(/GRANT\s+EXECUTE[\s\S]*?TO\s+service_role/i);
  });

  it('locks the Application and requires its owner and Pending state', () => {
    expect(sql).toMatch(/request_type\s*=\s*'Application'[\s\S]*?FOR\s+UPDATE/i);
    expect(sql).toMatch(/owner_participant_id\s*<>\s*p_actor/i);
    expect(sql).toMatch(/FORBIDDEN_NOT_TEAM_OWNER/i);
    expect(sql).toMatch(/v_req\.status\s*<>\s*'Pending'/i);
    expect(sql).toMatch(/APPLICATION_NOT_DECLINABLE/i);
  });

  it('declines, releases pending quota, and creates applicant and owner alerts', () => {
    expect(sql).toMatch(/status\s*=\s*'Declined'/i);
    expect(sql).toMatch(/cancel_reason\s*=\s*'OWNER_DECLINED'/i);
    expect(sql).toMatch(/team_application_declined/i);
    expect(sql).toMatch(/'audience'\s*,\s*'applicant'/i);
    expect(sql).toMatch(/'audience'\s*,\s*'owner'/i);
    expect(sql).toMatch(/'pendingQuotaReleased'\s*,\s*TRUE/i);
  });

  it('reports unchanged roster, vacancy, capacity, and availability without mutating them', () => {
    expect(sql).toMatch(/'availabilityChanged'\s*,\s*FALSE/i);
    expect(sql).toMatch(/'membershipChanged'\s*,\s*FALSE/i);
    expect(sql).toMatch(/'vacancyChanged'\s*,\s*FALSE/i);
    expect(sql).toMatch(/'capacityChanged'\s*,\s*FALSE/i);
    expect(sql).not.toMatch(/UPDATE\s+team_memberships/i);
    expect(sql).not.toMatch(/UPDATE\s+team_vacancies/i);
    expect(sql).not.toMatch(/UPDATE\s+event_availability/i);
  });
});

describe('lock min/max/concurrency SQL contract (#212 / US-022 / FR-066)', () => {
  const lockSql = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/0036_lock_team.sql'),
    'utf-8'
  );

  it('enforces GREATEST(2, event min) and COALESCE(event max, 4)', () => {
    expect(lockSql).toMatch(/GREATEST\s*\(\s*2\s*,\s*COALESCE\s*\(\s*v_event\.min_team_size/i);
    expect(lockSql).toMatch(/COALESCE\s*\(\s*v_event\.max_team_size\s*,\s*4\s*\)/i);
  });

  it('raises BELOW_MIN_MEMBERS and ABOVE_MAX_MEMBERS before writing Locked', () => {
    const lockFnIdx = lockSql.indexOf('CREATE OR REPLACE FUNCTION lock_team');
    const lockBody = lockSql.slice(lockFnIdx);
    const belowIdx = lockBody.search(/BELOW_MIN_MEMBERS/i);
    const aboveIdx = lockBody.search(/ABOVE_MAX_MEMBERS/i);
    // Prefer the UPDATE write, not earlier status comparisons.
    const writeIdx = lockBody.search(
      /UPDATE\s+teams[\s\S]*?recruitment_status\s*=\s*'Locked'/i
    );
    expect(belowIdx).toBeGreaterThan(-1);
    expect(aboveIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(aboveIdx);
    expect(writeIdx).toBeGreaterThan(belowIdx);
  });

  it('shares hackmatch:accept:team advisory lock between leave_team and lock_team', () => {
    const leaveIdx = lockSql.indexOf('CREATE OR REPLACE FUNCTION leave_team');
    const lockIdx = lockSql.indexOf('CREATE OR REPLACE FUNCTION lock_team');
    const leaveSql = lockSql.slice(leaveIdx, lockIdx);
    const lockBody = lockSql.slice(lockIdx);
    expect(leaveSql).toMatch(/hackmatch:accept:team:/);
    expect(lockBody).toMatch(/hackmatch:accept:team:/);
  });
});

describe('post-lock mutation guards SQL contract (#210 / US-022 / FR-067)', () => {
  const listingSql = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/0013_create_team_listing_functions.sql'),
    'utf-8'
  );
  const cancelSql = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/0014_create_team_cancellation_functions.sql'),
    'utf-8'
  );
  const removalSql = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/0015_create_team_member_removal_function.sql'),
    'utf-8'
  );
  const leaveLockSql = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/0036_lock_team.sql'),
    'utf-8'
  );

  it('owner mutation guard rejects Locked via recruitment_status <> Open', () => {
    expect(listingSql).toMatch(/lock_team_for_owner_mutation/i);
    expect(listingSql).toMatch(/recruitment_status\s*<>\s*'Open'/i);
    expect(listingSql).toMatch(/TEAM_NOT_MUTABLE/);
  });

  it('vacancy remove and disband go through lock_team_for_owner_mutation', () => {
    expect(cancelSql).toMatch(/remove_team_vacancy/i);
    expect(cancelSql).toMatch(/disband_team/i);
    expect(cancelSql).toMatch(/lock_team_for_owner_mutation/i);
  });

  it('member removal goes through lock_team_for_owner_mutation', () => {
    expect(removalSql).toMatch(/remove_team_member/i);
    expect(removalSql).toMatch(/lock_team_for_owner_mutation/i);
  });

  it('leave_team rejects Locked recruitment after advisory serialization (#210)', () => {
    const leaveIdx = leaveLockSql.indexOf('CREATE OR REPLACE FUNCTION leave_team');
    const lockIdx = leaveLockSql.indexOf('CREATE OR REPLACE FUNCTION lock_team');
    const leaveSql = leaveLockSql.slice(leaveIdx, lockIdx);
    expect(leaveSql).toMatch(/recruitment_status\s*<>\s*'Open'/i);
    expect(leaveSql).toMatch(/TEAM_NOT_MUTABLE/);
    expect(leaveSql).toMatch(/reason',\s*v_team\.recruitment_status/i);
  });
});

describe('0036_lock_team.sql atomic roster lock (#208 / US-022 / FR-066)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0036_lock_team.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(100);
  });

  it('declares lock_team with SECURITY DEFINER and service_role-only execute', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+lock_team/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+lock_team[\s\S]*?FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i
    );
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+lock_team[\s\S]*?TO\s+service_role/i);
  });

  it('serializes with join/leave via shared team advisory lock and teams FOR UPDATE', () => {
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/hackmatch:accept:team:/i);
    expect(sql).toMatch(/FROM\s+teams[\s\S]*?FOR\s+UPDATE/i);
  });

  it('enforces owner, open status, event recruiting, and min/max member bounds', () => {
    expect(sql).toMatch(/FORBIDDEN_NOT_TEAM_OWNER/i);
    expect(sql).toMatch(/ALREADY_LOCKED/i);
    expect(sql).toMatch(/BELOW_MIN_MEMBERS/i);
    expect(sql).toMatch(/ABOVE_MAX_MEMBERS/i);
    expect(sql).toMatch(/GREATEST\s*\(\s*2\s*,\s*COALESCE\s*\(\s*v_event\.min_team_size/i);
    expect(sql).toMatch(/COALESCE\s*\(\s*v_event\.max_team_size\s*,\s*4\s*\)/i);
    expect(sql).toMatch(/EventNotRecruiting/i);
  });

  it('sets Locked + locked_at and cancels Pending requests atomically', () => {
    expect(sql).toMatch(/recruitment_status\s*=\s*'Locked'/i);
    expect(sql).toMatch(/locked_at\s*=\s*v_locked_at/i);
    expect(sql).toMatch(/cancel_reason\s*=\s*'TEAM_LOCKED'/i);
    expect(sql).toMatch(/status\s*=\s*'Canceled'/i);
    expect(sql).toMatch(/resolved_at\s*=\s*now\(\)/i);
    expect(sql).toMatch(/REQUEST_CANCELED_TEAM_LOCKED/i);
    expect(sql).toMatch(/WHERE\s+team_id\s*=\s*p_team[\s\S]*?AND\s+status\s*=\s*'Pending'/i);
  });

  it('updates leave_team to take the shared team advisory lock before FOR UPDATE', () => {
    const leaveIdx = sql.indexOf('CREATE OR REPLACE FUNCTION leave_team');
    const lockIdx = sql.indexOf('CREATE OR REPLACE FUNCTION lock_team');
    expect(leaveIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeGreaterThan(leaveIdx);
    const leaveSql = sql.slice(leaveIdx, lockIdx);
    expect(leaveSql).toMatch(/pg_advisory_xact_lock/i);
    expect(leaveSql).toMatch(/hackmatch:accept:team:/i);
  });
});

describe('0035_add_team_roster_lock_fields.sql roster lock timestamp (#206 / US-022 / FR-066)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0035_add_team_roster_lock_fields.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(100);
  });

  it('adds teams.locked_at as a nullable timestamptz server lock timestamp', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+teams/i);
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+locked_at\s+TIMESTAMPTZ/i);
  });

  it('ties Locked recruitment_status to a non-null locked_at (and forbids locked_at otherwise)', () => {
    expect(sql).toMatch(/chk_teams_locked_at_matches_status/i);
    expect(sql).toMatch(
      /recruitment_status\s*=\s*'Locked'\s+AND\s+locked_at\s+IS\s+NOT\s+NULL/i
    );
    expect(sql).toMatch(
      /recruitment_status\s*<>\s*'Locked'\s+AND\s+locked_at\s+IS\s+NULL/i
    );
  });

  it('indexes locked teams for lock-timestamp lookups', () => {
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_teams_locked_at\s+ON\s+teams\s*\(\s*locked_at\s*\)/i
    );
    expect(sql).toMatch(/WHERE\s+locked_at\s+IS\s+NOT\s+NULL/i);
  });
});

describe('0034_idempotent_application_decisions.sql decision wrappers (#193)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0034_idempotent_application_decisions.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('hides both one-shot functions behind secured service-role wrappers', () => {
    expect(sql).toMatch(
      /ALTER\s+FUNCTION\s+approve_team_application[\s\S]*?RENAME\s+TO\s+approve_team_application_once/i
    );
    expect(sql).toMatch(
      /ALTER\s+FUNCTION\s+decline_team_application[\s\S]*?RENAME\s+TO\s+decline_team_application_once/i
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+approve_team_application_once[\s\S]*?service_role/i
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+decline_team_application_once[\s\S]*?service_role/i
    );
    expect(sql.match(/SECURITY\s+DEFINER/gi)).toHaveLength(2);
    expect(sql.match(/GRANT\s+EXECUTE[\s\S]*?TO\s+service_role/gi)).toHaveLength(2);
  });

  it('returns same-decision approval and decline outcomes without replaying writes', () => {
    expect(sql).toMatch(/v_req\.status\s*=\s*'Accepted'[\s\S]*?v_idempotent\s*:=\s*TRUE/i);
    expect(sql).toMatch(/v_req\.status\s*=\s*'Declined'[\s\S]*?v_idempotent\s*:=\s*TRUE/i);
    expect(sql).toMatch(/'changed'\s*,\s*FALSE/gi);
    expect(sql).toMatch(/'idempotent'\s*,\s*TRUE/gi);
    expect(sql).toMatch(/'alerts'\s*,\s*jsonb_build_array\(\)/i);
    expect(sql).toMatch(/'eventInvitationsCanceled'\s*,\s*0/i);
    expect(sql).not.toMatch(/INSERT\s+INTO/i);
    expect(sql).not.toMatch(/UPDATE\s+(team_requests|team_memberships|team_vacancies|event_availability)/i);
  });

  it('returns explicit existing-outcome conflicts for opposite or stale decisions', () => {
    expect(sql).toMatch(/APPLICATION_DECISION_CONFLICT/i);
    expect(sql).toMatch(/'requestedDecision'\s*,\s*'approve'/i);
    expect(sql).toMatch(/'requestedDecision'\s*,\s*'decline'/i);
    expect(sql).toMatch(/'existingOutcome'\s*,\s*v_req\.status/i);
    expect(sql).toMatch(/'resolvedAt'\s*,\s*v_req\.resolved_at/i);
    expect(sql).toMatch(/'retryable'\s*,\s*FALSE/i);
  });

  it('re-reads state after a concurrent one-shot conflict before deciding the outcome', () => {
    expect(sql).toMatch(/approve_team_application_once\(p_actor,\s*p_application\)/i);
    expect(sql).toMatch(/decline_team_application_once\(p_actor,\s*p_application\)/i);
    expect(sql.match(/WHEN\s+SQLSTATE\s+'P0001'/gi)).toHaveLength(2);
    expect(
      sql.match(
        /SELECT\s+\*\s+INTO\s+v_req[\s\S]*?request_type\s*=\s*'Application'/gi
      )?.length ?? 0
    ).toBeGreaterThanOrEqual(4);
  });
});

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

describe('0014_create_team_cancellation_functions.sql Migration DDL', () => {
  const migrationPath = path.resolve(__dirname, '../../../supabase/migrations/0014_create_team_cancellation_functions.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('declares cancellation and disband functions with SECURITY DEFINER and search_path = public', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+remove_team_vacancy/i);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+disband_team/i);
    const securityDefinerCount = (sql.match(/SECURITY\s+DEFINER/gi) || []).length;
    expect(securityDefinerCount).toBeGreaterThanOrEqual(2);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
  });

  it('scopes cancel statements strictly to vacancy_id/team_id and status = Pending', () => {
    expect(sql).toMatch(/WHERE\s+vacancy_id\s*=\s*p_vacancy\s+AND\s+status\s*=\s*'Pending'/i);
    expect(sql).toMatch(/WHERE\s+team_id\s*=\s*p_team\s+AND\s+status\s*=\s*'Pending'/i);
  });

  it('defines appropriate cancel reasons and dispatches notifications from the RETURNING set', () => {
    expect(sql).toMatch(/cancel_reason\s*=\s*'SLOT_REMOVED'/i);
    expect(sql).toMatch(/cancel_reason\s*=\s*'TEAM_DISBANDED'/i);
    expect(sql).toMatch(/RETURNING\s+participant_id,\s*request_type/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+participant_notifications/i);
    expect(sql).toMatch(/'REQUEST_CANCELED_SLOT_REMOVED'/i);
    expect(sql).toMatch(/'REQUEST_CANCELED_TEAM_DISBANDED'/i);
  });

  it('marks all confirmed memberships as Released including the owner and notifies non-owner members', () => {
    expect(sql).toMatch(/UPDATE\s+team_memberships\s+SET\s+status\s*=\s*'Released'/i);
    expect(sql).toMatch(/WHERE\s+team_id\s*=\s*p_team\s+AND\s+status\s*=\s*'Confirmed'/i);
    expect(sql).toMatch(/WHERE\s+r\.role\s*<>\s*'Owner'/i);
  });

  it('restores availability with NOT EXISTS confirmed check and contains no INSERT into event_availability', () => {
    expect(sql).toMatch(/UPDATE\s+event_availability/i);
    expect(sql).toMatch(/SET\s+is_looking\s*=\s*TRUE/i);
    expect(sql).toMatch(/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+team_memberships/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+event_availability/i);
  });

  it('secures functions from anon/public and grants execute to service_role', () => {
    const revokeCount = (sql.match(/REVOKE\s+ALL\s+ON\s+FUNCTION/gi) || []).length;
    const grantCount = (sql.match(/GRANT\s+EXECUTE\s+ON\s+FUNCTION/gi) || []).length;
    expect(revokeCount).toBe(2);
    expect(grantCount).toBe(2);
  });
});

describe('0015_create_team_member_removal_function.sql Migration DDL (US-012 / #124)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0015_create_team_member_removal_function.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('declares remove_team_member with SECURITY DEFINER and search_path = public', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+remove_team_member/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
  });

  it('uses lock_team_for_owner_mutation to enforce ownership and lifecycle checks', () => {
    expect(sql).toMatch(/lock_team_for_owner_mutation\s*\(\s*p_actor\s*,\s*p_team\s*\)/i);
  });

  it('forbids owner self-removal with CANNOT_REMOVE_OWNER exception', () => {
    expect(sql).toMatch(/IF\s+p_member\s*=\s*v_team\.owner_participant_id\s+THEN/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'CANNOT_REMOVE_OWNER'/i);
  });

  it('raises MEMBER_NOT_FOUND when target participant has no confirmed membership', () => {
    expect(sql).toMatch(/WHERE\s+team_id\s*=\s*p_team\s+AND\s+participant_id\s*=\s*p_member\s+AND\s+status\s*=\s*'Confirmed'/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'MEMBER_NOT_FOUND'/i);
  });

  it('marks membership Removed with removal_reason and dispatches notification', () => {
    expect(sql).toMatch(/UPDATE\s+team_memberships\s+SET\s+status\s*=\s*'Removed'/i);
    expect(sql).toMatch(/removal_reason\s*=\s*p_reason/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+participant_notifications/i);
    expect(sql).toMatch(/'MEMBER_REMOVED'/i);
  });

  it('restores availability guarded by NOT EXISTS confirmed membership and does NOT update team_requests', () => {
    expect(sql).toMatch(/UPDATE\s+event_availability/i);
    expect(sql).toMatch(/SET\s+is_looking\s*=\s*TRUE/i);
    expect(sql).toMatch(/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+team_memberships/i);
    expect(sql).not.toMatch(/UPDATE\s+team_requests/i);
  });

  it('secures function from anon/public and grants execute strictly to service_role', () => {
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+remove_team_member[\s\S]*?FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+remove_team_member[\s\S]*?TO\s+service_role/i);
  });
});

describe('0016_alter_event_availability_for_platform_pool.sql Migration DDL (US-011 / #US-286)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0016_alter_event_availability_for_platform_pool.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('seeds platform availability pool event with deterministic UUID', () => {
    expect(sql).toMatch(/00000000-0000-4000-8000-000000000001/i);
    expect(sql).toMatch(/Platform Availability Pool/i);
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(\s*id\s*\)\s+DO\s+NOTHING/i);
  });

  it('sets default event_id on event_availability table', () => {
    expect(sql).toMatch(/ALTER\s+COLUMN\s+event_id\s+SET\s+DEFAULT\s+'00000000-0000-4000-8000-000000000001'::uuid/i);
  });

  it('adds desired_role, commitment_hours, and goal columns', () => {
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+desired_role\s+VARCHAR\(20\)/i);
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+commitment_hours\s+NUMERIC\(4,1\)/i);
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+goal\s+VARCHAR\(30\)/i);
  });

  it('enforces check constraints on desired_role, commitment_hours (0..168), and goal', () => {
    expect(sql).toMatch(/chk_event_availability_desired_role/i);
    expect(sql).toMatch(/chk_event_availability_commitment_hours/i);
    expect(sql).toMatch(/chk_event_availability_goal/i);
    expect(sql).toMatch(/commitment_hours\s*>=\s*0\s+AND\s+commitment_hours\s*<=\s*168/i);
  });
});

describe('0017_auto_clear_availability_on_confirm.sql Migration DDL (US-011 / #US-287)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0017_auto_clear_availability_on_confirm.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('defines clear_participant_availability_on_confirmed_membership trigger function', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+clear_participant_availability_on_confirmed_membership/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
  });

  it('creates trigger on team_memberships for confirmed status updates/inserts', () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_clear_availability_on_confirmed_membership/i);
    expect(sql).toMatch(/AFTER\s+INSERT\s+OR\s+UPDATE\s+OF\s+status\s+ON\s+team_memberships/i);
    expect(sql).toMatch(/WHEN\s*\(\s*NEW\.status\s*=\s*'Confirmed'\s*\)/i);
  });

  it('updates create_team_with_owner function to clear availability across all pools', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+create_team_with_owner/i);
    expect(sql).toMatch(/UPDATE\s+event_availability[\s\S]*?SET\s+is_looking\s*=\s*FALSE[\s\S]*?WHERE\s+participant_id\s*=\s*p_owner_id[\s\S]*?AND\s+is_looking\s*=\s*TRUE/i);
  });
});

describe('0018_create_team_invitation_issuance.sql Migration DDL (US-017 / FR-048)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0018_create_team_invitation_issuance.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('adds expires_at and requires it for Invitation rows', () => {
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+expires_at\s+TIMESTAMPTZ/i);
    expect(sql).toMatch(/chk_team_requests_invitation_expiry/i);
    expect(sql).toMatch(/request_type\s*<>\s*'Invitation'\s+OR\s+expires_at\s+IS\s+NOT\s+NULL/i);
  });

  it('enforces one pending invitation per vacancy slot', () => {
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_team_requests_pending_invite_per_slot\s+ON\s+team_requests\s*\(\s*vacancy_id\s*\)/i
    );
  });

  it('defines issue_team_invitation with 48-hour expiry and service_role grant', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+issue_team_invitation/i);
    expect(sql).toMatch(/INTERVAL\s+'48 hours'/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+issue_team_invitation\s*\(\s*UUID\s*,\s*UUID\s*,\s*UUID\s*,\s*UUID\s*\)\s+TO\s+service_role/i
    );
  });

  it('raises domain exceptions for eligibility and duplicate quotas', () => {
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'INVITEE_NOT_AVAILABLE'/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'INVITEE_ALREADY_CONFIRMED'/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'DUPLICATE_PENDING_INVITATION'/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'SLOT_PENDING_INVITATION_EXISTS'/i);
  });
});

describe('0019_complete_team_invitation_model.sql Migration DDL (US-017 / #161)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0019_complete_team_invitation_model.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('requires vacancy_id on Pending Invitation rows', () => {
    expect(sql).toMatch(/chk_team_requests_pending_invite_requires_vacancy/i);
    expect(sql).toMatch(
      /request_type\s*=\s*'Invitation'[\s\S]*?status\s*=\s*'Pending'[\s\S]*?vacancy_id\s+IS\s+NULL/i
    );
  });

  it('indexes Pending invitation expiry and invitation status lookups', () => {
    expect(sql).toMatch(/idx_team_requests_pending_invite_expires/i);
    expect(sql).toMatch(/idx_team_requests_invitee_invitation_status/i);
    expect(sql).toMatch(/idx_team_requests_team_invitation_status/i);
  });

  it('defines validity and expiry helper functions with service_role grants', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+team_invitation_is_currently_valid/i);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+mark_team_invitation_expired_if_due/i);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+expire_due_team_invitations/i);
    expect(sql).toMatch(/expires_at\s*<=\s*now\(\)/i);
    expect(sql).toMatch(/status\s*=\s*'Expired'/i);
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+team_invitation_is_currently_valid\s*\(\s*UUID\s*\)\s+TO\s+service_role/i
    );
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+mark_team_invitation_expired_if_due\s*\(\s*UUID\s*\)\s+TO\s+service_role/i
    );
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+expire_due_team_invitations\s*\(\s*INTEGER\s*\)\s+TO\s+service_role/i
    );
  });

  it('writes basic status alerts when marking invitations Expired', () => {
    expect(sql).toMatch(/team_invitation_expired/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+participant_notifications/i);
  });
});

describe('0020_enforce_invitation_pending_quotas.sql Migration DDL (US-017 / #164)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0020_enforce_invitation_pending_quotas.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('replaces issue_team_invitation with explicit invitee/team and per-slot Pending checks', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+issue_team_invitation/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'DUPLICATE_PENDING_INVITATION'/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'SLOT_PENDING_INVITATION_EXISTS'/i);
    expect(sql).toMatch(
      /request_type\s*=\s*'Invitation'\s+AND\s+status\s*=\s*'Pending'/i
    );
  });

  it('keeps unique_violation mapping and service_role execute grant', () => {
    expect(sql).toMatch(/WHEN\s+unique_violation\s+THEN/i);
    expect(sql).toMatch(/uq_team_requests_pending_invite_per_slot/i);
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+issue_team_invitation\s*\(\s*UUID\s*,\s*UUID\s*,\s*UUID\s*,\s*UUID\s*\)\s+TO\s+service_role/i
    );
  });
});

describe('0021_invitation_acceptance_revalidation.sql Migration DDL (US-017 / #165)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0021_invitation_acceptance_revalidation.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('strengthens validity with event recruiting checks and expiry-before-cleanup', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+team_invitation_is_currently_valid/i);
    expect(sql).toMatch(/expires_at\s*<=\s*now\(\)/i);
    expect(sql).toMatch(/v_event_status\s*<>\s*'Published'/i);
  });

  it('defines revalidate_team_invitation_for_acceptance with Expired and slot failures', () => {
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+revalidate_team_invitation_for_acceptance/i
    );
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'INVITATION_EXPIRED'/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'VACANCY_NOT_OPEN'/i);
    expect(sql).toMatch(/mark_team_invitation_expired_if_due/i);
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+revalidate_team_invitation_for_acceptance\s*\(\s*UUID\s*,\s*UUID\s*\)\s+TO\s+service_role/i
    );
  });
});

describe('0022_cancel_team_invitation.sql Migration DDL (US-017 / #166)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0022_cancel_team_invitation.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('defines cancel_team_invitation with owner check, idempotency, and alerts', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+cancel_team_invitation/i);
    expect(sql).toMatch(/FORBIDDEN_NOT_TEAM_OWNER/i);
    expect(sql).toMatch(/INVITATION_NOT_CANCELABLE/i);
    expect(sql).toMatch(/OWNER_CANCELED/i);
    expect(sql).toMatch(/idempotent/i);
    expect(sql).toMatch(/team_invitation_canceled/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+participant_notifications/i);
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+cancel_team_invitation\s*\(\s*UUID\s*,\s*UUID\s*\)\s+TO\s+service_role/i
    );
  });
});

describe('0026_cancel_competing_requests_on_placement.sql Migration DDL (US-019 / #181)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0026_cancel_competing_requests_on_placement.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('defines cascade helper only (accept stays in 0027 / #180)', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+cancel_competing_requests_on_placement/i);
    expect(sql).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+accept_team_invitation/i);
    expect(sql).toMatch(/EVENT_MEMBERSHIP_CONFIRMED/i);
    expect(sql).toMatch(/SLOT_FILLED/i);
    expect(sql).toMatch(/TEAM_FULL/i);
    expect(sql).toMatch(/status\s*=\s*'Withdrawn'/i);
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+cancel_competing_requests_on_placement/i
    );
  });
});

describe('0028_decline_team_invitation.sql Migration DDL (US-019 / #182)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0028_decline_team_invitation.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('defines decline_team_invitation with invitee check, idempotency, and alerts', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+decline_team_invitation/i);
    expect(sql).toMatch(/FORBIDDEN_NOT_INVITEE/i);
    expect(sql).toMatch(/INVITATION_NOT_DECLINABLE/i);
    expect(sql).toMatch(/INVITEE_DECLINED/i);
    expect(sql).toMatch(/idempotent/i);
    expect(sql).toMatch(/team_invitation_declined/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+participant_notifications/i);
    expect(sql).toMatch(/p_actor\s+IS\s+NULL\s+OR\s+p_invitation\s+IS\s+NULL/i);
    expect(sql).toMatch(/RETURNING\s+id\s*,\s*created_at/i);
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+decline_team_invitation\s*\(\s*UUID\s*,\s*UUID\s*\)\s+TO\s+service_role/i
    );
  });

  it('rejects clock-expired invitations while committing Expired instead of Declined', () => {
    const expiryGuard = sql.indexOf("v_req.expires_at <= now()");
    const declinedUpdate = sql.indexOf("status = 'Declined'");

    expect(expiryGuard).toBeGreaterThan(-1);
    expect(expiryGuard).toBeLessThan(declinedUpdate);
    expect(sql).toMatch(/status\s*=\s*'Expired'[\s\S]*'error',\s*'INVITATION_EXPIRED'/i);
  });

  it('reports the exact decline effects and guarantees roster state is unchanged', () => {
    expect(sql).toMatch(/'invitationChanged',\s*TRUE/i);
    expect(sql).toMatch(/'ownerAlertCreated',\s*TRUE/i);
    expect(sql).toMatch(/'inviteeAlertCreated',\s*TRUE/i);
    expect(sql).toMatch(/'availabilityChanged',\s*FALSE/i);
    expect(sql).toMatch(/'membershipChanged',\s*FALSE/i);
    expect(sql).toMatch(/'vacancyChanged',\s*FALSE/i);
  });
});

describe('0024_withdraw_team_application.sql Migration DDL (US-018 / #175)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0024_withdraw_team_application.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('defines withdraw_team_application with applicant check, idempotency, and alerts', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+withdraw_team_application/i);
    expect(sql).toMatch(/FORBIDDEN_NOT_APPLICANT/i);
    expect(sql).toMatch(/APPLICATION_NOT_WITHDRAWABLE/i);
    expect(sql).toMatch(/APPLICANT_WITHDRAWN/i);
    expect(sql).toMatch(/idempotent/i);
    expect(sql).toMatch(/team_application_withdrawn/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+participant_notifications/i);
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+withdraw_team_application\s*\(\s*UUID\s*,\s*UUID\s*\)\s+TO\s+service_role/i
    );
  });
});

describe('0023_create_team_application_model.sql Migration DDL (US-018 / #170)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0023_create_team_application_model.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('adds message column, Pending Application vacancy CHECK, and quota indexes', () => {
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+message\s+VARCHAR\(250\)/i);
    expect(sql).toMatch(/chk_team_requests_application_message_length/i);
    expect(sql).toMatch(/chk_team_requests_pending_application_requires_vacancy/i);
    expect(sql).toMatch(/uq_team_requests_pending_application/i);
    expect(sql).toMatch(/idx_team_requests_pending_application_per_event/i);
    expect(sql).toMatch(/idx_team_requests_applicant_application_status/i);
    expect(sql).toMatch(/idx_team_requests_team_application_status/i);
  });

  it('defines submit_team_application with atomic limit/duplicate checks and service_role grant', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+submit_team_application/i);
    expect(sql).toMatch(/v_pending_count\s*>=\s*3/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'APPLICATION_PENDING_LIMIT'/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'DUPLICATE_PENDING_APPLICATION'/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'APPLICATION_MESSAGE_TOO_LONG'/i);
    expect(sql).toMatch(/request_type\s*,\s*[\s\S]*'Application'/i);
    expect(sql).toMatch(/expires_at[\s\S]*NULL/i);
    expect(sql).toMatch(/team_application_submitted/i);
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+submit_team_application\s*\(\s*UUID\s*,\s*UUID\s*,\s*UUID\s*,\s*TEXT\s*\)\s+TO\s+service_role/i
    );
  });
});

describe('0025_prioritize_application_submission_errors.sql Migration DDL (US-018 / #176)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0025_prioritize_application_submission_errors.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('replaces submit_team_application and preserves service-role-only execution', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+submit_team_application/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i);
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+submit_team_application\s*\(\s*UUID\s*,\s*UUID\s*,\s*UUID\s*,\s*TEXT\s*\)\s+TO\s+service_role/i
    );
  });

  it('checks duplicate Pending Application before the broader event limit', () => {
    const duplicateCheck = sql.indexOf("RAISE EXCEPTION 'DUPLICATE_PENDING_APPLICATION'");
    const quotaCheck = sql.indexOf("RAISE EXCEPTION 'APPLICATION_PENDING_LIMIT'");

    expect(duplicateCheck).toBeGreaterThan(-1);
    expect(quotaCheck).toBeGreaterThan(-1);
    expect(duplicateCheck).toBeLessThan(quotaCheck);
    expect(sql).toMatch(/'teamId'\s*,\s*p_team/i);
    expect(sql).toMatch(/'existingApplicationId'\s*,\s*v_duplicate_application_id/i);
  });

  it('retains the unique-index race fallback and actionable quota details', () => {
    expect(sql).toMatch(/WHEN\s+unique_violation[\s\S]*DUPLICATE_PENDING_APPLICATION/i);
    expect(sql).toMatch(/v_pending_count\s*>=\s*3/i);
    expect(sql).toMatch(/'limit'\s*,\s*3/i);
    expect(sql).toMatch(/'pendingCount'\s*,\s*v_pending_count/i);
    expect(sql).toMatch(/'eventId'\s*,\s*v_team\.event_id/i);
  });
});

describe('0027_accept_team_invitation.sql Migration DDL (US-019 / #180)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0027_accept_team_invitation.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('defines a service-role-only atomic acceptance RPC', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+accept_team_invitation/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+accept_team_invitation[\s\S]*?FROM\s+PUBLIC,\s*anon,\s*authenticated/i
    );
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+accept_team_invitation[\s\S]*?TO\s+service_role/i
    );
  });

  it('locks and revalidates the invitation, team, event, vacancy, and invitee', () => {
    expect(sql).toMatch(/FROM\s+team_requests[\s\S]*?FOR\s+UPDATE/i);
    expect(sql).toMatch(/FROM\s+teams[\s\S]*?FOR\s+UPDATE/i);
    expect(sql).toMatch(/FROM\s+events[\s\S]*?FOR\s+SHARE/i);
    expect(sql).toMatch(/FROM\s+team_vacancies[\s\S]*?FOR\s+UPDATE/i);
    expect(sql).toMatch(/FROM\s+participants[\s\S]*?FOR\s+SHARE/i);
    expect(sql).toMatch(/FORBIDDEN_NOT_INVITEE/i);
    expect(sql).toMatch(/INVITATION_EXPIRED/i);
    expect(sql).toMatch(/INVITATION_NOT_ACCEPTABLE/i);
    expect(sql).toMatch(/TEAM_NOT_MUTABLE/i);
    expect(sql).toMatch(/EVENT_NOT_RECRUITING/i);
    expect(sql).toMatch(/VACANCY_NOT_OPEN/i);
    expect(sql).toMatch(/INVITEE_NOT_ELIGIBLE/i);
  });

  it('enforces one membership per event and the official capacity boundary', () => {
    expect(sql).toMatch(
      /FROM\s+team_memberships[\s\S]*?event_id\s*=\s*v_team\.event_id[\s\S]*?participant_id\s*=\s*p_actor[\s\S]*?status\s*=\s*'Confirmed'/i
    );
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'INVITEE_ALREADY_CONFIRMED'/i);
    expect(sql).toMatch(/SELECT\s+COUNT\(\*\)::INTEGER\s+INTO\s+v_member_count/i);
    expect(sql).toMatch(/COALESCE\(v_event\.max_team_size,\s*4\)/i);
    expect(sql).toMatch(/v_member_count\s*>=\s*v_max_team_size/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'CAPACITY_EXCEEDED'/i);
  });

  it('commits membership, filled vacancy, accepted invitation, and availability together', () => {
    expect(sql).toMatch(/UPDATE\s+event_availability[\s\S]*?is_looking\s*=\s*FALSE/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+team_memberships/i);
    expect(sql).toMatch(/'Member'\s*,\s*'Confirmed'/i);
    expect(sql).toMatch(/UPDATE\s+team_vacancies[\s\S]*?status\s*=\s*'Filled'/i);
    expect(sql).toMatch(/UPDATE\s+team_requests[\s\S]*?status\s*=\s*'Accepted'/i);
    expect(sql).toMatch(/team_invitation_accepted/i);
  });

  it('runs competing-request cascade after membership commit (#181)', () => {
    expect(sql).toMatch(/cancel_competing_requests_on_placement\s*\(/i);
    expect(sql).toMatch(/v_team_now_full/i);
    expect(sql).toMatch(/'cascade'\s*,\s*v_cascade/i);
    expect(sql).toMatch(/competing pending requests/i);
  });

  it('persists clock expiry through a failure payload instead of rolling it back', () => {
    const expiryUpdate = sql.indexOf("status = 'Expired'");
    const expiryPayload = sql.indexOf("'error', 'INVITATION_EXPIRED'");

    expect(expiryUpdate).toBeGreaterThan(-1);
    expect(expiryPayload).toBeGreaterThan(expiryUpdate);
    expect(sql).toMatch(/'expiresAt'\s*,\s*v_req\.expires_at/i);
  });
});

describe('0029_leave_team.sql Migration DDL (US-019 / #183 / FR-059)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0029_leave_team.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(sql.length).toBeGreaterThan(100);
  });

  it('declares leave_team with SECURITY DEFINER and search_path = public', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+leave_team/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
  });

  it('rejects owner leave with CANNOT_LEAVE_AS_OWNER', () => {
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'CANNOT_LEAVE_AS_OWNER'/i);
    expect(sql).toMatch(/owner_participant_id\s*=\s*p_actor/i);
  });

  it('rejects non-mutable teams and non-recruiting events with TEAM_NOT_MUTABLE', () => {
    expect(sql).toMatch(/recruitment_status\s*<>\s*'Open'/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'TEAM_NOT_MUTABLE'/i);
    expect(sql).toMatch(/EventNotRecruiting/i);
  });

  it('requires confirmed membership and marks it Removed with MEMBER_LEFT', () => {
    expect(sql).toMatch(/status\s*=\s*'Confirmed'/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'MEMBER_NOT_FOUND'/i);
    expect(sql).toMatch(/UPDATE\s+team_memberships[\s\S]*?status\s*=\s*'Removed'/i);
    expect(sql).toMatch(/removal_reason\s*=\s*'MEMBER_LEFT'/i);
  });

  it('restores availability and alerts owner without touching team_requests', () => {
    expect(sql).toMatch(/UPDATE\s+event_availability/i);
    expect(sql).toMatch(/SET\s+is_looking\s*=\s*TRUE/i);
    expect(sql).toMatch(/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+team_memberships/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+participant_notifications/i);
    expect(sql).toMatch(/'MEMBER_LEFT'/i);
    expect(sql).not.toMatch(/UPDATE\s+team_requests/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+event_availability/i);
  });

  it('secures function from anon/public and grants execute to service_role', () => {
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+leave_team[\s\S]*?FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+leave_team[\s\S]*?TO\s+service_role/i);
  });
});

describe('0030_handle_concurrent_invitation_acceptance.sql Migration DDL (US-019 / #184)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0030_handle_concurrent_invitation_acceptance.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('wraps the existing atomic acceptance function behind a secured serialized entry point', () => {
    expect(sql).toMatch(
      /ALTER\s+FUNCTION\s+accept_team_invitation[\s\S]*?RENAME\s+TO\s+accept_team_invitation_unserialized/i
    );
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+accept_team_invitation/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+accept_team_invitation_unserialized[\s\S]*?service_role/i
    );
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+accept_team_invitation[\s\S]*?TO\s+service_role/i
    );
  });

  it('acquires participant/event then team transaction locks before the core RPC', () => {
    const participantLock = sql.indexOf('hackmatch:accept:participant-event:');
    const teamLock = sql.indexOf('hackmatch:accept:team:');
    const coreCall = sql.indexOf('accept_team_invitation_unserialized(p_actor, p_invitation)');

    expect(participantLock).toBeGreaterThan(-1);
    expect(teamLock).toBeGreaterThan(participantLock);
    expect(coreCall).toBeGreaterThan(teamLock);
    expect(sql).toMatch(/pg_advisory_xact_lock\s*\(/i);
  });

  it('returns explicit conflicts for same-invitation and competing-cascade winners', () => {
    expect(sql).toMatch(/INVITATION_ACCEPTANCE_CONFLICT/i);
    expect(sql).toMatch(/ALREADY_ACCEPTED/i);
    expect(sql).toMatch(/EVENT_MEMBERSHIP_CONFIRMED/i);
    expect(sql).toMatch(/SLOT_FILLED/i);
    expect(sql).toMatch(/TEAM_FULL/i);
    expect(sql).toMatch(/'retryable',\s*FALSE/i);
  });

  it('converts residual database concurrency failures into retryable conflicts', () => {
    expect(sql).toMatch(/deadlock_detected/i);
    expect(sql).toMatch(/serialization_failure/i);
    expect(sql).toMatch(/lock_not_available/i);
    expect(sql).toMatch(/DATABASE_CONCURRENCY_RETRY/i);
    expect(sql).toMatch(/'retryable',\s*TRUE/i);
  });
});

describe('0038_moderation_enforcement_fields.sql decide actions (US-026 / #242)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0038_moderation_enforcement_fields.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('adds team hide and URL-removal fields', () => {
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+moderation_hidden_at\s+TIMESTAMPTZ/i);
    expect(sql).toMatch(/moderation_status/i);
    expect(sql).toMatch(/link_removal_notice/i);
    expect(sql).toMatch(/chk_teams_moderation_hidden_matches_status/i);
  });

  it('adds case resolution metadata for decide actions', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+moderation_cases/i);
    expect(sql).toMatch(/resolved_at\s+TIMESTAMPTZ/i);
    expect(sql).toMatch(/last_action_type/i);
    expect(sql).toMatch(/dismiss.*redact.*warn.*hide.*disable_url/is);
  });
});

describe('0037_create_moderation_cases.sql moderation queue schema (US-026 / #239 / FR-075)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/0037_create_moderation_cases.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(100);
  });

  it('creates moderation_cases with target, reason, status, report_count, and timestamps', () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+moderation_cases/i);
    expect(sql).toMatch(/target_type\s+VARCHAR\(20\)\s+NOT\s+NULL/i);
    expect(sql).toMatch(/target_type\s+IN\s*\(\s*'team'\s*,\s*'profile'\s*,\s*'url'\s*\)/i);
    expect(sql).toMatch(/reason\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/status\s+IN\s*\(\s*'Open'\s*,\s*'Dismissed'\s*,\s*'Resolved'\s*\)/i);
    expect(sql).toMatch(/report_count\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i);
    expect(sql).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+NOW\(\)/i);
    expect(sql).toMatch(/flagged_url\s+VARCHAR\(2048\)/i);
  });

  it('enforces RLS and ADMIN-only creator role on insert', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+moderation_cases\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+check_moderation_case_creator_role/i);
    expect(sql).toMatch(
      /CREATE\s+TRIGGER\s+trigger_check_moderation_case_creator_role\s+BEFORE\s+INSERT\s+ON\s+moderation_cases/i
    );
    expect(sql).toMatch(/role\s*!=\s*'ADMIN'/i);
  });

  it('indexes newest-first queue ordering and target lookup', () => {
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_moderation_cases_created_at\s+ON\s+moderation_cases\s*\(\s*created_at\s+DESC\s*\)/i
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_moderation_cases_target\s+ON\s+moderation_cases\s*\(\s*target_type\s*,\s*target_id\s*\)/i
    );
  });

  it('requires flagged_url only for url targets and enforces https', () => {
    expect(sql).toMatch(/chk_moderation_cases_url_requires_flagged_url/i);
    expect(sql).toMatch(/target_type\s*=\s*'url'/i);
    expect(sql).toMatch(/flagged_url\s+LIKE\s+'https:\/\/%'/i);
  });
});



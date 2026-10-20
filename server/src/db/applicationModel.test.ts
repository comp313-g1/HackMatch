import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPLICATION_MESSAGE_MAX_LENGTH,
  APPLICATION_STATUSES,
  MAX_PENDING_APPLICATIONS_PER_EVENT,
  countsTowardPendingApplicationQuota,
  isApplicationMessageTooLong,
  isApplicationWithdrawable,
  normalizeApplicationMessage,
} from './applicationModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');

function readMigration(name: string): string {
  return fs.readFileSync(path.join(migrationsDir, name), 'utf-8');
}

describe('US-018 application model contract (#170)', () => {
  const base = readMigration('0011_create_team_recruitment_tables.sql');
  const model = readMigration('0023_create_team_application_model.sql');

  it('defines Application request_type and shared Pending status domain on team_requests', () => {
    expect(base).toMatch(/request_type\s+VARCHAR\(20\)\s+NOT\s+NULL\s+CHECK[\s\S]*'Application'/i);
    expect(base).toMatch(/status\s+VARCHAR\(20\)\s+NOT\s+NULL\s+DEFAULT\s+'Pending'/i);
    for (const status of APPLICATION_STATUSES) {
      expect(base).toContain(`'${status}'`);
    }
  });

  it('adds message column with 250-char limit and Pending Application vacancy binding', () => {
    expect(APPLICATION_MESSAGE_MAX_LENGTH).toBe(250);
    expect(model).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+message\s+VARCHAR\(250\)/i);
    expect(model).toMatch(/chk_team_requests_application_message_length/i);
    expect(model).toMatch(/chk_team_requests_pending_application_requires_vacancy/i);
    expect(model).toMatch(
      /request_type\s*=\s*'Application'[\s\S]*?status\s*=\s*'Pending'[\s\S]*?vacancy_id\s+IS\s+NULL/i
    );
  });

  it('enforces duplicate pending-per-team and 3 pending-per-event quota indexes (FR-053 / FR-054)', () => {
    expect(MAX_PENDING_APPLICATIONS_PER_EVENT).toBe(3);
    expect(model).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_team_requests_pending_application\s+ON\s+team_requests\s*\(\s*team_id\s*,\s*participant_id\s*\)/i
    );
    expect(model).toMatch(/idx_team_requests_pending_application_per_event/i);
    expect(model).toMatch(/idx_team_requests_applicant_application_status/i);
    expect(model).toMatch(/idx_team_requests_team_application_status/i);
  });

  it('defines submit_team_application with atomic checks, owner alert, and service_role grant', () => {
    expect(model).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+submit_team_application/i);
    expect(model).toMatch(/APPLICATION_PENDING_LIMIT/i);
    expect(model).toMatch(/DUPLICATE_PENDING_APPLICATION/i);
    expect(model).toMatch(/APPLICATION_MESSAGE_TOO_LONG/i);
    expect(model).toMatch(/APPLICANT_ALREADY_CONFIRMED/i);
    expect(model).toMatch(/VACANCY_NOT_OPEN/i);
    expect(model).toMatch(/team_application_submitted/i);
    expect(model).toMatch(/INSERT\s+INTO\s+participant_notifications/i);
    expect(model).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+submit_team_application\s*\(\s*UUID\s*,\s*UUID\s*,\s*UUID\s*,\s*TEXT\s*\)\s+TO\s+service_role/i
    );
  });

  it('enables RLS on team_requests (no anon public policies in recruitment DDL)', () => {
    expect(base).toMatch(/ALTER\s+TABLE\s+team_requests\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});

describe('applicationModel pure helpers (preserve draft values on validation)', () => {
  it('normalizes blank messages to null and detects >250 length without truncating', () => {
    expect(normalizeApplicationMessage(null)).toBeNull();
    expect(normalizeApplicationMessage('   ')).toBeNull();
    expect(normalizeApplicationMessage('  hello  ')).toBe('hello');
    expect(isApplicationMessageTooLong('a'.repeat(250))).toBe(false);
    expect(isApplicationMessageTooLong('a'.repeat(251))).toBe(true);
    expect(normalizeApplicationMessage('a'.repeat(251))?.length).toBe(251);
  });

  it('maps Pending to withdrawable / quota-consuming and terminal statuses free quota', () => {
    expect(countsTowardPendingApplicationQuota('Pending')).toBe(true);
    expect(isApplicationWithdrawable('Pending')).toBe(true);
    for (const status of ['Accepted', 'Declined', 'Withdrawn', 'Canceled', 'Expired'] as const) {
      expect(countsTowardPendingApplicationQuota(status)).toBe(false);
      expect(isApplicationWithdrawable(status)).toBe(false);
    }
  });
});

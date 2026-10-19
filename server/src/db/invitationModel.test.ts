import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INVITATION_STATUSES,
  INVITATION_TTL_HOURS,
  computeInvitationExpiresAt,
  isInvitationExpiredByClock,
  isInvitationPendingAcceptable,
} from './invitationModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');

function readMigration(name: string): string {
  return fs.readFileSync(path.join(migrationsDir, name), 'utf-8');
}

describe('US-017 invitation model contract (#161)', () => {
  const base = readMigration('0011_create_team_recruitment_tables.sql');
  const expiryIssuance = readMigration('0018_create_team_invitation_issuance.sql');
  const model = readMigration('0019_complete_team_invitation_model.sql');

  it('defines Pending default and full invitation status domain on team_requests', () => {
    expect(base).toMatch(/status\s+VARCHAR\(20\)\s+NOT\s+NULL\s+DEFAULT\s+'Pending'/i);
    for (const status of INVITATION_STATUSES) {
      expect(base).toContain(`'${status}'`);
    }
    expect(base).toMatch(/request_type\s+VARCHAR\(20\)\s+NOT\s+NULL\s+CHECK[\s\S]*'Invitation'/i);
  });

  it('persists expires_at and requires it for Invitation rows (48h model)', () => {
    expect(INVITATION_TTL_HOURS).toBe(48);
    expect(expiryIssuance).toMatch(/expires_at\s+TIMESTAMPTZ/i);
    expect(expiryIssuance).toMatch(/INTERVAL\s+'48 hours'/i);
    expect(model).toMatch(/team_invitation_is_currently_valid/i);
  });

  it('enforces pending quotas per invitee/team and per slot', () => {
    expect(base).toMatch(/uq_team_requests_pending_invite/i);
    expect(expiryIssuance).toMatch(/uq_team_requests_pending_invite_per_slot/i);
    expect(model).toMatch(/chk_team_requests_pending_invite_requires_vacancy/i);
  });

  it('enables RLS on team_requests (no anon public policies in recruitment DDL)', () => {
    expect(base).toMatch(/ALTER\s+TABLE\s+team_requests\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});

describe('invitationModel pure helpers (preserve validity without mutating rows)', () => {
  it('computeInvitationExpiresAt adds exactly 48 hours', () => {
    const issued = new Date('2026-10-19T12:00:00.000Z');
    expect(computeInvitationExpiresAt(issued).toISOString()).toBe('2026-10-21T12:00:00.000Z');
  });

  it('treats missing or past expires_at as expired even if status is still Pending', () => {
    const now = new Date('2026-10-21T12:00:00.000Z');
    expect(isInvitationExpiredByClock(null, now)).toBe(true);
    expect(isInvitationExpiredByClock('2026-10-21T12:00:00.000Z', now)).toBe(true);
    expect(isInvitationExpiredByClock('2026-10-21T12:00:01.000Z', now)).toBe(false);
    expect(isInvitationPendingAcceptable('Pending', '2026-10-20T00:00:00.000Z', now)).toBe(false);
    expect(isInvitationPendingAcceptable('Pending', '2026-10-22T00:00:00.000Z', now)).toBe(true);
    expect(isInvitationPendingAcceptable('Expired', '2026-10-22T00:00:00.000Z', now)).toBe(false);
  });
});

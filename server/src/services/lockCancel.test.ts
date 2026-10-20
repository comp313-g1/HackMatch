import { describe, it, expect } from 'vitest';
import {
  LOCK_CANCEL_REASON,
  LOCK_CANCEL_NOTIFICATION_TYPE,
  summarizeLockCancelOutcome,
  canceledRequestsLockMessage,
} from './lockCancel.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('lock cancel-on-lock contract (US-022 / #209 / FR-067)', () => {
  const migrationSql = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/0036_lock_team.sql'),
    'utf-8'
  );

  it('lock_team cancels Pending invitations and applications with TEAM_LOCKED (happy path contract)', () => {
    expect(migrationSql).toMatch(/cancel_reason\s*=\s*'TEAM_LOCKED'/i);
    expect(migrationSql).toMatch(/status\s*=\s*'Canceled'/i);
    expect(migrationSql).toMatch(/resolved_at\s*=\s*now\(\)/i);
    expect(migrationSql).toMatch(/REQUEST_CANCELED_TEAM_LOCKED/);
    expect(migrationSql).toMatch(/WHERE\s+team_id\s*=\s*p_team[\s\S]*?status\s*=\s*'Pending'/i);

    const outcome = summarizeLockCancelOutcome({
      pendingInvitations: 1,
      pendingApplications: 1,
      acceptedBefore: 1,
      acceptedAfter: 1,
      canceledRows: [
        { request_type: 'Invitation', status: 'Canceled', cancel_reason: LOCK_CANCEL_REASON },
        { request_type: 'Application', status: 'Canceled', cancel_reason: LOCK_CANCEL_REASON },
      ],
    });

    expect(outcome.canceledRequests).toBe(2);
    expect(outcome.invitationCanceled).toBe(true);
    expect(outcome.applicationCanceled).toBe(true);
    expect(outcome.acceptedUntouched).toBe(true);
    expect(outcome.cancelReason).toBe('TEAM_LOCKED');
    expect(LOCK_CANCEL_NOTIFICATION_TYPE).toBe('REQUEST_CANCELED_TEAM_LOCKED');
  });

  it('reports zero cancels when no Pending rows exist (boundary)', () => {
    const outcome = summarizeLockCancelOutcome({
      pendingInvitations: 0,
      pendingApplications: 0,
      acceptedBefore: 2,
      acceptedAfter: 2,
      canceledRows: [],
    });
    expect(outcome.canceledRequests).toBe(0);
    expect(outcome.acceptedUntouched).toBe(true);
    expect(canceledRequestsLockMessage(0)).toBe('0 pending requests were canceled.');
  });

  it('flags failure when Accepted rows would change (failure / integrity)', () => {
    const outcome = summarizeLockCancelOutcome({
      pendingInvitations: 1,
      pendingApplications: 0,
      acceptedBefore: 1,
      acceptedAfter: 0,
      canceledRows: [
        { request_type: 'Invitation', status: 'Canceled', cancel_reason: LOCK_CANCEL_REASON },
      ],
    });
    expect(outcome.invitationCanceled).toBe(true);
    expect(outcome.acceptedUntouched).toBe(false);
  });

  it('formats singular and plural lock cancel messages', () => {
    expect(canceledRequestsLockMessage(1)).toBe('1 pending request was canceled.');
    expect(canceledRequestsLockMessage(3)).toBe('3 pending requests were canceled.');
  });
});

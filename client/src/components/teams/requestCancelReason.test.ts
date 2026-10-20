import { describe, it, expect } from 'vitest';
import {
  cancelReasonLabel,
  canceledRequestsOnLockNotice,
  TEAM_LOCKED_CANCEL_REASON,
} from './requestCancelReason';

describe('requestCancelReason (US-022 / #209)', () => {
  it('labels TEAM_LOCKED for invitee/applicant/owner surfaces (happy path)', () => {
    expect(TEAM_LOCKED_CANCEL_REASON).toBe('TEAM_LOCKED');
    expect(cancelReasonLabel('TEAM_LOCKED')).toMatch(/roster was locked/i);
  });

  it('returns null for missing reasons (boundary)', () => {
    expect(cancelReasonLabel(null)).toBeNull();
    expect(cancelReasonLabel('')).toBeNull();
    expect(cancelReasonLabel('   ')).toBeNull();
  });

  it('falls back for unknown cancel reasons (failure / unexpected)', () => {
    expect(cancelReasonLabel('SOMETHING_NEW')).toMatch(/SOMETHING_NEW/);
  });

  it('formats canceledRequests notice for lock success', () => {
    expect(canceledRequestsOnLockNotice(0)).toMatch(/no pending/i);
    expect(canceledRequestsOnLockNotice(1)).toMatch(/1 pending/i);
    expect(canceledRequestsOnLockNotice(4)).toMatch(/4 pending/i);
  });
});

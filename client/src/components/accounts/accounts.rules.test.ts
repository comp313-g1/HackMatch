/**
 * US-027 / #256 — Client-visible suspension and deletion outcome formatting.
 * Complements server integration evidence for happy-path and blocked outcomes.
 */
import { describe, it, expect } from 'vitest';
import { formatCascadeSuccess, formatDeletionSuccess } from './accountsApi';
import type { DeleteAccountResult, SuspendAccountResult } from './accountTypes';

const baseAccount = {
  accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  role: 'PART' as const,
  state: 'Suspended' as const,
  isVerified: true,
  suspendedAt: '2026-10-21T12:00:00.000Z',
  suspensionReason: 'Harassment',
  deactivatedAt: null,
  deactivationReason: null,
  createdAt: '2026-10-18T00:00:00.000Z',
  handle: 'ada',
};

describe('accounts enforcement outcome formatting (US-027 / #256)', () => {
  it('US-027-T1 / T3: formats suspension cascade success for ADMIN UI', () => {
    const result: SuspendAccountResult = {
      account: baseAccount,
      sessionsRevoked: true,
      firebaseSignInDisabled: true,
      alreadySuspended: false,
      outcome: 'account_suspended',
      actionRecordId: 'rec-1',
      effects: {
        pendingIncomingRequestsCanceled: 2,
        outgoingInvitationsCanceled: 1,
        profileHidden: true,
        availabilityCleared: true,
        ownedTeamsPaused: 1,
        membershipsPreserved: true,
      },
    };

    const notice = formatCascadeSuccess(result);
    expect(notice).toMatch(/Account suspended/i);
    expect(notice).toMatch(/Sessions revoked/i);
    expect(notice).toMatch(/Sign-in blocked/i);
    expect(notice).toMatch(/Canceled 2 pending/);
    expect(notice).toMatch(/Paused recruitment on 1/);
    expect(notice).toMatch(/memberships were preserved/i);
  });

  it('US-027-T4: formats ownership-verified deletion with 30-day target', () => {
    const result: DeleteAccountResult = {
      outcome: 'deletion_completed',
      request: {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        participantId: baseAccount.accountId,
        status: 'Completed',
        ownershipVerified: true,
        ownershipVerifiedAt: '2026-10-21T12:00:00.000Z',
        blockedReason: null,
        targetCompletionAt: '2026-11-20T12:00:00.000Z',
        completedAt: '2026-10-21T12:05:00.000Z',
        reason: 'Verified owner requested deletion',
        createdAt: '2026-10-21T12:00:00.000Z',
        targetNotice: 'Proposed 30-day live-PII processing target under R-06 / NR-023.',
      },
      account: { ...baseAccount, state: 'Deactivated', fullName: 'Deleted User' },
      livePiiErased: true,
      firebaseUserDeleted: true,
      sessionsRevoked: true,
      lockedMembershipsPseudonymized: true,
      lockedMembershipsPseudonymizedCount: 1,
      membershipIdsPreserved: ['11111111-1111-4111-8111-111111111111'],
      unlockedOwnedTeamIds: [],
      actionRecordId: 'rec-del',
    };

    const notice = formatDeletionSuccess(result);
    expect(notice).toMatch(/Ownership-verified deletion completed/i);
    expect(notice).toMatch(/Live identifying data was erased/i);
    expect(notice).toMatch(/2026-11-20/);
    expect(notice).toMatch(/pseudonymized/i);
    expect(notice).not.toMatch(/password|otpCode/i);
  });

  it('US-027-T5: blocked deletion outcome is not treated as success copy', () => {
    // Client surfaces UNLOCKED_OWNER_MUST_DISBAND via AccountsApiError; success formatter
    // is only used for completed / already-completed outcomes.
    const already: DeleteAccountResult = {
      outcome: 'deletion_already_completed',
      request: {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        participantId: baseAccount.accountId,
        status: 'Completed',
        ownershipVerified: true,
        ownershipVerifiedAt: '2026-10-01T00:00:00.000Z',
        blockedReason: null,
        targetCompletionAt: '2026-10-31T00:00:00.000Z',
        completedAt: '2026-10-01T00:05:00.000Z',
        reason: 'Prior deletion',
        createdAt: '2026-10-01T00:00:00.000Z',
        targetNotice: 'Proposed 30-day live-PII processing target under R-06 / NR-023.',
      },
      account: { ...baseAccount, state: 'Deactivated' },
      livePiiErased: true,
      firebaseUserDeleted: true,
      sessionsRevoked: true,
      lockedMembershipsPseudonymized: false,
      unlockedOwnedTeamIds: [],
      actionRecordId: null,
    };

    expect(formatDeletionSuccess(already)).toMatch(/already completed/i);
  });
});

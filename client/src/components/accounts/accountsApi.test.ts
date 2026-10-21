import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AccountsApiError,
  fetchAdminAccounts,
  formatCascadeSuccess,
  suspendAdminAccount,
} from './accountsApi';
import * as authFetchMod from '../../config/authFetch';

vi.mock('../../config/authFetch', async () => {
  const actual = await vi.importActual<typeof import('../../config/authFetch')>(
    '../../config/authFetch'
  );
  return {
    ...actual,
    authFetch: vi.fn(),
  };
});

const authFetchMock = vi.mocked(authFetchMod.authFetch);

describe('accountsApi (US-027 / #251)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  it('fetches admin accounts list', async () => {
    authFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ accounts: [{ accountId: 'a', state: 'Active' }] }), {
        status: 200,
      })
    );
    const rows = await fetchAdminAccounts({ q: 'ada' });
    expect(authFetchMock).toHaveBeenCalledWith('/api/admin/accounts?q=ada', { method: 'GET' });
    expect(rows).toHaveLength(1);
  });

  it('surfaces validation errors with submitted draft on suspend failure', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Validation failed.',
          code: 'VALIDATION_ERROR',
          errors: { reason: 'A reason is required for every suspension.' },
          submitted: { reason: '   ' },
        }),
        { status: 400 }
      )
    );

    await expect(
      suspendAdminAccount('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { reason: '   ' })
    ).rejects.toMatchObject({
      name: 'AccountsApiError',
      code: 'VALIDATION_ERROR',
      errors: { reason: 'A reason is required for every suspension.' },
      submitted: { reason: '   ' },
    });
  });

  it('formats cascade success for user-visible outcomes', () => {
    const message = formatCascadeSuccess({
      account: {
        accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        email: 'a@example.com',
        fullName: 'Ada',
        role: 'PART',
        state: 'Suspended',
        isVerified: true,
        suspendedAt: '2026-10-21T12:00:00.000Z',
        suspensionReason: 'Harassment',
        deactivatedAt: null,
        deactivationReason: null,
        createdAt: '2026-10-18T00:00:00.000Z',
        handle: 'ada',
      },
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
    });

    expect(message).toMatch(/Account suspended/);
    expect(message).toMatch(/Canceled 2 pending request/);
    expect(message).toMatch(/Profile hidden/);
    expect(message).toMatch(/Paused recruitment on 1/);
    expect(message).toMatch(/memberships were preserved/i);
  });

  it('throws AccountsApiError on network failure while preserving draft hint', async () => {
    authFetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      suspendAdminAccount('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { reason: 'Spam' })
    ).rejects.toBeInstanceOf(AccountsApiError);
  });
});

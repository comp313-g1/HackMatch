import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AccountEnforcementPage } from './AccountEnforcementPage';
import * as accountsApi from './accountsApi';

vi.mock('./accountsApi', async () => {
  const actual = await vi.importActual<typeof import('./accountsApi')>('./accountsApi');
  return {
    ...actual,
    probeAdminAccountsAccess: vi.fn(),
    fetchAdminAccounts: vi.fn(),
    fetchAdminAccountDetail: vi.fn(),
    suspendAdminAccount: vi.fn(),
    deleteAdminAccount: vi.fn(),
  };
});

const probeMock = vi.mocked(accountsApi.probeAdminAccountsAccess);
const fetchListMock = vi.mocked(accountsApi.fetchAdminAccounts);
const fetchDetailMock = vi.mocked(accountsApi.fetchAdminAccountDetail);
const suspendMock = vi.mocked(accountsApi.suspendAdminAccount);
const deleteMock = vi.mocked(accountsApi.deleteAdminAccount);

const account = {
  accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  role: 'PART' as const,
  state: 'Active' as const,
  isVerified: true,
  suspendedAt: null,
  suspensionReason: null,
  deactivatedAt: null,
  deactivationReason: null,
  createdAt: '2026-10-18T00:00:00.000Z',
  handle: 'ada',
};

const privacy = {
  credentialsIncluded: false as const,
  otpsIncluded: false as const,
  privateTeamNotesIncluded: false as const,
  privateContactsIncluded: false as const,
  publicAdminSelfPromotionAllowed: false as const,
  notice: 'Credentials, OTPs, and private team notes are not available.',
};

describe('AccountEnforcementPage (US-027 / #255)', () => {
  beforeEach(() => {
    probeMock.mockReset();
    fetchListMock.mockReset();
    fetchDetailMock.mockReset();
    suspendMock.mockReset();
    deleteMock.mockReset();
  });

  it('shows access loading then denied for non-ADMIN callers', async () => {
    probeMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve('denied'), 20))
    );
    render(<AccountEnforcementPage />);
    expect(screen.getByTestId('accounts-access-loading')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('accounts-access-denied')).toBeInTheDocument();
    });
    expect(fetchListMock).not.toHaveBeenCalled();
  });

  it('loads empty account list for ADMIN', async () => {
    probeMock.mockResolvedValue('granted');
    fetchListMock.mockResolvedValue([]);
    render(<AccountEnforcementPage />);
    await waitFor(() => {
      expect(screen.getByTestId('accounts-list-empty')).toBeInTheDocument();
    });
  });

  it('lists accounts and opens detail on select', async () => {
    probeMock.mockResolvedValue('granted');
    fetchListMock.mockResolvedValue([account]);
    fetchDetailMock.mockResolvedValue({
      account,
      profile: {
        handle: 'ada',
        primaryRole: 'Frontend',
        institution: null,
        moderationStatus: 'None',
      },
      relevantListings: [],
      privacy,
    });

    render(<AccountEnforcementPage />);

    await waitFor(() => {
      expect(screen.getByTestId('accounts-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId('account-detail-idle')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`account-row-${account.accountId}`));

    await waitFor(() => {
      expect(screen.getByTestId('account-detail')).toBeInTheDocument();
    });
    expect(screen.getByTestId('account-detail-name')).toHaveTextContent('Ada Lovelace');
    expect(screen.getByTestId('account-privacy-notice')).toHaveTextContent(/Credentials/);
    expect(screen.getByTestId('suspend-account-form')).toBeInTheDocument();
    expect(screen.getByTestId('delete-account-form')).toBeInTheDocument();
  });

  it('applies role filter when searching accounts', async () => {
    probeMock.mockResolvedValue('granted');
    fetchListMock.mockResolvedValue([account]);
    render(<AccountEnforcementPage />);
    await waitFor(() => {
      expect(screen.getByTestId('accounts-list')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('accounts-role-filter'), {
      target: { value: 'PART' },
    });
    fireEvent.click(screen.getByTestId('accounts-search-submit'));

    await waitFor(() => {
      expect(fetchListMock).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'PART' })
      );
    });
  });

  it('shows detail load failure with retry', async () => {
    probeMock.mockResolvedValue('granted');
    fetchListMock.mockResolvedValue([account]);
    fetchDetailMock.mockRejectedValue(
      new accountsApi.AccountsApiError(404, 'ACCOUNT_NOT_FOUND', undefined, undefined, 'Account not found.')
    );
    render(<AccountEnforcementPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`account-row-${account.accountId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`account-row-${account.accountId}`));
    await waitFor(() => {
      expect(screen.getByTestId('account-detail-error')).toHaveTextContent(/Account not found/);
    });
  });

  it('shows list load failure', async () => {
    probeMock.mockResolvedValue('granted');
    fetchListMock.mockRejectedValue(
      new accountsApi.AccountsApiError(500, 'SERVER', undefined, undefined, 'Server down')
    );
    render(<AccountEnforcementPage />);
    await waitFor(() => {
      expect(screen.getByTestId('accounts-list-error')).toHaveTextContent(/Server down/);
    });
  });

  it('keeps entered reason on local validation error', async () => {
    probeMock.mockResolvedValue('granted');
    fetchListMock.mockResolvedValue([account]);
    fetchDetailMock.mockResolvedValue({
      account,
      profile: null,
      relevantListings: [],
      privacy,
    });

    render(<AccountEnforcementPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`account-row-${account.accountId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`account-row-${account.accountId}`));
    await waitFor(() => {
      expect(screen.getByTestId('suspend-account-form')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('suspend-reason'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByTestId('suspend-submit'));

    expect(suspendMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('suspend-reason')).toHaveValue('   ');
    expect(screen.getByText(/reason is required/i)).toBeInTheDocument();
  });

  it('suspends account and shows cascade success outcomes', async () => {
    probeMock.mockResolvedValue('granted');
    fetchListMock.mockResolvedValue([account]);
    fetchDetailMock.mockResolvedValue({
      account,
      profile: {
        handle: 'ada',
        primaryRole: null,
        institution: null,
        moderationStatus: 'None',
      },
      relevantListings: [
        {
          teamId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          teamName: 'Rocket',
          recruitmentStatus: 'Open',
          lockedAt: null,
          membershipRole: 'Owner',
          isOwner: true,
        },
      ],
      privacy,
    });
    suspendMock.mockResolvedValue({
      account: { ...account, state: 'Suspended', suspensionReason: 'Harassment' },
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

    render(<AccountEnforcementPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`account-row-${account.accountId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`account-row-${account.accountId}`));
    await waitFor(() => {
      expect(screen.getByTestId('suspend-account-form')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('suspend-reason'), {
      target: { value: 'Harassment' },
    });
    fireEvent.click(screen.getByTestId('suspend-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('suspend-success')).toHaveTextContent(/Account suspended/i);
    });
    expect(screen.getByTestId('suspend-success')).toHaveTextContent(/Canceled 2 pending/);
    expect(screen.getByTestId('suspend-success')).toHaveTextContent(/Profile hidden/);
    expect(screen.getByTestId('suspend-success')).toHaveTextContent(/Paused recruitment on 1/);
    expect(suspendMock).toHaveBeenCalledWith(account.accountId, { reason: 'Harassment' });
  });

  it('preserves reason and shows failure when suspend API rejects', async () => {
    probeMock.mockResolvedValue('granted');
    fetchListMock.mockResolvedValue([account]);
    fetchDetailMock.mockResolvedValue({
      account,
      profile: null,
      relevantListings: [],
      privacy,
    });
    suspendMock.mockRejectedValue(
      new accountsApi.AccountsApiError(
        502,
        'FIREBASE_REVOKE_FAILED',
        undefined,
        { reason: 'Spam' },
        'Firebase session revocation failed.'
      )
    );

    render(<AccountEnforcementPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`account-row-${account.accountId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`account-row-${account.accountId}`));
    await waitFor(() => {
      expect(screen.getByTestId('suspend-account-form')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('suspend-reason'), {
      target: { value: 'Spam' },
    });
    fireEvent.click(screen.getByTestId('suspend-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('suspend-form-error')).toHaveTextContent(/Firebase session/);
    });
    expect(screen.getByTestId('suspend-reason')).toHaveValue('Spam');
  });

  it('keeps deletion draft when ownership is not confirmed', async () => {
    probeMock.mockResolvedValue('granted');
    fetchListMock.mockResolvedValue([account]);
    fetchDetailMock.mockResolvedValue({
      account,
      profile: null,
      relevantListings: [],
      privacy,
    });

    render(<AccountEnforcementPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`account-row-${account.accountId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`account-row-${account.accountId}`));
    await waitFor(() => {
      expect(screen.getByTestId('delete-account-form')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('delete-reason'), {
      target: { value: 'Owner asked for deletion' },
    });
    fireEvent.click(screen.getByTestId('delete-submit'));

    expect(deleteMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('delete-reason')).toHaveValue('Owner asked for deletion');
    expect(screen.getByTestId('delete-ownership-error')).toHaveTextContent(/ownership/i);
  });

  it('submits ownership-verified deletion and shows 30-day target success', async () => {
    probeMock.mockResolvedValue('granted');
    fetchListMock.mockResolvedValue([account]);
    fetchDetailMock.mockResolvedValue({
      account,
      profile: null,
      relevantListings: [],
      privacy,
    });
    deleteMock.mockResolvedValue({
      outcome: 'deletion_completed',
      request: {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        participantId: account.accountId,
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
      account: { ...account, state: 'Deactivated', fullName: 'Deleted User' },
      livePiiErased: true,
      firebaseUserDeleted: true,
      sessionsRevoked: true,
      lockedMembershipsPseudonymized: true,
      lockedMembershipsPseudonymizedCount: 1,
      membershipIdsPreserved: ['11111111-1111-4111-8111-111111111111'],
      unlockedOwnedTeamIds: [],
      actionRecordId: 'rec-1',
    });

    render(<AccountEnforcementPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`account-row-${account.accountId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`account-row-${account.accountId}`));
    await waitFor(() => {
      expect(screen.getByTestId('delete-account-form')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('delete-reason'), {
      target: { value: 'Verified owner requested deletion' },
    });
    fireEvent.click(screen.getByTestId('delete-ownership-verified'));
    fireEvent.click(screen.getByTestId('delete-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('delete-success')).toHaveTextContent(/Ownership-verified deletion completed/i);
    });
    expect(screen.getByTestId('delete-success')).toHaveTextContent(/2026-11-20/);
    expect(screen.getByTestId('delete-success')).toHaveTextContent(/pseudonymized/i);
    expect(deleteMock).toHaveBeenCalledWith(account.accountId, {
      reason: 'Verified owner requested deletion',
      ownershipVerified: true,
    });
  });

  it('preserves deletion draft when unlocked owner must disband', async () => {
    probeMock.mockResolvedValue('granted');
    fetchListMock.mockResolvedValue([account]);
    fetchDetailMock.mockResolvedValue({
      account,
      profile: null,
      relevantListings: [],
      privacy,
    });
    deleteMock.mockRejectedValue(
      new accountsApi.AccountsApiError(
        409,
        'UNLOCKED_OWNER_MUST_DISBAND',
        undefined,
        { reason: 'Verified owner requested deletion', ownershipVerified: true },
        'Owner must disband 1 unlocked team(s) before deletion can proceed: Rocket.'
      )
    );

    render(<AccountEnforcementPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`account-row-${account.accountId}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`account-row-${account.accountId}`));
    await waitFor(() => {
      expect(screen.getByTestId('delete-account-form')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('delete-reason'), {
      target: { value: 'Verified owner requested deletion' },
    });
    fireEvent.click(screen.getByTestId('delete-ownership-verified'));
    fireEvent.click(screen.getByTestId('delete-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('delete-form-error')).toHaveTextContent(/disband/i);
    });
    expect(screen.getByTestId('delete-reason')).toHaveValue('Verified owner requested deletion');
    expect(screen.getByTestId('delete-ownership-verified')).toBeChecked();
  });
});

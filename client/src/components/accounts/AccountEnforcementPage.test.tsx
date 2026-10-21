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
  };
});

const probeMock = vi.mocked(accountsApi.probeAdminAccountsAccess);
const fetchListMock = vi.mocked(accountsApi.fetchAdminAccounts);
const fetchDetailMock = vi.mocked(accountsApi.fetchAdminAccountDetail);
const suspendMock = vi.mocked(accountsApi.suspendAdminAccount);

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

describe('AccountEnforcementPage (US-027 / #251)', () => {
  beforeEach(() => {
    probeMock.mockReset();
    fetchListMock.mockReset();
    fetchDetailMock.mockReset();
    suspendMock.mockReset();
  });

  it('shows access denied for non-ADMIN callers', async () => {
    probeMock.mockResolvedValue('denied');
    render(<AccountEnforcementPage />);
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
      privacy: {
        credentialsIncluded: false,
        otpsIncluded: false,
        privateTeamNotesIncluded: false,
        privateContactsIncluded: false,
        notice: 'Credentials are not available.',
      },
    });

    render(<AccountEnforcementPage />);

    await waitFor(() => {
      expect(screen.getByTestId('accounts-list')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`account-row-${account.accountId}`));

    await waitFor(() => {
      expect(screen.getByTestId('account-detail')).toBeInTheDocument();
    });
    expect(screen.getByTestId('account-detail-name')).toHaveTextContent('Ada Lovelace');
    expect(screen.getByTestId('account-privacy-notice')).toHaveTextContent(/Credentials/);
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
      privacy: {
        credentialsIncluded: false,
        otpsIncluded: false,
        privateTeamNotesIncluded: false,
        privateContactsIncluded: false,
        notice: 'Privacy notice',
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
      privacy: {
        credentialsIncluded: false,
        otpsIncluded: false,
        privateTeamNotesIncluded: false,
        privateContactsIncluded: false,
        notice: 'Privacy notice',
      },
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
      privacy: {
        credentialsIncluded: false,
        otpsIncluded: false,
        privateTeamNotesIncluded: false,
        privateContactsIncluded: false,
        notice: 'Privacy notice',
      },
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
});

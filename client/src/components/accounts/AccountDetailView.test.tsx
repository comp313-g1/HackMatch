import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AccountDetailView } from './AccountDetailView';
import type { AdminAccountDetail } from './accountTypes';

const detail: AdminAccountDetail = {
  account: {
    accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    email: 'ada@example.com',
    fullName: 'Ada Lovelace',
    role: 'PART',
    state: 'Suspended',
    isVerified: true,
    suspendedAt: '2026-10-20T00:00:00.000Z',
    suspensionReason: 'Harassment',
    deactivatedAt: null,
    deactivationReason: null,
    createdAt: '2026-10-18T00:00:00.000Z',
    handle: 'ada',
  },
  profile: {
    handle: 'ada',
    primaryRole: 'Frontend',
    institution: 'U of T',
    moderationStatus: 'None',
  },
  relevantListings: [
    {
      teamId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      teamName: 'Rocket',
      recruitmentStatus: 'Paused',
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
    publicAdminSelfPromotionAllowed: false,
    notice: 'Credentials, OTPs, and private team notes are not available.',
  },
};

describe('AccountDetailView (US-027 / #255)', () => {
  it('shows idle prompt before selection', () => {
    render(
      <AccountDetailView
        detail={null}
        detailState="idle"
        detailError={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('account-detail-idle')).toHaveTextContent(/Select an account/);
  });

  it('shows loading state', () => {
    render(
      <AccountDetailView
        detail={null}
        detailState="loading"
        detailError={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('account-detail-loading')).toHaveTextContent(/Loading account/);
  });

  it('shows error with retry', () => {
    const onRetry = vi.fn();
    render(
      <AccountDetailView
        detail={null}
        detailState="error"
        detailError="Not found"
        onRetry={onRetry}
      />
    );
    expect(screen.getByTestId('account-detail-error')).toHaveTextContent(/Not found/);
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders success detail without credentials and with listings', () => {
    render(
      <AccountDetailView
        detail={detail}
        detailState="success"
        detailError={null}
        onRetry={vi.fn()}
        onClearSelection={vi.fn()}
      />
    );
    expect(screen.getByTestId('account-detail-name')).toHaveTextContent('Ada Lovelace');
    expect(screen.getByTestId('account-detail-state')).toHaveTextContent('Suspended');
    expect(screen.getByTestId('account-detail-suspension-reason')).toHaveTextContent(/Harassment/);
    expect(screen.getByTestId('account-privacy-notice')).toHaveTextContent(/Credentials/);
    expect(screen.getByTestId('account-profile-summary')).toHaveTextContent(/@ada/);
    expect(screen.getByTestId('account-listing-cccccccc-cccc-4ccc-8ccc-cccccccccccc')).toHaveTextContent(
      /Rocket/
    );
    expect(screen.queryByText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/otpCode|otpHash|secretKey/i)).not.toBeInTheDocument();
  });

  it('shows missing profile and empty listings', () => {
    render(
      <AccountDetailView
        detail={{
          ...detail,
          profile: null,
          relevantListings: [],
        }}
        detailState="success"
        detailError={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('account-profile-missing')).toBeInTheDocument();
    expect(screen.getByTestId('account-listings-empty')).toBeInTheDocument();
  });
});

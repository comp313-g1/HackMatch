import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MyInvitationsView } from './MyInvitationsView';
import { MyApplicationsView } from './MyApplicationsView';
import { OutboundInvitationsView } from './OutboundInvitationsView';
import type { InviteeInvitationListItem } from './invitationsApi';
import type { MyApplicationListItem } from './applicationsApi';
import type { OwnerInvitationListItem } from './invitationsApi';

const lockedInvite: InviteeInvitationListItem = {
  id: 'inv-locked',
  teamId: 't-1',
  eventId: 'e-1',
  vacancyId: 'v-1',
  inviteeParticipantId: 'p-1',
  status: 'Canceled',
  statusLabel: 'Canceled',
  requestType: 'Invitation',
  expiresAt: '2026-10-22T00:00:00.000Z',
  createdAt: '2026-10-18T00:00:00.000Z',
  resolvedAt: '2026-10-20T15:30:00.000Z',
  cancelReason: 'TEAM_LOCKED',
  teamName: 'Locked Crew',
  vacancyRole: 'Frontend',
  expiredByClock: false,
  canRespond: false,
};

const lockedApplication: MyApplicationListItem = {
  id: 'app-locked',
  teamId: 't-1',
  eventId: 'e-1',
  vacancyId: 'v-1',
  applicantParticipantId: 'p-1',
  status: 'Canceled',
  statusLabel: 'Canceled',
  requestType: 'Application',
  createdAt: '2026-10-18T00:00:00.000Z',
  resolvedAt: '2026-10-20T15:30:00.000Z',
  cancelReason: 'TEAM_LOCKED',
  teamName: 'Locked Crew',
  vacancyRole: 'Backend',
  message: null,
  withdrawable: false,
};

const lockedOutbound: OwnerInvitationListItem = {
  id: 'inv-out',
  teamId: 't-1',
  vacancyId: 'v-1',
  inviteeParticipantId: 'p-2',
  inviteeHandle: 'cand',
  inviteeDisplayName: 'Candidate',
  status: 'Canceled',
  requestType: 'Invitation',
  expiresAt: '2026-10-22T00:00:00.000Z',
  createdAt: '2026-10-18T00:00:00.000Z',
  resolvedAt: '2026-10-20T15:30:00.000Z',
  vacancyRole: 'Frontend',
  teamName: 'Locked Crew',
  cancelReason: 'TEAM_LOCKED',
  expiredByClock: false,
};

describe('Cancel-on-lock UI surfaces (US-022 / #209)', () => {
  it('shows TEAM_LOCKED reason on invitee inbox and detail', () => {
    render(
      <MyInvitationsView
        invitations={[lockedInvite]}
        listState="success"
        emptyMessage={null}
        listError={null}
        selectedId="inv-locked"
        respondingId={null}
        onRetry={vi.fn()}
        onSelect={vi.fn()}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />
    );

    expect(screen.getByTestId('invitation-inbox-cancel-reason-inv-locked')).toHaveTextContent(
      /roster was locked/i
    );
    expect(screen.getByTestId('invitation-detail-cancel-reason')).toHaveTextContent(
      /roster was locked/i
    );
    expect(screen.getByTestId('invitation-detail-closed')).toBeInTheDocument();
  });

  it('shows TEAM_LOCKED reason on applicant My Applications list', () => {
    render(
      <MyApplicationsView
        applications={[lockedApplication]}
        listState="success"
        emptyMessage={null}
        listError={null}
        withdrawingId={null}
        onRetry={vi.fn()}
        onWithdraw={vi.fn()}
      />
    );

    expect(screen.getByTestId('application-cancel-reason-app-locked')).toHaveTextContent(
      /roster was locked/i
    );
    expect(screen.queryByTestId('withdraw-application-app-locked')).not.toBeInTheDocument();
  });

  it('shows TEAM_LOCKED reason on owner outbound invitations', () => {
    render(
      <OutboundInvitationsView
        invitations={[lockedOutbound]}
        listState="success"
        emptyMessage={null}
        listError={null}
        cancelingId={null}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByTestId('invitation-cancel-reason-inv-out')).toHaveTextContent(
      /roster was locked/i
    );
    expect(screen.queryByTestId('cancel-invitation-inv-out')).not.toBeInTheDocument();
  });

  it('preserves list data when listState is error (failure handling)', () => {
    const onRetry = vi.fn();
    render(
      <MyInvitationsView
        invitations={[lockedInvite]}
        listState="error"
        emptyMessage={null}
        listError="Network error"
        selectedId={null}
        respondingId={null}
        onRetry={onRetry}
        onSelect={vi.fn()}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />
    );

    expect(screen.getByTestId('invitations-inbox-error')).toHaveTextContent(/network error/i);
    expect(screen.getByText(/invitation list was kept/i)).toBeInTheDocument();
    expect(screen.getByTestId('invitation-inbox-cancel-reason-inv-locked')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MyInvitationsPanel } from './MyInvitationsPanel';
import * as invitationsApi from './invitationsApi';

vi.mock('./invitationsApi', async () => {
  const actual = await vi.importActual<typeof import('./invitationsApi')>('./invitationsApi');
  return {
    ...actual,
    fetchMyInvitations: vi.fn(),
    fetchInvitationDetail: vi.fn(),
    respondToInvitation: vi.fn(),
  };
});

const fetchListMock = vi.mocked(invitationsApi.fetchMyInvitations);
const fetchDetailMock = vi.mocked(invitationsApi.fetchInvitationDetail);
const respondMock = vi.mocked(invitationsApi.respondToInvitation);

const pendingInv: invitationsApi.InviteeInvitationListItem = {
  id: 'inv-1',
  teamId: 't1',
  eventId: 'e1',
  vacancyId: 'v1',
  inviteeParticipantId: 'p1',
  status: 'Pending',
  statusLabel: 'Pending',
  requestType: 'Invitation',
  expiresAt: '2099-10-21T12:00:00.000Z',
  createdAt: '2026-10-19T12:00:00.000Z',
  resolvedAt: null,
  cancelReason: null,
  teamName: 'HackMatch Innovators',
  vacancyRole: 'Frontend',
  expiredByClock: false,
  canRespond: true,
};

describe('MyInvitationsPanel (US-019 / #179)', () => {
  beforeEach(() => {
    fetchListMock.mockReset();
    fetchDetailMock.mockReset();
    respondMock.mockReset();
  });

  it('shows loading then invitation rows', async () => {
    fetchListMock.mockResolvedValue({
      invitations: [pendingInv],
      empty: false,
      message: null,
    });

    render(<MyInvitationsPanel />);

    expect(screen.getByTestId('invitations-inbox-loading')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('invitation-inbox-status-inv-1')).toHaveTextContent('Pending');
    });
  });

  it('shows empty state when there are no invitations', async () => {
    fetchListMock.mockResolvedValue({
      invitations: [],
      empty: true,
      message: 'No invitations yet. When a team invites you to an open slot, it will appear here.',
    });

    render(<MyInvitationsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('invitations-inbox-empty')).toHaveTextContent(/No invitations yet/i);
    });
  });

  it('loads detail and shows Accept/Decline for Pending invitations', async () => {
    fetchListMock.mockResolvedValue({
      invitations: [pendingInv],
      empty: false,
      message: null,
    });
    fetchDetailMock.mockResolvedValue({
      ...pendingInv,
      permittedDetails: {
        teamName: pendingInv.teamName,
        vacancyRole: pendingInv.vacancyRole,
        expiresAt: pendingInv.expiresAt,
        statusLabel: 'Pending',
      },
    });

    render(<MyInvitationsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('select-invitation-inv-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('select-invitation-inv-1'));

    await waitFor(() => {
      expect(screen.getByTestId('invitation-detail-team')).toHaveTextContent(/HackMatch Innovators/i);
    });
    expect(screen.getByTestId('accept-invitation-inv-1')).toBeInTheDocument();
    expect(screen.getByTestId('decline-invitation-inv-1')).toBeInTheDocument();
  });

  it('declines and shows owner/invitee status alert; keeps selection on failure path covered separately', async () => {
    fetchListMock
      .mockResolvedValueOnce({
        invitations: [pendingInv],
        empty: false,
        message: null,
      })
      .mockResolvedValueOnce({
        invitations: [
          {
            ...pendingInv,
            status: 'Declined',
            statusLabel: 'Declined',
            canRespond: false,
            resolvedAt: '2026-10-19T16:00:00.000Z',
            cancelReason: 'INVITEE_DECLINED',
          },
        ],
        empty: false,
        message: null,
      });
    fetchDetailMock.mockResolvedValue({
      ...pendingInv,
      permittedDetails: {
        teamName: pendingInv.teamName,
        vacancyRole: pendingInv.vacancyRole,
        expiresAt: pendingInv.expiresAt,
        statusLabel: 'Pending',
      },
    });
    respondMock.mockResolvedValue({
      decision: 'decline',
      membershipCommitted: false,
      invitation: {
        id: pendingInv.id,
        teamId: pendingInv.teamId,
        eventId: pendingInv.eventId,
        vacancyId: pendingInv.vacancyId,
        inviteeParticipantId: pendingInv.inviteeParticipantId,
        status: 'Declined',
        statusLabel: 'Declined',
        requestType: 'Invitation',
        expiresAt: pendingInv.expiresAt,
        resolvedAt: '2026-10-19T16:00:00.000Z',
        cancelReason: 'INVITEE_DECLINED',
        teamName: pendingInv.teamName,
        vacancyRole: pendingInv.vacancyRole,
      },
      changed: true,
      idempotent: false,
      alerts: [
        {
          audience: 'invitee',
          type: 'team_invitation_declined',
          message: 'You declined the invitation to join "HackMatch Innovators".',
        },
        {
          audience: 'owner',
          type: 'team_invitation_declined',
          message: 'An invitee declined the pending invitation.',
        },
      ],
      effects: {
        invitationChanged: true,
        ownerAlertCreated: true,
        inviteeAlertCreated: true,
        availabilityChanged: false,
        membershipChanged: false,
        vacancyChanged: false,
      },
      notice: 'Invitation declined. The team owner has been notified. Your availability is unchanged.',
    });

    render(<MyInvitationsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('select-invitation-inv-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('select-invitation-inv-1'));
    await waitFor(() => {
      expect(screen.getByTestId('decline-invitation-inv-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('decline-invitation-inv-1'));

    await waitFor(() => {
      expect(screen.getByTestId('invitation-respond-success')).toHaveTextContent(/declined/i);
    });
    expect(screen.getByTestId('invitation-status-alert')).toHaveTextContent(
      /owner was notified.*availability.*membership.*vacancy.*unchanged/i
    );
    expect(screen.getByTestId('invitation-inbox-status-inv-1')).toHaveTextContent('Declined');
    expect(respondMock).toHaveBeenCalledWith('inv-1', 'decline');
  });

  it('shows confirmed membership after a successful atomic acceptance (#180)', async () => {
    fetchListMock
      .mockResolvedValueOnce({ invitations: [pendingInv], empty: false, message: null })
      .mockResolvedValueOnce({
        invitations: [
          {
            ...pendingInv,
            status: 'Accepted',
            statusLabel: 'Accepted',
            canRespond: false,
            resolvedAt: '2026-10-20T12:00:00.000Z',
          },
        ],
        empty: false,
        message: null,
      });
    fetchDetailMock.mockResolvedValue({
      ...pendingInv,
      permittedDetails: {
        teamName: pendingInv.teamName,
        vacancyRole: pendingInv.vacancyRole,
        expiresAt: pendingInv.expiresAt,
        statusLabel: 'Pending',
      },
    });
    respondMock.mockResolvedValue({
      decision: 'accept',
      membershipCommitted: true,
      invitation: {
        id: pendingInv.id,
        teamId: pendingInv.teamId,
        eventId: pendingInv.eventId,
        vacancyId: pendingInv.vacancyId,
        inviteeParticipantId: pendingInv.inviteeParticipantId,
        status: 'Accepted',
        statusLabel: 'Accepted',
        requestType: 'Invitation',
        expiresAt: pendingInv.expiresAt,
        resolvedAt: '2026-10-20T12:00:00.000Z',
        cancelReason: null,
        teamName: pendingInv.teamName,
        vacancyRole: pendingInv.vacancyRole,
      },
      changed: true,
      idempotent: false,
      eligible: true,
      membership: {
        id: 'm1',
        teamId: pendingInv.teamId,
        eventId: pendingInv.eventId,
        participantId: pendingInv.inviteeParticipantId,
        role: 'Member',
        status: 'Confirmed',
        joinedAt: '2026-10-20T12:00:00.000Z',
      },
      vacancy: { id: 'v1', status: 'Filled', role: 'Frontend' },
      memberCount: 2,
      maxTeamSize: 4,
      availabilityCleared: true,
      alerts: [
        {
          audience: 'owner',
          type: 'team_invitation_accepted',
          message: 'The invited participant accepted the team invitation.',
        },
      ],
      notice: 'Invitation accepted. Team membership is confirmed and the vacancy is filled.',
    });

    render(<MyInvitationsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('select-invitation-inv-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('select-invitation-inv-1'));
    await waitFor(() => {
      expect(screen.getByTestId('accept-invitation-inv-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('accept-invitation-inv-1'));

    await waitFor(() => {
      expect(screen.getByTestId('invitation-respond-success')).toHaveTextContent(
        /membership is confirmed/i
      );
    });
    expect(screen.getByTestId('invitation-status-alert')).toHaveTextContent(
      /team membership is confirmed/i
    );
    expect(respondMock).toHaveBeenCalledWith('inv-1', 'accept');
  });

  it('keeps selection and shows error when respond fails (NR-017)', async () => {
    fetchListMock.mockResolvedValue({
      invitations: [pendingInv],
      empty: false,
      message: null,
    });
    fetchDetailMock.mockResolvedValue({
      ...pendingInv,
      permittedDetails: {
        teamName: pendingInv.teamName,
        vacancyRole: pendingInv.vacancyRole,
        expiresAt: pendingInv.expiresAt,
        statusLabel: 'Pending',
      },
    });
    respondMock.mockRejectedValue(
      new invitationsApi.TeamInvitationsApiError(
        409,
        'INVITATION_NOT_DECLINABLE',
        { invitationId: 'Only Pending invitations can be declined.' },
        undefined,
        'Only Pending invitations can be declined.'
      )
    );

    render(<MyInvitationsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('select-invitation-inv-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('select-invitation-inv-1'));
    await waitFor(() => {
      expect(screen.getByTestId('accept-invitation-inv-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('decline-invitation-inv-1'));

    await waitFor(() => {
      expect(screen.getByTestId('invitation-respond-error')).toHaveTextContent(
        /Only Pending invitations/i
      );
    });
    expect(screen.getByText(/invitation selection was kept/i)).toBeInTheDocument();
    expect(screen.getByTestId('invitation-detail-team')).toHaveTextContent(/HackMatch/i);
  });
});

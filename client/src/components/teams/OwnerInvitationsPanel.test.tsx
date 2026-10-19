import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { OwnerInvitationsPanel } from './OwnerInvitationsPanel';
import * as invitationsApi from './invitationsApi';
import type { TeamVacancyView } from './teamTypes';

vi.mock('./invitationsApi', async () => {
  const actual = await vi.importActual<typeof import('./invitationsApi')>('./invitationsApi');
  return {
    ...actual,
    fetchTeamInvitations: vi.fn(),
    issueTeamInvitation: vi.fn(),
  };
});

const fetchMock = vi.mocked(invitationsApi.fetchTeamInvitations);
const issueMock = vi.mocked(invitationsApi.issueTeamInvitation);

const openVacancy: TeamVacancyView = {
  id: '66666666-6666-4666-8666-666666666666',
  role: 'Frontend',
  skills: ['React'],
  status: 'Open',
};

const inviteeId = '22222222-2222-4222-8222-222222222222';

describe('OwnerInvitationsPanel (US-017 / #162)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    issueMock.mockReset();
  });

  it('shows empty state after successful load with no invitations', async () => {
    fetchMock.mockResolvedValue({
      teamId: 't1',
      invitations: [],
      empty: true,
      message: 'No invitations yet. Invite a Looking-for-Team candidate to an open slot.',
    });

    render(
      <OwnerInvitationsPanel teamId="t1" vacancies={[openVacancy]} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('invitations-empty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('invitations-empty')).toHaveTextContent(/No invitations yet/i);
  });

  it('lists outbound invitations on success', async () => {
    fetchMock.mockResolvedValue({
      teamId: 't1',
      invitations: [
        {
          id: 'inv-1',
          teamId: 't1',
          eventId: 'e1',
          vacancyId: openVacancy.id,
          inviteeParticipantId: inviteeId,
          inviteeHandle: 'mj',
          inviteeDisplayName: 'MJ',
          status: 'Pending',
          requestType: 'Invitation',
          expiresAt: '2026-10-21T12:00:00.000Z',
          createdAt: '2026-10-19T12:00:00.000Z',
          resolvedAt: null,
          vacancyRole: 'Frontend',
          teamName: 'Team',
          expiredByClock: false,
        },
      ],
      empty: false,
      message: null,
    });

    render(<OwnerInvitationsPanel teamId="t1" vacancies={[openVacancy]} />);

    await waitFor(() => {
      expect(screen.getByTestId('invitations-list')).toBeInTheDocument();
    });
    expect(screen.getByText(/mj/i)).toBeInTheDocument();
    expect(screen.getByTestId('invitation-status-inv-1')).toHaveTextContent('Pending');
  });

  it('keeps form values and shows error on invalid invitee UUID', async () => {
    fetchMock.mockResolvedValue({
      teamId: 't1',
      invitations: [],
      empty: true,
      message: 'No invitations yet.',
    });

    render(<OwnerInvitationsPanel teamId="t1" vacancies={[openVacancy]} />);
    await waitFor(() => expect(screen.getByTestId('owner-invite-form')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('invite-participant-input'), {
      target: { value: 'not-a-uuid' },
    });
    fireEvent.click(screen.getByTestId('send-invitation'));

    expect(screen.getByText(/valid participant ID/i)).toBeInTheDocument();
    expect(screen.getByTestId('invite-participant-input')).toHaveValue('not-a-uuid');
    expect(issueMock).not.toHaveBeenCalled();
  });

  it('sends invitation and shows success while refreshing list', async () => {
    fetchMock
      .mockResolvedValueOnce({
        teamId: 't1',
        invitations: [],
        empty: true,
        message: 'No invitations yet.',
      })
      .mockResolvedValueOnce({
        teamId: 't1',
        invitations: [
          {
            id: 'inv-2',
            teamId: 't1',
            eventId: 'e1',
            vacancyId: openVacancy.id,
            inviteeParticipantId: inviteeId,
            inviteeHandle: null,
            inviteeDisplayName: 'Other',
            status: 'Pending',
            requestType: 'Invitation',
            expiresAt: '2026-10-21T12:00:00.000Z',
            createdAt: '2026-10-19T12:00:00.000Z',
            resolvedAt: null,
            vacancyRole: 'Frontend',
            teamName: 'Team',
            expiredByClock: false,
          },
        ],
        empty: false,
        message: null,
      });

    issueMock.mockResolvedValue({
      id: 'inv-2',
      teamId: 't1',
      eventId: 'e1',
      vacancyId: openVacancy.id,
      inviteeParticipantId: inviteeId,
      status: 'Pending',
      requestType: 'Invitation',
      expiresAt: '2026-10-21T12:00:00.000Z',
      createdAt: '2026-10-19T12:00:00.000Z',
      teamName: 'Team',
      vacancyRole: 'Frontend',
      source: 'direct',
      notice: 'Pending invitation created.',
    });

    render(<OwnerInvitationsPanel teamId="t1" vacancies={[openVacancy]} />);
    await waitFor(() => expect(screen.getByTestId('send-invitation')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('invite-participant-input'), {
      target: { value: inviteeId },
    });
    fireEvent.click(screen.getByTestId('send-invitation'));

    await waitFor(() => {
      expect(screen.getByTestId('invite-form-success')).toBeInTheDocument();
    });
    expect(issueMock).toHaveBeenCalledWith('t1', {
      vacancyId: openVacancy.id,
      inviteeParticipantId: inviteeId,
      source: 'direct',
    });
    expect(screen.getByTestId('invitations-list')).toBeInTheDocument();
  });

  it('shows list error with retry and keeps panel context', async () => {
    fetchMock.mockRejectedValue(
      new invitationsApi.TeamInvitationsApiError(
        403,
        'FORBIDDEN_NOT_TEAM_OWNER',
        undefined,
        undefined,
        'You are not the owner of this team.'
      )
    );

    render(<OwnerInvitationsPanel teamId="t1" vacancies={[openVacancy]} />);

    await waitFor(() => {
      expect(screen.getByTestId('invitations-list-error')).toBeInTheDocument();
    });
    expect(screen.getByText(/not the owner/i)).toBeInTheDocument();
    expect(screen.getByText(/were kept/i)).toBeInTheDocument();
    expect(screen.getByTestId('owner-invite-form')).toBeInTheDocument();
  });

  it('maps #163 eligibility field errors and keeps draft values', async () => {
    fetchMock.mockResolvedValue({
      teamId: 't1',
      invitations: [],
      empty: true,
      message: 'No invitations yet.',
    });
    issueMock.mockRejectedValue(
      new invitationsApi.TeamInvitationsApiError(
        409,
        'INVITEE_NOT_AVAILABLE',
        {
          inviteeParticipantId:
            'This candidate is not Looking for Team and cannot be invited.',
        },
        undefined,
        'This candidate is not Looking for Team and cannot be invited.'
      )
    );

    render(<OwnerInvitationsPanel teamId="t1" vacancies={[openVacancy]} />);
    await waitFor(() => expect(screen.getByTestId('send-invitation')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('invite-participant-input'), {
      target: { value: inviteeId },
    });
    fireEvent.click(screen.getByTestId('send-invitation'));

    await waitFor(() => {
      expect(screen.getByTestId('invite-form-error')).toHaveTextContent(/Looking for Team/i);
    });
    expect(screen.getByTestId('invite-participant-input')).toHaveValue(inviteeId);
    expect(screen.getByTestId('owner-invite-form')).toBeInTheDocument();
  });
});

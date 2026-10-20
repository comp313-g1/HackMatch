import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OwnerApplicationsPanel } from './OwnerApplicationsPanel';
import * as applicationsApi from './applicationsApi';

vi.mock('./applicationsApi', async () => {
  const actual = await vi.importActual<typeof import('./applicationsApi')>('./applicationsApi');
  return {
    ...actual,
    fetchTeamApplications: vi.fn(),
    approveTeamApplication: vi.fn(),
    declineTeamApplication: vi.fn(),
  };
});

const fetchMock = vi.mocked(applicationsApi.fetchTeamApplications);
const approveMock = vi.mocked(applicationsApi.approveTeamApplication);
const declineMock = vi.mocked(applicationsApi.declineTeamApplication);
const application: applicationsApi.OwnerApplicationReviewItem = {
  id: 'app-1',
  teamId: 'team-1',
  eventId: 'event-1',
  vacancyId: 'vacancy-1',
  applicantParticipantId: 'participant-1',
  applicantDisplayName: 'Grace Hopper',
  applicantHandle: 'grace',
  primaryRole: 'Backend',
  institution: 'George Brown College',
  skills: ['TypeScript', 'PostgreSQL'],
  portfolios: [{ url: 'https://example.com/grace', label: 'Projects' }],
  status: 'Pending',
  statusLabel: 'Pending Review',
  requestType: 'Application',
  message: 'I would love to help with the API.',
  createdAt: '2026-10-20T16:00:00.000Z',
  teamName: 'HackMatch Innovators',
  vacancyRole: 'Backend',
};

const approvalResult: applicationsApi.ApplicationApprovalResult = {
  approved: true,
  application: {
    id: 'app-1',
    teamId: 'team-1',
    eventId: 'event-1',
    vacancyId: 'vacancy-1',
    applicantParticipantId: 'participant-1',
    status: 'Accepted',
    statusLabel: 'Accepted',
    requestType: 'Application',
    resolvedAt: '2026-10-20T18:00:00.000Z',
    teamName: 'HackMatch Innovators',
    vacancyRole: 'Backend',
  },
  membership: {
    id: 'membership-1',
    teamId: 'team-1',
    eventId: 'event-1',
    participantId: 'participant-1',
    role: 'Member',
    status: 'Confirmed',
    joinedAt: '2026-10-20T18:00:00.000Z',
  },
  vacancy: { id: 'vacancy-1', role: 'Backend', status: 'Filled' },
  memberCount: 3,
  maxTeamSize: 4,
  availabilityCleared: true,
  membershipCommitted: true,
  cascade: {
    winningRequestId: 'app-1',
    eventInvitationsCanceled: 0,
    eventApplicationsWithdrawn: 0,
    slotRequestsCanceled: 0,
    teamRequestsCanceled: 0,
    teamNowFull: false,
  },
  notice: 'Application approved and membership confirmed.',
};

const declineResult: applicationsApi.ApplicationDeclineResult = {
  decision: 'decline',
  application: {
    id: 'app-1',
    teamId: 'team-1',
    eventId: 'event-1',
    vacancyId: 'vacancy-1',
    applicantParticipantId: 'participant-1',
    status: 'Declined',
    statusLabel: 'Declined',
    requestType: 'Application',
    message: application.message,
    resolvedAt: '2026-10-20T18:00:00.000Z',
    cancelReason: 'OWNER_DECLINED',
    teamName: 'HackMatch Innovators',
    vacancyRole: 'Backend',
  },
  changed: true,
  idempotent: false,
  alerts: [
    {
      audience: 'applicant',
      type: 'team_application_declined',
      message: 'Your application to HackMatch Innovators was declined.',
    },
    {
      audience: 'owner',
      type: 'team_application_declined',
      message: "Grace Hopper's application was declined.",
    },
  ],
  effects: {
    applicationChanged: true,
    applicantAlertCreated: true,
    ownerAlertCreated: true,
    pendingQuotaReleased: true,
    availabilityChanged: false,
    membershipChanged: false,
    vacancyChanged: false,
    capacityChanged: false,
  },
  notice: 'Application declined. The applicant was notified and the vacancy remains open.',
};

describe('OwnerApplicationsPanel (US-020 / #188 / #190 / #191 / #192)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    approveMock.mockReset();
    declineMock.mockReset();
  });

  it('shows an accessible loading state', () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));

    render(<OwnerApplicationsPanel teamId="team-1" />);

    expect(screen.getByRole('status')).toHaveTextContent(/loading pending applications/i);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the pending review and permitted self-declared fields', async () => {
    fetchMock.mockResolvedValue({
      teamId: 'team-1',
      applications: [application],
      empty: false,
      message: null,
    });

    render(<OwnerApplicationsPanel teamId="team-1" />);

    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeInTheDocument());
    expect(screen.getByText('@grace')).toBeInTheDocument();
    expect(screen.getAllByText('Backend').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Pending Review')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
    expect(screen.getByText(application.message as string)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Projects/i })).toHaveAttribute(
      'href',
      'https://example.com/grace'
    );
  });

  it('renders the explicit empty state', async () => {
    fetchMock.mockResolvedValue({
      teamId: 'team-1',
      applications: [],
      empty: true,
      message: 'No pending applications to review.',
    });

    render(<OwnerApplicationsPanel teamId="team-1" />);

    expect(await screen.findByTestId('applications-empty')).toHaveTextContent(
      'No pending applications to review.'
    );
  });

  it('shows an owner-only permission error with retry', async () => {
    fetchMock.mockRejectedValue(
      new applicationsApi.ApplicationsApiError(
        403,
        'FORBIDDEN_NOT_TEAM_OWNER',
        undefined,
        undefined,
        'You are not the owner of this team.'
      )
    );

    render(<OwnerApplicationsPanel teamId="team-1" />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/only the team owner/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('keeps existing application data when a refresh fails', async () => {
    fetchMock
      .mockResolvedValueOnce({
        teamId: 'team-1',
        applications: [application],
        empty: false,
        message: null,
      })
      .mockRejectedValueOnce(
        new applicationsApi.ApplicationsApiError(
          503,
          'UNAVAILABLE',
          undefined,
          undefined,
          'Review service is temporarily unavailable.'
        )
      );

    render(<OwnerApplicationsPanel teamId="team-1" />);
    await screen.findByText(/Grace Hopper/);

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/temporarily unavailable/i);
    expect(alert).toHaveTextContent(/previously loaded applications are still shown/i);
    expect(screen.getByText(/Grace Hopper/)).toBeInTheDocument();
  });

  it('shows validation feedback without discarding an already loaded review', async () => {
    fetchMock
      .mockResolvedValueOnce({
        teamId: 'team-1',
        applications: [application],
        empty: false,
        message: null,
      })
      .mockRejectedValueOnce(
        new applicationsApi.ApplicationsApiError(
          400,
          'VALIDATION_ERROR',
          { teamId: 'Team id must be a valid UUID.' },
          undefined,
          'Team id must be a valid UUID.'
        )
      );

    render(<OwnerApplicationsPanel teamId="team-1" />);
    await screen.findByText('Grace Hopper');

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/valid UUID/i);
    expect(alert).toHaveTextContent(/previously loaded applications are still shown/i);
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByText(application.message as string)).toBeInTheDocument();
  });

  it('approves an application, removes it from the queue, and reports success', async () => {
    const onApproved = vi.fn();
    fetchMock.mockResolvedValue({
      teamId: 'team-1',
      applications: [application],
      empty: false,
      message: null,
    });
    approveMock.mockResolvedValue(approvalResult);

    render(<OwnerApplicationsPanel teamId="team-1" onApproved={onApproved} />);
    fireEvent.click(await screen.findByRole('button', { name: /approve application/i }));

    await waitFor(() => expect(approveMock).toHaveBeenCalledWith('app-1'));
    expect(await screen.findByTestId('application-decision-success')).toHaveTextContent(
      /membership confirmed/i
    );
    expect(screen.getByTestId('applications-empty')).toHaveTextContent(
      /no pending applications/i
    );
    expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument();
    expect(onApproved).toHaveBeenCalledWith(approvalResult, application);
  });

  it('removes other reviews canceled for the filled slot and reports cascade effects', async () => {
    const sameSlot = {
      ...application,
      id: 'app-2',
      applicantParticipantId: 'participant-2',
      applicantDisplayName: 'Same Slot Applicant',
    };
    const otherSlot = {
      ...application,
      id: 'app-3',
      applicantParticipantId: 'participant-3',
      applicantDisplayName: 'Other Slot Applicant',
      vacancyId: 'vacancy-2',
      vacancyRole: 'Frontend',
    };
    fetchMock.mockResolvedValue({
      teamId: 'team-1',
      applications: [application, sameSlot, otherSlot],
      empty: false,
      message: null,
    });
    approveMock.mockResolvedValue({
      ...approvalResult,
      cascade: {
        ...approvalResult.cascade,
        eventInvitationsCanceled: 1,
        slotRequestsCanceled: 1,
      },
    });

    render(<OwnerApplicationsPanel teamId="team-1" />);
    fireEvent.click(await screen.findByTestId('approve-application-app-1'));

    expect(await screen.findByTestId('application-decision-success')).toHaveTextContent(
      /cleared 2 competing requests/i
    );
    expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument();
    expect(screen.queryByText('Same Slot Applicant')).not.toBeInTheDocument();
    expect(screen.getByText('Other Slot Applicant')).toBeInTheDocument();
  });

  it('clears every remaining review when approval fills the team', async () => {
    const otherSlot = {
      ...application,
      id: 'app-2',
      applicantParticipantId: 'participant-2',
      applicantDisplayName: 'Other Applicant',
      vacancyId: 'vacancy-2',
      vacancyRole: 'Frontend',
    };
    fetchMock.mockResolvedValue({
      teamId: 'team-1',
      applications: [application, otherSlot],
      empty: false,
      message: null,
    });
    approveMock.mockResolvedValue({
      ...approvalResult,
      memberCount: 4,
      cascade: {
        ...approvalResult.cascade,
        teamRequestsCanceled: 1,
        teamNowFull: true,
      },
    });

    render(<OwnerApplicationsPanel teamId="team-1" />);
    fireEvent.click(await screen.findByTestId('approve-application-app-1'));

    expect(await screen.findByTestId('applications-empty')).toHaveTextContent(
      /no pending applications/i
    );
    expect(screen.queryByText('Other Applicant')).not.toBeInTheDocument();
  });

  it('preserves the review when an atomic capacity check rejects approval', async () => {
    fetchMock.mockResolvedValue({
      teamId: 'team-1',
      applications: [application],
      empty: false,
      message: null,
    });
    approveMock.mockRejectedValue(
      new applicationsApi.ApplicationsApiError(
        409,
        'TEAM_CAPACITY_REACHED',
        { _form: 'This team is already at its maximum size.' },
        { memberCount: 4, maxTeamSize: 4 },
        'This team is already at its maximum size.'
      )
    );

    render(<OwnerApplicationsPanel teamId="team-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /approve application/i }));

    expect(await screen.findByTestId('application-decision-error')).toHaveTextContent(
      /maximum size/i
    );
    expect(screen.getByTestId('application-decision-error')).toHaveTextContent(
      /review details were kept/i
    );
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByText(application.message as string)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve application/i })).toBeEnabled();
  });

  it('declines an application, reports both alerts, and leaves roster state unchanged', async () => {
    const onDeclined = vi.fn();
    fetchMock.mockResolvedValue({
      teamId: 'team-1',
      applications: [application],
      empty: false,
      message: null,
    });
    declineMock.mockResolvedValue(declineResult);

    render(<OwnerApplicationsPanel teamId="team-1" onDeclined={onDeclined} />);
    fireEvent.click(await screen.findByRole('button', { name: /decline application/i }));

    await waitFor(() => expect(declineMock).toHaveBeenCalledWith('app-1'));
    expect(await screen.findByTestId('application-decision-success')).toHaveTextContent(
      /applicant was notified/i
    );
    expect(screen.getByTestId('applications-empty')).toHaveTextContent(
      /no pending applications/i
    );
    expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument();
    expect(declineResult.alerts.map((alert) => alert.audience)).toEqual([
      'applicant',
      'owner',
    ]);
    expect(declineResult.effects).toMatchObject({
      pendingQuotaReleased: true,
      availabilityChanged: false,
      membershipChanged: false,
      vacancyChanged: false,
      capacityChanged: false,
    });
    expect(onDeclined).toHaveBeenCalledWith(declineResult, application);
  });

  it('preserves the review when a stale decline is rejected', async () => {
    fetchMock.mockResolvedValue({
      teamId: 'team-1',
      applications: [application],
      empty: false,
      message: null,
    });
    declineMock.mockRejectedValue(
      new applicationsApi.ApplicationsApiError(
        409,
        'APPLICATION_NOT_DECLINABLE',
        { _form: 'Only Pending Review applications can be declined.' },
        { status: 'Accepted' },
        'Only Pending Review applications can be declined.'
      )
    );

    render(<OwnerApplicationsPanel teamId="team-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /decline application/i }));

    expect(await screen.findByTestId('application-decision-error')).toHaveTextContent(
      /only pending review applications/i
    );
    expect(screen.getByTestId('application-decision-error')).toHaveTextContent(
      /review details were kept/i
    );
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByText(application.message as string)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /decline application/i })).toBeEnabled();
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MyApplicationsPanel } from './MyApplicationsPanel';
import * as applicationsApi from './applicationsApi';

vi.mock('./applicationsApi', async () => {
  const actual = await vi.importActual<typeof import('./applicationsApi')>('./applicationsApi');
  return {
    ...actual,
    fetchMyApplications: vi.fn(),
    withdrawTeamApplication: vi.fn(),
  };
});

const fetchMock = vi.mocked(applicationsApi.fetchMyApplications);
const withdrawMock = vi.mocked(applicationsApi.withdrawTeamApplication);

const pendingApp: applicationsApi.MyApplicationListItem = {
  id: 'app-1',
  teamId: 't1',
  eventId: 'e1',
  vacancyId: 'v1',
  applicantParticipantId: 'p1',
  status: 'Pending',
  statusLabel: 'Pending Review',
  requestType: 'Application',
  message: 'Still interested',
  createdAt: '2026-10-19T12:00:00.000Z',
  resolvedAt: null,
  cancelReason: null,
  teamName: 'HackMatch Innovators',
  vacancyRole: 'Frontend',
  withdrawable: true,
};

describe('MyApplicationsPanel (US-018 / #175)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    withdrawMock.mockReset();
  });

  it('shows loading then Pending Review status rows', async () => {
    fetchMock.mockResolvedValue({
      applications: [pendingApp],
      empty: false,
      message: null,
    });

    render(<MyApplicationsPanel />);

    expect(screen.getByTestId('applications-loading')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('application-status-app-1')).toHaveTextContent('Pending Review');
    });
    expect(screen.getByTestId('withdraw-application-app-1')).toBeInTheDocument();
  });

  it('shows empty state guidance when there are no applications', async () => {
    fetchMock.mockResolvedValue({
      applications: [],
      empty: true,
      message: 'No applications yet. Browse open teams and apply to an open slot.',
    });

    render(<MyApplicationsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('applications-empty')).toHaveTextContent(/No applications yet/i);
    });
  });

  it('keeps list and shows error when load fails (NR-017)', async () => {
    fetchMock.mockRejectedValue(
      new applicationsApi.ApplicationsApiError(500, 'UNKNOWN_ERROR', undefined, undefined, 'Boom')
    );

    render(<MyApplicationsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('applications-list-error')).toHaveTextContent(/Boom/i);
    });
    expect(screen.getByText(/application list was kept/i)).toBeInTheDocument();
  });

  it('withdraws Pending application and shows applicant/owner status alert (US-018-T5)', async () => {
    fetchMock
      .mockResolvedValueOnce({
        applications: [pendingApp],
        empty: false,
        message: null,
      })
      .mockResolvedValueOnce({
        applications: [
          {
            ...pendingApp,
            status: 'Withdrawn',
            statusLabel: 'Withdrawn',
            withdrawable: false,
            resolvedAt: '2026-10-19T16:00:00.000Z',
            cancelReason: 'APPLICANT_WITHDRAWN',
          },
        ],
        empty: false,
        message: null,
      });

    withdrawMock.mockResolvedValue({
      application: {
        id: pendingApp.id,
        teamId: pendingApp.teamId,
        eventId: pendingApp.eventId,
        vacancyId: pendingApp.vacancyId,
        applicantParticipantId: pendingApp.applicantParticipantId,
        status: 'Withdrawn',
        statusLabel: 'Withdrawn',
        requestType: 'Application',
        message: pendingApp.message,
        resolvedAt: '2026-10-19T16:00:00.000Z',
        cancelReason: 'APPLICANT_WITHDRAWN',
        teamName: pendingApp.teamName,
        vacancyRole: pendingApp.vacancyRole,
      },
      changed: true,
      idempotent: false,
      alerts: [
        {
          audience: 'applicant',
          type: 'team_application_withdrawn',
          message: 'You withdrew your application to "HackMatch Innovators" for the Frontend slot.',
        },
        {
          audience: 'owner',
          type: 'team_application_withdrawn',
          message:
            'An applicant withdrew their Pending Review application for the Frontend slot on "HackMatch Innovators".',
        },
      ],
      notice:
        'Pending Review application withdrawn. Your pending quota for this event is released.',
    });

    const onStatusNotice = vi.fn();
    render(<MyApplicationsPanel onStatusNotice={onStatusNotice} />);

    await waitFor(() => {
      expect(screen.getByTestId('withdraw-application-app-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('withdraw-application-app-1'));

    await waitFor(() => {
      expect(screen.getByTestId('application-withdraw-success')).toHaveTextContent(/withdrawn/i);
    });
    expect(screen.getByTestId('application-status-alert')).toHaveTextContent(/You withdrew/i);
    expect(onStatusNotice).toHaveBeenCalled();
    expect(withdrawMock).toHaveBeenCalledWith('app-1');
    await waitFor(() => {
      expect(screen.getByTestId('application-status-app-1')).toHaveTextContent('Withdrawn');
    });
  });

  it('keeps list rows when withdraw fails', async () => {
    fetchMock.mockResolvedValue({
      applications: [pendingApp],
      empty: false,
      message: null,
    });
    withdrawMock.mockRejectedValue(
      new applicationsApi.ApplicationsApiError(
        409,
        'APPLICATION_NOT_WITHDRAWABLE',
        { _form: 'Only Pending Review applications can be withdrawn.' },
        undefined,
        'Only Pending Review applications can be withdrawn.'
      )
    );

    render(<MyApplicationsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('withdraw-application-app-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('withdraw-application-app-1'));

    await waitFor(() => {
      expect(screen.getByTestId('application-withdraw-error')).toHaveTextContent(
        /Only Pending Review/i
      );
    });
    expect(screen.getByText(/application list was kept/i)).toBeInTheDocument();
    expect(screen.getByTestId('application-status-app-1')).toHaveTextContent('Pending Review');
  });
});

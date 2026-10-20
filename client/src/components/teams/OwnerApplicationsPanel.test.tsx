import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OwnerApplicationsPanel } from './OwnerApplicationsPanel';
import * as applicationsApi from './applicationsApi';

vi.mock('./applicationsApi', async () => {
  const actual = await vi.importActual<typeof import('./applicationsApi')>('./applicationsApi');
  return { ...actual, fetchTeamApplications: vi.fn() };
});

const fetchMock = vi.mocked(applicationsApi.fetchTeamApplications);
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

describe('OwnerApplicationsPanel (US-020 / #188)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
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
});

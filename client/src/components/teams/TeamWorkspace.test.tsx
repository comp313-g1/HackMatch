import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TeamWorkspace } from './TeamWorkspace';
import * as teamApi from './teamApi';
import type { TeamView } from './teamTypes';

vi.mock('./teamApi', async () => {
  const actual = await vi.importActual<typeof import('./teamApi')>('./teamApi');
  return {
    ...actual,
    fetchMyTeam: vi.fn(),
  };
});

describe('TeamWorkspace component tests (US-012 / Task 8 / #125)', () => {
  const sampleTeam: TeamView = {
    id: 't-123',
    eventId: 'e-123',
    name: 'HackMatch Innovators',
    pitch: 'Building accessible software',
    goal: 'Project Completion',
    commitmentHours: 20,
    communicationLink: 'https://discord.gg/test',
    recruitmentStatus: 'Open',
    lockedAt: null,
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-18T10:00:00.000Z',
    members: [
      {
        participantId: 'p-1',
        displayName: 'Ada Lovelace',
        role: 'Owner',
        joinedAt: '2026-10-18T10:00:00.000Z',
      },
    ],
    vacancies: [],
    limits: {
      maxTeamSize: 4,
      confirmedMembers: 1,
      openSlots: 0,
      remainingCapacity: 3,
    },
    lifecycle: {
      mutable: true,
      reason: null,
    },
    viewerRole: 'Owner',
    viewerParticipantId: 'p-1',
    canLeave: false,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading state initially with role="status" and aria-busy="true"', () => {
    vi.mocked(teamApi.fetchMyTeam).mockReturnValue(new Promise(() => {}));

    render(<TeamWorkspace eventId="e-123" />);

    const loader = screen.getByRole('status');
    expect(loader).toBeInTheDocument();
    expect(loader).toHaveAttribute('aria-busy', 'true');
    expect(loader).toHaveTextContent(/loading your team…/i);
  });

  it('renders unauthorized alert when fetchMyTeam throws AuthRequiredError', async () => {
    vi.mocked(teamApi.fetchMyTeam).mockRejectedValueOnce(
      new teamApi.AuthRequiredError()
    );

    render(<TeamWorkspace eventId="e-123" />);

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/you need to sign in to manage a team/i);
    });
  });

  it('renders forbidden alert when server returns 403', async () => {
    vi.mocked(teamApi.fetchMyTeam).mockRejectedValueOnce(
      new teamApi.TeamApiError(
        403,
        'FORBIDDEN_ROLE',
        undefined,
        undefined,
        undefined,
        'Only participants can manage teams.'
      )
    );

    render(<TeamWorkspace eventId="e-123" />);

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Only participants can manage teams.');
    });
  });

  it('renders load error with Retry button on 500 failure and retries successfully', async () => {
    vi.mocked(teamApi.fetchMyTeam)
      .mockRejectedValueOnce(
        new teamApi.TeamApiError(500, 'INTERNAL_ERROR', undefined, undefined, undefined, 'Server error')
      )
      .mockResolvedValueOnce(sampleTeam);

    render(<TeamWorkspace eventId="e-123" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Server error');
    });

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByDisplayValue('HackMatch Innovators')).toBeInTheDocument();
    });
  });

  it('renders empty state when user has no team, with intro text and create form', async () => {
    vi.mocked(teamApi.fetchMyTeam).mockResolvedValueOnce(null);

    render(<TeamWorkspace eventId="e-123" />);

    await waitFor(() => {
      expect(screen.getByText('Create Your Hackathon Team')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /create team/i })).toBeInTheDocument();
    });
  });

  it('renders active workspace with editor form, vacancy panel, and roster panel', async () => {
    vi.mocked(teamApi.fetchMyTeam).mockResolvedValueOnce(sampleTeam);

    render(<TeamWorkspace eventId="e-123" />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('HackMatch Innovators')).toBeInTheDocument();
      expect(screen.getByText('Recruiting Roles & Open Slots')).toBeInTheDocument();
      expect(screen.getByText('Team Roster')).toBeInTheDocument();
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    });
  });

  it('renders roster status view for confirmed non-owner members (#185)', async () => {
    const memberTeam: TeamView = {
      ...sampleTeam,
      viewerRole: 'Member',
      viewerParticipantId: 'p-member',
      canLeave: true,
      members: [
        ...sampleTeam.members,
        {
          participantId: 'p-member',
          displayName: 'Grace Hopper',
          role: 'Member',
          joinedAt: '2026-10-20T12:00:00.000Z',
        },
      ],
      limits: {
        ...sampleTeam.limits,
        confirmedMembers: 2,
        remainingCapacity: 2,
      },
    };
    vi.mocked(teamApi.fetchMyTeam).mockResolvedValueOnce(memberTeam);

    render(<TeamWorkspace eventId="e-123" />);

    await waitFor(() => {
      expect(screen.getByTestId('roster-status-view')).toBeInTheDocument();
    });
    expect(screen.getByTestId('roster-team-name')).toHaveTextContent('HackMatch Innovators');
    expect(screen.getByTestId('roster-you-badge')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /leave team/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disband team/i })).not.toBeInTheDocument();
  });

  it('renders read-only note banner and disables controls when team lifecycle is not mutable', async () => {
    const lockedTeam: TeamView = {
      ...sampleTeam,
      recruitmentStatus: 'Locked',
      lockedAt: '2026-10-19T15:30:00.000Z',
      lifecycle: {
        mutable: false,
        reason: 'Locked',
      },
      viewerRole: 'Owner',
      viewerParticipantId: 'p-1',
      canLeave: false,
    };

    vi.mocked(teamApi.fetchMyTeam).mockResolvedValueOnce(lockedTeam);

    render(<TeamWorkspace eventId="e-123" />);

    await waitFor(() => {
      const note = screen.getByRole('note');
      expect(note).toHaveTextContent(/team recruitment is locked/i);
      expect(note).toHaveTextContent(/locked at/i);
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /disband team/i })).toBeDisabled();
    });
  });

  it('resets to empty state and shows status banner when team is disbanded', async () => {
    vi.mocked(teamApi.fetchMyTeam).mockResolvedValueOnce(sampleTeam);
    vi.spyOn(teamApi, 'disbandTeam').mockResolvedValueOnce({
      releasedMembers: 1,
      canceledRequests: 0,
    });

    render(<TeamWorkspace eventId="e-123" />);

    await waitFor(() => {
      expect(screen.getByText('Team Roster')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /disband team/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, disband team/i }));

    await waitFor(() => {
      expect(screen.getByText('Create Your Hackathon Team')).toBeInTheDocument();
      expect(
        screen.getByText('Team disbanded. All pending requests were canceled.')
      ).toBeInTheDocument();
    });
  });
});

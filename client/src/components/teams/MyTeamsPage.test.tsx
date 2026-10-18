import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MyTeamsPage } from './MyTeamsPage';
import * as teamApi from './teamApi';
import type { TeamView } from './teamTypes';
import * as landingDataModule from '../landing/landingData';

vi.mock('./teamApi', async () => {
  const actual = await vi.importActual<typeof import('./teamApi')>('./teamApi');
  return {
    ...actual,
    fetchMyTeam: vi.fn(),
  };
});

describe('MyTeamsPage component (teams.html wireframe)', () => {
  const sampleTeam: TeamView = {
    id: 't-100',
    eventId: 'e-100',
    name: 'Deep Root',
    pitch: 'Building an accessible forest-trail planner with offline maps.',
    goal: 'Project Completion',
    commitmentHours: 15,
    communicationLink: 'https://discord.gg/deeproot',
    recruitmentStatus: 'Open',
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-18T10:00:00.000Z',
    members: [
      {
        participantId: 'p-1',
        displayName: 'maplefox',
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
  };

  const mockOnCreateTeam = vi.fn();
  const mockOnSelectTeam = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    mockOnCreateTeam.mockClear();
    mockOnSelectTeam.mockClear();
  });

  it('renders loading state initially with role="status"', () => {
    vi.spyOn(landingDataModule, 'VERIFIED_EVENTS', 'get').mockReturnValue([
      {
        id: 'e-100',
        name: 'ForestCode Hack',
        format: 'In-Person',
        time: 'Upcoming',
        location: 'Vancouver',
        country: 'Canada',
        dates: 'Nov 1 - 3, 2026',
        openTeams: 5,
        tags: ['Eco', 'Mapping'],
      },
    ]);
    vi.mocked(teamApi.fetchMyTeam).mockReturnValue(new Promise(() => {}));

    render(
      <MyTeamsPage
        onCreateTeam={mockOnCreateTeam}
        onSelectTeam={mockOnSelectTeam}
      />
    );

    const loader = screen.getByRole('status');
    expect(loader).toBeInTheDocument();
    expect(loader).toHaveTextContent(/loading your teams…/i);
  });

  it('renders empty state when user has no teams, with "Create a team" and "Browse Hackathons" buttons', async () => {
    render(
      <MyTeamsPage
        onCreateTeam={mockOnCreateTeam}
        onSelectTeam={mockOnSelectTeam}
      />
    );

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { level: 1, name: /my teams/i })).toBeInTheDocument();
    expect(screen.getByText(/you haven’t joined or created any teams yet/i)).toBeInTheDocument();

    const browseBtn = screen.getByRole('button', { name: /browse hackathons to form a team/i });
    expect(browseBtn).toBeInTheDocument();
    fireEvent.click(browseBtn);
    expect(mockOnCreateTeam).toHaveBeenCalledTimes(1);

    const createHeaderBtn = screen.getByRole('button', { name: /^create a team$/i });
    fireEvent.click(createHeaderBtn);
    expect(mockOnCreateTeam).toHaveBeenCalledTimes(2);
  });

  it('renders sign in required alert when fetchMyTeam throws AuthRequiredError', async () => {
    // Stub VERIFIED_EVENTS to trigger a fetch attempt
    vi.spyOn(landingDataModule, 'VERIFIED_EVENTS', 'get').mockReturnValue([
      {
        id: 'e-100',
        name: 'ForestCode Hack',
        format: 'In-Person',
        time: 'Upcoming',
        location: 'Vancouver',
        country: 'Canada',
        dates: 'Nov 1 - 3, 2026',
        openTeams: 5,
        tags: ['Eco', 'Mapping'],
      },
    ]);

    vi.mocked(teamApi.fetchMyTeam).mockRejectedValueOnce(new teamApi.AuthRequiredError());

    render(
      <MyTeamsPage
        onCreateTeam={mockOnCreateTeam}
        onSelectTeam={mockOnSelectTeam}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/you need to sign in to view your teams/i);
    });
  });

  it('renders team card matching teams.html wireframe when teams exist', async () => {
    vi.spyOn(landingDataModule, 'VERIFIED_EVENTS', 'get').mockReturnValue([
      {
        id: 'e-100',
        name: 'ForestCode Hack',
        format: 'In-Person',
        time: 'Upcoming',
        location: 'Vancouver',
        country: 'Canada',
        dates: 'Nov 1 - 3, 2026',
        openTeams: 5,
        tags: ['Eco', 'Mapping'],
      },
    ]);

    vi.mocked(teamApi.fetchMyTeam).mockResolvedValueOnce(sampleTeam);

    render(
      <MyTeamsPage
        onCreateTeam={mockOnCreateTeam}
        onSelectTeam={mockOnSelectTeam}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /my teams/i })).toBeInTheDocument();
    });

    // Team Card elements
    expect(screen.getByRole('heading', { level: 2, name: /deep root/i })).toBeInTheDocument();
    expect(screen.getByText(/forestcode hack · open/i)).toBeInTheDocument();
    expect(screen.getByText(/1 member/i)).toBeInTheDocument();
    expect(
      screen.getByText(/building an accessible forest-trail planner with offline maps/i)
    ).toBeInTheDocument();

    // Member chip and initial badge
    expect(screen.getByText(/maplefox · owner/i)).toBeInTheDocument();
    expect(screen.getByText('M')).toBeInTheDocument();

    // Clicking team button calls onSelectTeam
    const teamBtn = screen.getByRole('button', { name: /deep root/i });
    fireEvent.click(teamBtn);
    expect(mockOnSelectTeam).toHaveBeenCalledWith('e-100', 't-100');
  });
});

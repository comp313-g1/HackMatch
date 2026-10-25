import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MyTeamsPage } from './MyTeamsPage';
import * as teamApi from './teamApi';
import type { TeamView } from './teamTypes';

vi.mock('./teamApi', async () => {
  const actual = await vi.importActual<typeof import('./teamApi')>('./teamApi');
  return {
    ...actual,
    fetchMyTeams: vi.fn(),
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
    lockedAt: null,
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
    viewerRole: 'Owner',
    viewerParticipantId: 'p-1',
    canLeave: false,
  };

  const mockOnCreateTeam = vi.fn();
  const mockOnSelectTeam = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    mockOnCreateTeam.mockClear();
    mockOnSelectTeam.mockClear();
  });

  it('renders loading state initially with role="status"', () => {
    vi.mocked(teamApi.fetchMyTeams).mockReturnValue(new Promise(() => {}));

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

  it('renders empty state when user has no teams, with "Create a team" and "Create a Team" buttons', async () => {
    vi.mocked(teamApi.fetchMyTeams).mockResolvedValueOnce([]);

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

    const buttons = screen.getAllByRole('button', { name: /create a team/i });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]); // Empty state CTA
    expect(mockOnCreateTeam).toHaveBeenCalledTimes(1);

    fireEvent.click(buttons[0]); // Header button
    expect(mockOnCreateTeam).toHaveBeenCalledTimes(2);
  });

  it('renders sign in required alert when fetchMyTeams throws AuthRequiredError', async () => {
    vi.mocked(teamApi.fetchMyTeams).mockRejectedValueOnce(new teamApi.AuthRequiredError());

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
    vi.mocked(teamApi.fetchMyTeams).mockResolvedValueOnce([sampleTeam]);

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
    expect(screen.getByText(/project completion · open/i)).toBeInTheDocument();
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

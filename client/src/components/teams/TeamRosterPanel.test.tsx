import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TeamRosterPanel } from './TeamRosterPanel';
import * as teamApi from './teamApi';
import type { TeamView, TeamMemberView } from './teamTypes';

vi.mock('./teamApi', async () => {
  const actual = await vi.importActual<typeof import('./teamApi')>('./teamApi');
  return {
    ...actual,
    removeMember: vi.fn(),
    disbandTeam: vi.fn(),
  };
});

describe('TeamRosterPanel component tests (US-012 / Task 8 / #125)', () => {
  const mockMembers: TeamMemberView[] = [
    {
      participantId: 'p-owner',
      displayName: 'Ada Lovelace',
      role: 'Owner',
      joinedAt: '2026-10-18T10:00:00.000Z',
    },
    {
      participantId: 'p-member',
      displayName: 'Alan Turing',
      role: 'Member',
      joinedAt: '2026-10-18T10:30:00.000Z',
    },
  ];

  const mockTeam: TeamView = {
    id: 't-123',
    eventId: 'e-123',
    name: 'HackMatch Innovators',
    pitch: 'Building accessible software',
    goal: 'Project Completion',
    commitmentHours: 20,
    communicationLink: null,
    recruitmentStatus: 'Open',
    lockedAt: null,
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-18T10:00:00.000Z',
    members: [mockMembers[0]],
    vacancies: [],
    limits: {
      maxTeamSize: 4,
      confirmedMembers: 1,
      openSlots: 0,
      remainingCapacity: 3,
    },
    lifecycle: { mutable: true, reason: null },
    viewerRole: 'Owner',
    viewerParticipantId: 'p-1',
    canLeave: false,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders members list; owner has NO remove control; non-owner has remove control', () => {
    render(
      <TeamRosterPanel
        teamId="t-123"
        members={mockMembers}
        disabled={false}
        onChanged={vi.fn()}
        onDisbanded={vi.fn()}
      />
    );

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Alan Turing')).toBeInTheDocument();

    // Owner should not have a remove button
    // Only 1 Remove button in the members list (for Alan Turing)
    const removeButtons = screen.getAllByRole('button', { name: /^remove$/i });
    expect(removeButtons).toHaveLength(1);
  });

  it('opens member removal form, enforces required reason, and submits removal', async () => {
    const onChanged = vi.fn();
    vi.mocked(teamApi.removeMember).mockResolvedValueOnce({
      availabilityRestored: true,
      team: mockTeam,
    });

    render(
      <TeamRosterPanel
        teamId="t-123"
        members={mockMembers}
        disabled={false}
        onChanged={onChanged}
        onDisbanded={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));

    expect(screen.getByText(/removal reason for alan turing/i)).toBeInTheDocument();

    // Try submitting without reason
    fireEvent.click(screen.getByRole('button', { name: /confirm remove/i }));
    expect(screen.getByText('Removal reason is required.')).toBeInTheDocument();

    // Type valid reason
    fireEvent.change(
      screen.getByLabelText(/reason for removing alan turing/i),
      { target: { value: 'Switched project track' } }
    );

    fireEvent.click(screen.getByRole('button', { name: /confirm remove/i }));

    await waitFor(() => {
      expect(teamApi.removeMember).toHaveBeenCalledWith(
        't-123',
        'p-member',
        'Switched project track'
      );
      expect(onChanged).toHaveBeenCalledWith(mockTeam);
    });
  });

  it('handles Disband Team confirmation workflow', async () => {
    const onDisbanded = vi.fn();
    vi.mocked(teamApi.disbandTeam).mockResolvedValueOnce({
      releasedMembers: 2,
      canceledRequests: 1,
    });

    render(
      <TeamRosterPanel
        teamId="t-123"
        members={mockMembers}
        disabled={false}
        onChanged={vi.fn()}
        onDisbanded={onDisbanded}
      />
    );

    // Click Disband Team
    fireEvent.click(screen.getByRole('button', { name: /disband team/i }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/are you sure you want to disband this team\?/i)).toBeInTheDocument();

    // Cancel first
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(teamApi.disbandTeam).not.toHaveBeenCalled();

    // Click Disband Team again and confirm
    fireEvent.click(screen.getByRole('button', { name: /disband team/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, disband team/i }));

    await waitFor(() => {
      expect(teamApi.disbandTeam).toHaveBeenCalledWith('t-123');
      expect(onDisbanded).toHaveBeenCalled();
    });
  });
});

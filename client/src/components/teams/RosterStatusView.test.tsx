import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RosterStatusView } from './RosterStatusView';
import type { TeamView } from './teamTypes';

const sampleTeam: TeamView = {
  id: 't-1',
  eventId: 'e-1',
  name: 'HackMatch Innovators',
  pitch: 'Building accessible tools',
  goal: 'Project Completion',
  commitmentHours: 20,
  communicationLink: null,
  recruitmentStatus: 'Open',
  createdAt: '2026-10-18T10:00:00.000Z',
  updatedAt: '2026-10-18T10:00:00.000Z',
  members: [
    {
      participantId: 'p-owner',
      displayName: 'Ada',
      role: 'Owner',
      joinedAt: '2026-10-18T10:00:00.000Z',
    },
    {
      participantId: 'p-member',
      displayName: 'Grace',
      role: 'Member',
      joinedAt: '2026-10-20T12:00:00.000Z',
    },
  ],
  vacancies: [
    { id: 'v-1', role: 'Frontend', skills: ['React'], status: 'Filled' },
    { id: 'v-2', role: 'Backend', skills: ['Node'], status: 'Open' },
  ],
  limits: {
    maxTeamSize: 4,
    confirmedMembers: 2,
    openSlots: 1,
    remainingCapacity: 1,
  },
  lifecycle: { mutable: true, reason: null },
  viewerRole: 'Member',
  viewerParticipantId: 'p-member',
  canLeave: true,
};

describe('RosterStatusView (US-019 / #185)', () => {
  it('renders loading state', () => {
    render(<RosterStatusView viewState="loading" />);
    expect(screen.getByTestId('roster-status-loading')).toHaveTextContent(/loading roster/i);
  });

  it('renders empty guidance', () => {
    render(<RosterStatusView viewState="empty" emptyMessage="No roster yet." />);
    expect(screen.getByTestId('roster-status-empty')).toHaveTextContent(/no roster yet/i);
  });

  it('renders default empty guidance when no emptyMessage is provided', () => {
    render(<RosterStatusView viewState="empty" />);
    expect(screen.getByTestId('roster-status-empty')).toHaveTextContent('You are not on a team roster yet.');
  });

  it('renders error with retry and preserves guidance', () => {
    const onRetry = vi.fn();
    render(
      <RosterStatusView
        viewState="error"
        errorMessage="Could not refresh roster."
        onRetry={onRetry}
      />
    );
    expect(screen.getByTestId('roster-status-error')).toHaveTextContent(/could not refresh/i);
    expect(screen.getByText(/previous roster details were kept/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('roster-status-retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows capacity, members, vacancies, and You badge for the viewer', () => {
    render(
      <RosterStatusView
        team={sampleTeam}
        viewerParticipantId="p-member"
        viewState="success"
      />
    );

    expect(screen.getByTestId('roster-team-name')).toHaveTextContent('HackMatch Innovators');
    expect(screen.getByTestId('roster-confirmed-count')).toHaveTextContent('2 / 4');
    expect(screen.getByTestId('roster-open-slots')).toHaveTextContent('1');
    expect(screen.getByTestId('roster-you-badge')).toBeInTheDocument();
    expect(screen.getByTestId('roster-vacancy-status-v-1')).toHaveTextContent('Filled');
    expect(screen.getByTestId('roster-vacancy-status-v-2')).toHaveTextContent('Open');
  });

  it('shows accept-response snapshot with view-team CTA', () => {
    const onViewTeam = vi.fn();
    render(
      <RosterStatusView
        snapshot={{
          teamName: 'HackMatch Innovators',
          vacancyRole: 'Frontend',
          vacancyStatus: 'Filled',
          memberCount: 2,
          maxTeamSize: 4,
          membershipRole: 'Member',
          membershipStatus: 'Confirmed',
          joinedAt: '2026-10-20T12:00:00.000Z',
          availabilityCleared: true,
        }}
        onViewTeam={onViewTeam}
      />
    );

    expect(screen.getByTestId('roster-slot-outcome')).toHaveTextContent(/Frontend/);
    expect(screen.getByTestId('roster-slot-outcome')).toHaveTextContent(/Looking-for-Team was cleared across the platform/i);
    fireEvent.click(screen.getByTestId('roster-view-team'));
    expect(onViewTeam).toHaveBeenCalled();
  });

  it('shows locked lifecycle note when team is not mutable', () => {
    render(
      <RosterStatusView
        team={{
          ...sampleTeam,
          recruitmentStatus: 'Locked',
          lifecycle: { mutable: false, reason: 'Locked' },
          canLeave: false,
        }}
      />
    );
    expect(screen.getByTestId('roster-lifecycle-note')).toHaveTextContent(/locked/i);
  });
});

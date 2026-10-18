import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TeamListingForm } from './TeamListingForm';
import * as teamApi from './teamApi';
import type { TeamView } from './teamTypes';

vi.mock('./teamApi', async () => {
  const actual = await vi.importActual<typeof import('./teamApi')>('./teamApi');
  return {
    ...actual,
    createTeam: vi.fn(),
    updateTeam: vi.fn(),
  };
});

describe('TeamListingForm component tests (US-012 / Task 8 / #125)', () => {
  const mockTeam: TeamView = {
    id: 't-123',
    eventId: 'e-123',
    name: 'HackMatch Innovators',
    pitch: 'Building accessible pair-programming platforms',
    goal: 'Project Completion',
    commitmentHours: 20,
    communicationLink: 'https://discord.gg/hackmatch',
    recruitmentStatus: 'Open',
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-18T10:00:00.000Z',
    members: [],
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

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders create mode with empty fields and default goal/hours', () => {
    render(
      <TeamListingForm
        mode="create"
        eventId="e-123"
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByLabelText(/team name/i)).toHaveValue('');
    expect(screen.getByLabelText(/recruitment pitch/i)).toHaveValue('');
    expect(screen.getByLabelText(/team goal/i)).toHaveValue('Learning');
    expect(screen.getByLabelText(/weekly commitment/i)).toHaveValue('10');
    expect(screen.getByRole('button', { name: /create team/i })).toBeInTheDocument();
  });

  it('renders edit mode pre-populated with existing team data', () => {
    render(
      <TeamListingForm
        mode="edit"
        eventId="e-123"
        team={mockTeam}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByLabelText(/team name/i)).toHaveValue('HackMatch Innovators');
    expect(screen.getByLabelText(/recruitment pitch/i)).toHaveValue(
      'Building accessible pair-programming platforms'
    );
    expect(screen.getByLabelText(/team goal/i)).toHaveValue('Project Completion');
    expect(screen.getByLabelText(/weekly commitment/i)).toHaveValue('20');
    expect(screen.getByLabelText(/communication channel/i)).toHaveValue(
      'https://discord.gg/hackmatch'
    );
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });

  it('updates live pitch character counter when typing into textarea', () => {
    render(
      <TeamListingForm
        mode="create"
        eventId="e-123"
        onSaved={vi.fn()}
      />
    );

    const pitchInput = screen.getByLabelText(/recruitment pitch/i);
    fireEvent.change(pitchInput, { target: { value: 'Hello 🚀' } });

    // 'Hello 🚀' is 7 code points
    expect(screen.getByText('7/500')).toBeInTheDocument();
  });

  it('shows validation errors with role="alert" when required fields are missing', async () => {
    render(
      <TeamListingForm
        mode="create"
        eventId="e-123"
        onSaved={vi.fn()}
      />
    );

    // Name and Pitch are empty by default
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Team name is required.')).toBeInTheDocument();
    expect(screen.getByText('Pitch is required.')).toBeInTheDocument();
  });

  it('submits valid create form, calls createTeam, and invokes onSaved', async () => {
    const onSaved = vi.fn();
    vi.mocked(teamApi.createTeam).mockResolvedValueOnce(mockTeam);

    render(
      <TeamListingForm
        mode="create"
        eventId="e-123"
        onSaved={onSaved}
      />
    );

    fireEvent.change(screen.getByLabelText(/team name/i), {
      target: { value: 'HackMatch Innovators' },
    });
    fireEvent.change(screen.getByLabelText(/recruitment pitch/i), {
      target: { value: 'Building accessible pair-programming platforms' },
    });
    fireEvent.change(screen.getByLabelText(/team goal/i), {
      target: { value: 'Project Completion' },
    });
    fireEvent.change(screen.getByLabelText(/weekly commitment/i), {
      target: { value: '20' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => {
      expect(teamApi.createTeam).toHaveBeenCalledWith({
        eventId: 'e-123',
        name: 'HackMatch Innovators',
        pitch: 'Building accessible pair-programming platforms',
        goal: 'Project Completion',
        commitmentHours: 20,
        communicationLink: null,
      });
      expect(onSaved).toHaveBeenCalledWith(mockTeam);
    });
  });

  it('preserves all entered values when server rejects with an error (NR-010)', async () => {
    vi.mocked(teamApi.createTeam).mockRejectedValueOnce(
      new teamApi.TeamApiError(
        409,
        'ALREADY_CONFIRMED_MEMBER',
        undefined,
        undefined,
        undefined,
        'You are already a confirmed member of a team in this event.'
      )
    );

    render(
      <TeamListingForm
        mode="create"
        eventId="e-123"
        onSaved={vi.fn()}
      />
    );

    const typedName = 'Unique Team Name';
    const typedPitch = 'Unique recruitment pitch description';

    fireEvent.change(screen.getByLabelText(/team name/i), {
      target: { value: typedName },
    });
    fireEvent.change(screen.getByLabelText(/recruitment pitch/i), {
      target: { value: typedPitch },
    });

    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => {
      expect(
        screen.getByText('You are already a confirmed member of a team in this event.')
      ).toBeInTheDocument();
    });

    // Verify all entered values were preserved in the inputs
    expect(screen.getByLabelText(/team name/i)).toHaveValue(typedName);
    expect(screen.getByLabelText(/recruitment pitch/i)).toHaveValue(typedPitch);
  });

  it('disables all controls when disabled prop is true', () => {
    render(
      <TeamListingForm
        mode="edit"
        eventId="e-123"
        team={mockTeam}
        disabled={true}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByLabelText(/team name/i)).toBeDisabled();
    expect(screen.getByLabelText(/recruitment pitch/i)).toBeDisabled();
    expect(screen.getByLabelText(/team goal/i)).toBeDisabled();
    expect(screen.getByLabelText(/weekly commitment/i)).toBeDisabled();
    expect(screen.getByLabelText(/communication channel/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });
});

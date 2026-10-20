import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VacancyPanel } from './VacancyPanel';
import * as teamApi from './teamApi';
import type { TeamView, TeamVacancyView, TeamLimits } from './teamTypes';

vi.mock('./teamApi', async () => {
  const actual = await vi.importActual<typeof import('./teamApi')>('./teamApi');
  return {
    ...actual,
    addVacancy: vi.fn(),
    updateVacancy: vi.fn(),
    removeVacancy: vi.fn(),
  };
});

describe('VacancyPanel component tests (US-012 / Task 8 / #125)', () => {
  const mockLimits: TeamLimits = {
    maxTeamSize: 4,
    confirmedMembers: 1,
    openSlots: 1,
    remainingCapacity: 2,
  };

  const mockVacancies: TeamVacancyView[] = [
    {
      id: 'v-1',
      role: 'Frontend',
      skills: ['React', 'TypeScript'],
      status: 'Open',
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
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-18T10:00:00.000Z',
    members: [],
    vacancies: mockVacancies,
    limits: mockLimits,
    lifecycle: { mutable: true, reason: null },
    viewerRole: 'Owner',
    viewerParticipantId: 'p-1',
    canLeave: false,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders empty state when no vacancies are present', () => {
    render(
      <VacancyPanel
        teamId="t-123"
        vacancies={[]}
        limits={{ ...mockLimits, openSlots: 0, remainingCapacity: 3 }}
        disabled={false}
        onChanged={vi.fn()}
      />
    );

    expect(
      screen.getByText(/no open slots yet — add a role you're recruiting for/i)
    ).toBeInTheDocument();
  });

  it('renders list of vacancies with role, status, and skill chips', () => {
    render(
      <VacancyPanel
        teamId="t-123"
        vacancies={mockVacancies}
        limits={mockLimits}
        disabled={false}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getByText('Frontend')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
  });

  it('disables Add Open Slot button when remainingCapacity is 0', () => {
    render(
      <VacancyPanel
        teamId="t-123"
        vacancies={mockVacancies}
        limits={{ ...mockLimits, remainingCapacity: 0 }}
        disabled={false}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /\+ add open slot/i })).toBeDisabled();
  });

  it('opens add slot form and submits new vacancy', async () => {
    const onChanged = vi.fn();
    vi.mocked(teamApi.addVacancy).mockResolvedValueOnce(mockTeam);

    render(
      <VacancyPanel
        teamId="t-123"
        vacancies={[]}
        limits={mockLimits}
        disabled={false}
        onChanged={onChanged}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /\+ add open slot/i }));

    expect(screen.getByText('Add New Recruitment Slot')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/required skills/i), {
      target: { value: 'Node.js, PostgreSQL' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^add slot$/i }));

    await waitFor(() => {
      expect(teamApi.addVacancy).toHaveBeenCalledWith('t-123', {
        role: 'Frontend',
        skills: ['Node.js', 'PostgreSQL'],
      });
      expect(onChanged).toHaveBeenCalledWith(mockTeam);
    });
  });

  it('opens edit form, pre-fills values, and submits update', async () => {
    const onChanged = vi.fn();
    vi.mocked(teamApi.updateVacancy).mockResolvedValueOnce(mockTeam);

    render(
      <VacancyPanel
        teamId="t-123"
        vacancies={mockVacancies}
        limits={mockLimits}
        disabled={false}
        onChanged={onChanged}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));

    expect(screen.getByText('Edit Recruitment Slot')).toBeInTheDocument();
    expect(screen.getByLabelText(/required skills/i)).toHaveValue('React, TypeScript');

    fireEvent.click(screen.getByRole('button', { name: /update slot/i }));

    await waitFor(() => {
      expect(teamApi.updateVacancy).toHaveBeenCalledWith('t-123', 'v-1', {
        role: 'Frontend',
        skills: ['React', 'TypeScript'],
      });
      expect(onChanged).toHaveBeenCalledWith(mockTeam);
    });
  });

  it('prompts confirmation when removing slot, then invokes removeVacancy', async () => {
    const onChanged = vi.fn();
    vi.mocked(teamApi.removeVacancy).mockResolvedValueOnce({
      canceledRequests: 1,
      team: mockTeam,
    });

    render(
      <VacancyPanel
        teamId="t-123"
        vacancies={mockVacancies}
        limits={mockLimits}
        disabled={false}
        onChanged={onChanged}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));

    expect(
      screen.getByText(/remove this open slot\? any pending requests for it will be canceled\./i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirm remove/i }));

    await waitFor(() => {
      expect(teamApi.removeVacancy).toHaveBeenCalledWith('t-123', 'v-1');
      expect(onChanged).toHaveBeenCalledWith(mockTeam);
    });
  });

  it('renders server capacity error alert when addVacancy fails with CAPACITY_EXCEEDED', async () => {
    vi.mocked(teamApi.addVacancy).mockRejectedValueOnce(
      new teamApi.TeamApiError(
        409,
        'CAPACITY_EXCEEDED',
        { vacancies: 'Team capacity exceeded. 4 members max.' },
        undefined,
        undefined,
        'Team capacity exceeded.'
      )
    );

    render(
      <VacancyPanel
        teamId="t-123"
        vacancies={[]}
        limits={mockLimits}
        disabled={false}
        onChanged={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /\+ add open slot/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add slot$/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Team capacity exceeded. 4 members max.')
      ).toBeInTheDocument();
    });
  });
});

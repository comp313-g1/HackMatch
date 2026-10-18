import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CreateTeamPage } from './CreateTeamPage';
import * as teamApi from './teamApi';
import type { TeamView } from './teamTypes';

vi.mock('./teamApi', async () => {
  const actual = await vi.importActual<typeof import('./teamApi')>('./teamApi');
  return {
    ...actual,
    createTeam: vi.fn(),
    addVacancy: vi.fn(),
  };
});

describe('CreateTeamPage component', () => {
  const sampleCreatedTeam: TeamView = {
    id: 't-new-1',
    eventId: 'e-shadow-1',
    name: 'Apollo Squad',
    pitch: 'Building cutting edge developer tools.',
    goal: 'Project Completion',
    commitmentHours: 20,
    communicationLink: 'https://discord.gg/apollo',
    recruitmentStatus: 'Open',
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-18T10:00:00.000Z',
    members: [
      {
        participantId: 'p-1',
        displayName: 'creator',
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

  const mockOnCancel = vi.fn();
  const mockOnCreated = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    mockOnCancel.mockClear();
    mockOnCreated.mockClear();
  });

  it('renders all fields without any event selector', () => {
    render(<CreateTeamPage onCancel={mockOnCancel} onCreated={mockOnCreated} />);

    expect(screen.getByRole('heading', { level: 1, name: /create a new team/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/team name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description \/ pitch/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/goal/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/estimated hours\/week/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/max team size/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/communication channel link/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/event/i)).not.toBeInTheDocument();

    // Cancel button calls onCancel
    fireEvent.click(screen.getByRole('button', { name: /← back to my teams/i }));
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it('validates required fields on submit', async () => {
    render(<CreateTeamPage onCancel={mockOnCancel} onCreated={mockOnCreated} />);

    fireEvent.click(screen.getByRole('button', { name: /^create team$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/please resolve the errors below/i);
    expect(screen.getByText(/team name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/description \/ pitch is required/i)).toBeInTheDocument();
  });

  it('allows adding and removing vacancy slots dynamically based on max team size', () => {
    render(<CreateTeamPage onCancel={mockOnCancel} onCreated={mockOnCreated} />);

    expect(screen.getByText('0 / 3')).toBeInTheDocument();

    // Change max team size to 5 -> allowed vacancy slots becomes 4
    fireEvent.change(screen.getByLabelText(/max team size/i), { target: { value: '5' } });
    expect(screen.getByText('0 / 4')).toBeInTheDocument();

    // Add first slot
    fireEvent.change(screen.getByLabelText(/required skills/i), {
      target: { value: 'React, TypeScript' },
    });
    fireEvent.click(screen.getByRole('button', { name: /\+ add role slot/i }));

    expect(screen.getByText('1 / 4')).toBeInTheDocument();
    expect(screen.getByText(/slot 1/i)).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();

    // Remove slot
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(screen.getByText('0 / 4')).toBeInTheDocument();
  });

  it('submits successfully and calls onCreated with maxTeamSize', async () => {
    vi.mocked(teamApi.createTeam).mockResolvedValueOnce(sampleCreatedTeam);

    render(<CreateTeamPage onCancel={mockOnCancel} onCreated={mockOnCreated} />);

    fireEvent.change(screen.getByLabelText(/team name/i), { target: { value: 'Apollo Squad' } });
    fireEvent.change(screen.getByLabelText(/description \/ pitch/i), {
      target: { value: 'Building cutting edge developer tools.' },
    });
    fireEvent.change(screen.getByLabelText(/max team size/i), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText(/communication channel link/i), {
      target: { value: 'https://discord.gg/apollo' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^create team$/i }));

    await waitFor(() => {
      expect(teamApi.createTeam).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Apollo Squad',
          pitch: 'Building cutting edge developer tools.',
          communicationLink: 'https://discord.gg/apollo',
          maxTeamSize: 6,
        })
      );
      expect(mockOnCreated).toHaveBeenCalledWith(sampleCreatedTeam);
    });
  });
});

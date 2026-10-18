import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LookingForTeamPage } from './LookingForTeamPage';
import * as availabilityApi from '../services/availabilityApi';

vi.mock('../services/availabilityApi', async () => {
  const actual = await vi.importActual<typeof import('../services/availabilityApi')>(
    '../services/availabilityApi'
  );
  return {
    ...actual,
    fetchMyAvailability: vi.fn(),
    fetchAvailableCandidates: vi.fn(),
    updateMyAvailability: vi.fn(),
  };
});

vi.mock('../config/firebase', () => ({
  auth: {
    currentUser: { uid: 'user-123', email: 'part@example.com' },
    onAuthStateChanged: vi.fn((cb) => {
      cb({ uid: 'user-123', email: 'part@example.com' });
      return () => {};
    }),
  },
}));

describe('LookingForTeamPage Component (US-011 / #US-288)', () => {
  const mockCandidateMe: availabilityApi.AvailableCandidateCard = {
    participantId: 'user-123',
    displayName: 'Dev Alpha',
    handle: 'devalpha',
    institution: 'Centennial College',
    primaryRole: 'Frontend',
    desiredRole: 'Frontend',
    commitmentHours: 20,
    goal: 'Learning',
    skills: ['React', 'TypeScript'],
    portfolioLinks: [{ url: 'https://github.com/devalpha', label: 'GitHub', isSelfDeclared: true }],
    updatedAt: '2026-10-18T10:00:00.000Z',
  };

  const mockCandidateOther: availabilityApi.AvailableCandidateCard = {
    participantId: 'user-456',
    displayName: 'Dev Beta',
    handle: 'devbeta',
    institution: 'University of Toronto',
    primaryRole: 'Backend',
    desiredRole: 'Backend',
    commitmentHours: 35,
    goal: 'Competitive',
    skills: ['Node.js', 'PostgreSQL'],
    portfolioLinks: [],
    updatedAt: '2026-10-18T11:00:00.000Z',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(availabilityApi.fetchMyAvailability).mockResolvedValue({
      participantId: 'user-123',
      isLooking: false,
      desiredRole: null,
      commitmentHours: null,
      goal: null,
      updatedAt: null,
    });
    vi.mocked(availabilityApi.fetchAvailableCandidates).mockResolvedValue([
      mockCandidateMe,
      mockCandidateOther,
    ]);
    vi.mocked(availabilityApi.updateMyAvailability).mockImplementation(async (payload) => ({
      participantId: 'user-123',
      isLooking: payload.isLooking,
      desiredRole: payload.desiredRole ?? null,
      commitmentHours: payload.commitmentHours ?? null,
      goal: payload.goal ?? null,
      updatedAt: new Date().toISOString(),
    }));
  });

  it('renders visitor restriction banner and conceals candidate cards when unauthenticated (AC 3)', async () => {
    render(
      <LookingForTeamPage
        idToken={null}
        isVerifiedParticipant={false}
        currentParticipantId={null}
      />
    );

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Sign In Required to Access Looking for Team');
      expect(
        screen.getByText(/Candidate availability profiles and Looking for Team preferences are protected/i)
      ).toBeInTheDocument();
    });

    // Verify candidate cards are NOT rendered for visitors
    expect(screen.queryByText('Available Candidates Pool')).not.toBeInTheDocument();
    expect(screen.queryByText('Dev Alpha')).not.toBeInTheDocument();
    expect(screen.queryByText('Dev Beta')).not.toBeInTheDocument();
  });

  it('renders loading state initially with role="status"', async () => {
    vi.mocked(availabilityApi.fetchMyAvailability).mockReturnValue(new Promise(() => {}));
    vi.mocked(availabilityApi.fetchAvailableCandidates).mockReturnValue(new Promise(() => {}));

    render(
      <LookingForTeamPage
        idToken="valid-token"
        isVerifiedParticipant={true}
        currentParticipantId="user-123"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Loading available candidates...');
    });
  });

  it('renders availability form and available candidates when authenticated (AC 1 & AC 3)', async () => {
    render(
      <LookingForTeamPage
        idToken="valid-token"
        isVerifiedParticipant={true}
        currentParticipantId="user-123"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Platform-Wide Looking for Team Status')).toBeInTheDocument();
      expect(screen.getByText('Available Candidates Pool')).toBeInTheDocument();
    });

    // Verify candidate cards and "You" badge
    expect(screen.getByText('Dev Alpha')).toBeInTheDocument();
    expect(screen.getByText('Dev Beta')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('preserves user-entered input on client validation errors (NR-010 & AC 2)', async () => {
    render(
      <LookingForTeamPage
        idToken="valid-token"
        isVerifiedParticipant={true}
        currentParticipantId="user-123"
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/Looking for Team \(LFT\)/i)).toBeInTheDocument();
    });

    const toggle = screen.getByLabelText(/Looking for Team \(LFT\)/i);
    fireEvent.click(toggle);

    // Enter out-of-range commitment hours
    const hoursInput = screen.getByLabelText(/Weekly Commitment Hours/i);
    fireEvent.change(hoursInput, { target: { value: '250' } });

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /Save Availability Preferences/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText('Commitment hours must be between 0 and 168.')
      ).toBeInTheDocument();
    });

    // Verify user entered value is strictly preserved per NR-010
    expect((hoursInput as HTMLInputElement).value).toBe('250');
    expect(availabilityApi.updateMyAvailability).not.toHaveBeenCalled();
  });

  it('submits valid availability preferences and displays accessible confirmation status (AC 1 & AC 2)', async () => {
    render(
      <LookingForTeamPage
        idToken="valid-token"
        isVerifiedParticipant={true}
        currentParticipantId="user-123"
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/Looking for Team \(LFT\)/i)).toBeInTheDocument();
    });

    const toggle = screen.getByLabelText(/Looking for Team \(LFT\)/i);
    fireEvent.click(toggle);

    const roleSelect = screen.getByLabelText(/Desired Role/i);
    fireEvent.change(roleSelect, { target: { value: 'Frontend' } });

    const hoursInput = screen.getByLabelText(/Weekly Commitment Hours/i);
    fireEvent.change(hoursInput, { target: { value: '25' } });

    const goalSelect = screen.getByLabelText(/Project Goal/i);
    fireEvent.change(goalSelect, { target: { value: 'Learning' } });

    const submitBtn = screen.getByRole('button', { name: /Save Availability Preferences/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(availabilityApi.updateMyAvailability).toHaveBeenCalledWith(
        {
          isLooking: true,
          desiredRole: 'Frontend',
          commitmentHours: 25,
          goal: 'Learning',
        },
        'valid-token'
      );
      expect(screen.getByRole('status')).toHaveTextContent(
        'Platform availability and Looking for Team status saved!'
      );
    });
  });

  it('handles turning off Looking-for-Team status without error (AC 1 & AC 4)', async () => {
    vi.mocked(availabilityApi.fetchMyAvailability).mockResolvedValue({
      participantId: 'user-123',
      isLooking: true,
      desiredRole: 'Frontend',
      commitmentHours: 20,
      goal: 'Learning',
      updatedAt: '2026-10-18T10:00:00.000Z',
    });

    render(
      <LookingForTeamPage
        idToken="valid-token"
        isVerifiedParticipant={true}
        currentParticipantId="user-123"
      />
    );

    await waitFor(() => {
      const toggle = screen.getByLabelText(/Looking for Team \(LFT\)/i) as HTMLInputElement;
      expect(toggle.checked).toBe(true);
    });

    // Uncheck toggle
    const toggle = screen.getByLabelText(/Looking for Team \(LFT\)/i);
    fireEvent.click(toggle);

    const submitBtn = screen.getByRole('button', { name: /Save Availability Preferences/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(availabilityApi.updateMyAvailability).toHaveBeenCalledWith(
        expect.objectContaining({
          isLooking: false,
        }),
        'valid-token'
      );
      expect(screen.getByRole('status')).toHaveTextContent(
        'Looking for Team status turned off. Your preferences have been saved.'
      );
    });
  });
});

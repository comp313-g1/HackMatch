import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LandingPage } from './LandingPage';
import * as openTeamsApi from '../teams/openTeamsApi';
import * as availabilityApi from '../../services/availabilityApi';

vi.mock('../teams/openTeamsApi', async () => {
  const actual = await vi.importActual<typeof import('../teams/openTeamsApi')>(
    '../teams/openTeamsApi'
  );
  return {
    ...actual,
    fetchOpenTeams: vi.fn(),
  };
});

vi.mock('../../services/availabilityApi', () => ({
  fetchAvailableCandidates: vi.fn(),
}));

describe('LandingPage (#361 event-free)', () => {
  const mockNavigateToRegister = vi.fn();
  const mockNavigateToLogin = vi.fn();
  const mockNavigateToOpenTeams = vi.fn();
  const mockNavigateToLooking = vi.fn();
  const mockNavigateToTeams = vi.fn();
  const mockNavigateToProfile = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(openTeamsApi.fetchOpenTeams).mockResolvedValue({
      viewer: 'PART',
      total: 2,
      teams: [
        {
          id: 't1',
          name: 'Neural Nights',
          pitch: 'Building an AI study buddy',
          goal: 'Learning',
          commitmentHours: 12,
          confirmedMembers: 1,
          openSlots: 2,
          isViewerMember: false,
          members: [{ displayName: 'Casey', role: 'Owner' }],
          vacancies: [{ id: 'v1', role: 'Backend', skills: ['Python', 'TensorFlow'] }],
          createdAt: '2026-10-22T00:00:00.000Z',
        },
        {
          id: 't2',
          name: 'Fintech Fox',
          pitch: 'Payments hack',
          goal: 'Competitive',
          commitmentHours: 20,
          confirmedMembers: 2,
          openSlots: 1,
          isViewerMember: false,
          members: [{ displayName: 'Blake', role: 'Owner' }],
          vacancies: [{ id: 'v2', role: 'Frontend', skills: ['React'] }],
          createdAt: '2026-10-22T00:00:00.000Z',
        },
      ],
    });
    vi.mocked(availabilityApi.fetchAvailableCandidates).mockResolvedValue([
      {
        participantId: 'p1',
        displayName: 'Casey',
        handle: 'casey-demo',
        institution: 'Demo U',
        primaryRole: 'AI/ML',
        desiredRole: 'AI/ML',
        commitmentHours: 12,
        goal: 'Learning',
        skills: ['Python'],
        portfolioLinks: [],
        updatedAt: null,
      },
    ]);
  });

  const renderVisitor = () =>
    render(
      <LandingPage
        onNavigateToRegister={mockNavigateToRegister}
        onNavigateToLogin={mockNavigateToLogin}
        onNavigateToOpenTeams={mockNavigateToOpenTeams}
      />
    );

  it('renders event-free hero copy and CTAs (no Browse Events)', async () => {
    renderVisitor();

    expect(screen.getByText(/platform-wide team formation/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /find your team/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /browse events/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/verified hackathons/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^open teams$/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Neural Nights')).toBeInTheDocument();
    });
  });

  it('searches by team name and person name', async () => {
    renderVisitor();
    await waitFor(() => expect(screen.getByText('Neural Nights')).toBeInTheDocument());

    const searchInput = screen.getByPlaceholderText(/search by team name, person, role, or skill/i);
    fireEvent.change(searchInput, { target: { value: 'Casey' } });

    expect(screen.getByText('Neural Nights')).toBeInTheDocument();
    expect(screen.queryByText('Fintech Fox')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'Fintech' } });
    expect(screen.getByText('Fintech Fox')).toBeInTheDocument();
    expect(screen.queryByText('Neural Nights')).not.toBeInTheDocument();
  });

  it('filters by role and goal chips', async () => {
    renderVisitor();
    await waitFor(() => expect(openTeamsApi.fetchOpenTeams).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /^backend$/i }));
    await waitFor(() => {
      expect(openTeamsApi.fetchOpenTeams).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'Backend' }),
        null
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /^learning$/i }));
    await waitFor(() => {
      expect(openTeamsApi.fetchOpenTeams).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'Backend', goal: 'Learning' }),
        null
      );
    });
  });

  it('shows empty state when search matches nothing', async () => {
    renderVisitor();
    await waitFor(() => expect(screen.getByText('Neural Nights')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/search by team name, person, role, or skill/i), {
      target: { value: 'zzzz-no-match' },
    });
    expect(screen.getByText(/no teams match your search/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear all filters/i }));
    expect(screen.getByText('Neural Nights')).toBeInTheDocument();
  });

  it('renders dynamic stats without hardcoded events/countries', async () => {
    renderVisitor();

    const metricsSection = screen.getByRole('region', { name: /platform statistics/i });
    expect(within(metricsSection).queryByText(/verified events/i)).not.toBeInTheDocument();
    expect(within(metricsSection).queryByText(/countries/i)).not.toBeInTheDocument();
    expect(within(metricsSection).getByText(/open teams/i)).toBeInTheDocument();
    expect(within(metricsSection).getByText(/open slots/i)).toBeInTheDocument();
    expect(within(metricsSection).getByText(/looking for teammates/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(within(metricsSection).getByText('2')).toBeInTheDocument();
      expect(within(metricsSection).getByText('3')).toBeInTheDocument();
    });
  });

  it('updates How it works for event-free flow', () => {
    renderVisitor();

    expect(screen.getByRole('heading', { level: 3, name: /find open teams/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /join or build a team/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: /find teammates & lock/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: /find an event/i })).not.toBeInTheDocument();
  });

  it('navigates from bottom CTA for visitors', () => {
    renderVisitor();

    fireEvent.click(screen.getByRole('button', { name: /create free account/i }));
    expect(mockNavigateToRegister).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /sign in to your account/i }));
    expect(mockNavigateToLogin).toHaveBeenCalledTimes(1);
  });

  describe('signed-in participant', () => {
    const mockUser = {
      uid: 'u1',
      email: 'casey@example.com',
      displayName: 'Casey',
    } as unknown as import('firebase/auth').User;

    it('shows My teams / Find teammates / Profile CTAs and looking count', async () => {
      render(
        <LandingPage
          onNavigateToRegister={mockNavigateToRegister}
          onNavigateToLogin={mockNavigateToLogin}
          onNavigateToTeams={mockNavigateToTeams}
          onNavigateToProfile={mockNavigateToProfile}
          onNavigateToOpenTeams={mockNavigateToOpenTeams}
          onNavigateToLooking={mockNavigateToLooking}
          currentUser={mockUser}
        />
      );

      const hero = screen.getByRole('region', { name: /hackmatch hero/i });
      expect(within(hero).getByRole('button', { name: /^my teams$/i })).toBeInTheDocument();
      expect(within(hero).getByRole('button', { name: /^find teammates$/i })).toBeInTheDocument();
      expect(within(hero).getByRole('button', { name: /^profile$/i })).toBeInTheDocument();
      expect(within(hero).queryByRole('button', { name: /^create account$/i })).not.toBeInTheDocument();

      await waitFor(() => {
        expect(availabilityApi.fetchAvailableCandidates).toHaveBeenCalled();
        const metrics = screen.getByRole('region', { name: /platform statistics/i });
        expect(within(metrics).getByText('1')).toBeInTheDocument();
      });

      fireEvent.click(within(hero).getByRole('button', { name: /^my teams$/i }));
      expect(mockNavigateToTeams).toHaveBeenCalled();
    });
  });
});

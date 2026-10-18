import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LandingPage } from './LandingPage';

const { MOCK_EVENTS } = vi.hoisted(() => ({
  MOCK_EVENTS: [
    {
      id: 'a0000000-0000-4000-8000-000000000001',
      name: 'Global AI Hackathon 2026',
      format: 'Online' as const,
      time: 'Upcoming' as const,
      location: 'Virtual / Worldwide',
      country: 'Worldwide',
      dates: 'Nov 14 – 16, 2026',
      openTeams: 2,
      tags: ['AI/ML', 'Python', 'Cloud'],
    },
    {
      id: 'a0000000-0000-4000-8000-000000000002',
      name: 'Toronto FinTech Challenge',
      format: 'In-Person' as const,
      time: 'Upcoming' as const,
      location: 'Toronto, ON',
      country: 'Canada',
      dates: 'Nov 21 – 23, 2026',
      openTeams: 1,
      tags: ['FinTech', 'TypeScript', 'React'],
    },
    {
      id: 'a0000000-0000-4000-8000-000000000003',
      name: 'Healthcare Innovation Sprint',
      format: 'Hybrid' as const,
      time: 'Ongoing' as const,
      location: 'Montreal, QC & Online',
      country: 'Canada',
      dates: 'Oct 17 – 19, 2026',
      openTeams: 0,
      tags: ['HealthTech', 'Security', 'FHIR'],
    },
    {
      id: 'a0000000-0000-4000-8000-000000000004',
      name: 'Nordic CleanTech Hack',
      format: 'Online' as const,
      time: 'Upcoming' as const,
      location: 'Stockholm & Remote',
      country: 'Sweden',
      dates: 'Dec 05 – 07, 2026',
      openTeams: 0,
      tags: ['CleanTech', 'IoT', 'Data'],
    },
    {
      id: 'a0000000-0000-4000-8000-000000000005',
      name: 'Calgary Web3 Summit',
      format: 'In-Person' as const,
      time: 'Concluded' as const,
      location: 'Calgary, AB',
      country: 'Canada',
      dates: 'Sep 12 – 14, 2026',
      openTeams: 0,
      tags: ['Web3', 'Rust', 'Solidity'],
    },
    {
      id: 'a0000000-0000-4000-8000-000000000006',
      name: 'Berlin Civic Tech Days',
      format: 'Hybrid' as const,
      time: 'Concluded' as const,
      location: 'Berlin & Online',
      country: 'Germany',
      dates: 'Aug 20 – 22, 2026',
      openTeams: 0,
      tags: ['CivicTech', 'OpenSource', 'UX'],
    },
  ],
}));

vi.mock('./landingData', () => ({
  VERIFIED_EVENTS: MOCK_EVENTS,
}));

describe('LandingPage component (Wireframe reference: landing-visitor.html)', () => {
  const mockNavigateToRegister = vi.fn();
  const mockNavigateToLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = () =>
    render(
      <LandingPage
        onNavigateToRegister={mockNavigateToRegister}
        onNavigateToLogin={mockNavigateToLogin}
      />
    );

  it('renders hero title, kicker, and subtitle correctly per wireframe', () => {
    renderComponent();

    expect(screen.getByText(/pre-hackathon team formation/i)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: /find your hackathon team/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/browse verified hackathons, join a team or build your own, then lock your roster/i)
    ).toBeInTheDocument();
  });

  it('navigates to registration when clicking Create account in hero', () => {
    renderComponent();

    const heroCreateBtn = screen.getAllByRole('button', { name: /^create account$/i })[0];
    fireEvent.click(heroCreateBtn);

    expect(mockNavigateToRegister).toHaveBeenCalledTimes(1);
  });

  it('renders search input with accessible label and allows typing', () => {
    renderComponent();

    const searchInput = screen.getByPlaceholderText(/search by name, location, or edition/i);
    expect(searchInput).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'FinTech' } });
    expect(searchInput).toHaveValue('FinTech');

    // Only Toronto FinTech Challenge should be visible
    expect(screen.getByText(/toronto fintech challenge/i)).toBeInTheDocument();
    expect(screen.queryByText(/global ai hackathon/i)).not.toBeInTheDocument();
  });

  it('toggles format filter chips and updates aria-pressed', () => {
    renderComponent();

    const onlineChip = screen.getByRole('button', { name: /^online$/i });
    expect(onlineChip).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(onlineChip);
    expect(onlineChip).toHaveAttribute('aria-pressed', 'true');

    // Online events like Global AI Hackathon & Nordic CleanTech should be visible
    expect(screen.getByText(/global ai hackathon/i)).toBeInTheDocument();
    expect(screen.getByText(/nordic cleantech hack/i)).toBeInTheDocument();
    expect(screen.queryByText(/toronto fintech challenge/i)).not.toBeInTheDocument();

    // Clicking again resets format filter
    fireEvent.click(onlineChip);
    expect(onlineChip).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/toronto fintech challenge/i)).toBeInTheDocument();
  });

  it('toggles time filter chips and updates aria-pressed', () => {
    renderComponent();

    const upcomingChip = screen.getByRole('button', { name: /^upcoming$/i });
    expect(upcomingChip).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(upcomingChip);
    expect(upcomingChip).toHaveAttribute('aria-pressed', 'true');

    // Calgary Web3 Summit is concluded, should not be visible
    expect(screen.queryByText(/calgary web3 summit/i)).not.toBeInTheDocument();
  });

  it('shows empty state when no events match query and resets when clicking clear', () => {
    renderComponent();

    const searchInput = screen.getByPlaceholderText(/search by name, location, or edition/i);
    fireEvent.change(searchInput, { target: { value: 'nonexistent-hackathon-123xyz' } });

    expect(screen.getByText(/no events match your criteria/i)).toBeInTheDocument();

    const clearBtn = screen.getByRole('button', { name: /clear all filters/i });
    fireEvent.click(clearBtn);

    expect(screen.queryByText(/no events match your criteria/i)).not.toBeInTheDocument();
    expect(screen.getByText(/global ai hackathon/i)).toBeInTheDocument();
  });

  it('renders all metrics per the wireframe stats', () => {
    renderComponent();

    const metricsSection = screen.getByRole('region', { name: /platform statistics/i });
    expect(within(metricsSection).getByText(/verified events/i)).toBeInTheDocument();
    expect(within(metricsSection).getByText(/open teams/i)).toBeInTheDocument();
    expect(within(metricsSection).getByText(/countries/i)).toBeInTheDocument();
    expect(within(metricsSection).getAllByText('6').length).toBe(2);
    expect(within(metricsSection).getByText('3')).toBeInTheDocument();
  });

  it('renders "How it works" section with 3 numbered steps', () => {
    renderComponent();

    expect(screen.getByRole('heading', { level: 2, name: /how it works/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /find an event/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /join or build a team/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /lock your roster/i })).toBeInTheDocument();
  });

  it('navigates to register or login from bottom CTA banner', () => {
    renderComponent();

    const createBtn = screen.getByRole('button', { name: /create free account/i });
    fireEvent.click(createBtn);
    expect(mockNavigateToRegister).toHaveBeenCalledTimes(1);

    const signInBtn = screen.getByRole('button', { name: /sign in to your account/i });
    fireEvent.click(signInBtn);
    expect(mockNavigateToLogin).toHaveBeenCalledTimes(1);
  });

  it('navigates to register when clicking Join / Build Team on an event card', () => {
    renderComponent();

    const joinBtns = screen.getAllByRole('button', { name: /join \/ build team/i });
    expect(joinBtns.length).toBe(MOCK_EVENTS.length);

    fireEvent.click(joinBtns[0]);
    expect(mockNavigateToRegister).toHaveBeenCalledTimes(1);
  });

  it('renders visitor preview badge when currentUser is null', () => {
    renderComponent();

    expect(screen.getByText(/preview as/i)).toBeInTheDocument();
    expect(screen.getByText(/visitor/i)).toBeInTheDocument();
  });

  describe('Participant Mode (landing-participant.html)', () => {
    const mockNavigateToTeams = vi.fn();
    const mockNavigateToProfile = vi.fn();
    const mockSelectEvent = vi.fn();
    const mockUser = { email: 'maplefox@example.com', displayName: 'maplefox' };

    const renderParticipantComponent = () =>
      render(
        <LandingPage
          onNavigateToRegister={mockNavigateToRegister}
          onNavigateToLogin={mockNavigateToLogin}
          onNavigateToTeams={mockNavigateToTeams}
          onNavigateToProfile={mockNavigateToProfile}
          onSelectEvent={mockSelectEvent}
          currentUser={mockUser}
        />
      );

    it('renders participant preview badge and participant hero CTAs', () => {
      renderParticipantComponent();

      expect(screen.getByText(/preview as/i)).toBeInTheDocument();
      expect(screen.getByText(/participant/i)).toBeInTheDocument();

      // Should show participant actions in hero, not Create account
      expect(screen.getByRole('button', { name: /^teams workspace$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^your profile$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^create account$/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^teams workspace$/i }));
      expect(mockNavigateToTeams).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: /^your profile$/i }));
      expect(mockNavigateToProfile).toHaveBeenCalledTimes(1);
    });

    it('triggers onSelectEvent when clicking View / Build Team on an event card', () => {
      renderParticipantComponent();

      const teamBtns = screen.getAllByRole('button', { name: /view \/ build team/i });
      expect(teamBtns.length).toBe(MOCK_EVENTS.length);

      fireEvent.click(teamBtns[0]);
      expect(mockSelectEvent).toHaveBeenCalledWith(MOCK_EVENTS[0].id);
    });

    it('renders participant bottom CTA banner with team workspace and profile actions', () => {
      renderParticipantComponent();

      expect(
        screen.getByRole('heading', { level: 2, name: /ready to assemble your winning hackathon team\?/i })
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /create free account/i })).not.toBeInTheDocument();

      const teamsCtaBtn = screen.getByRole('button', { name: /go to teams workspace/i });
      fireEvent.click(teamsCtaBtn);
      expect(mockNavigateToTeams).toHaveBeenCalled();

      const profileCtaBtn = screen.getByRole('button', { name: /edit technical profile/i });
      fireEvent.click(profileCtaBtn);
      expect(mockNavigateToProfile).toHaveBeenCalled();
    });
  });
});

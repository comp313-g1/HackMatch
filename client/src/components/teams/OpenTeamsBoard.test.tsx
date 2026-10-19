import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { User } from 'firebase/auth';
import { OpenTeamsBoard } from './OpenTeamsBoard';
import * as openTeamsApi from './openTeamsApi';
import type { OpenTeamsResult } from './openTeamsApi';

vi.mock('./openTeamsApi', async () => {
  const actual = await vi.importActual<typeof import('./openTeamsApi')>('./openTeamsApi');
  return {
    ...actual,
    fetchOpenTeams: vi.fn(),
  };
});

describe('OpenTeamsBoard component (US-013 / Task 4)', () => {
  const mockOnNavigateToSignIn = vi.fn();
  const mockOnApply = vi.fn();

  const mockPartUser = {
    uid: 'part-user-1',
    email: 'part@example.com',
  } as User;

  const sampleVisitorResult: OpenTeamsResult = {
    viewer: 'VISITOR',
    total: 1,
    teams: [
      {
        displayLabel: 'Recruiting team',
        goal: 'Project Completion',
        commitmentHours: 15,
        confirmedMembers: 2,
        openSlots: 1,
        vacancies: [
          {
            role: 'Frontend',
            skills: ['React', 'TypeScript'],
          },
        ],
      },
    ],
  };

  const samplePartResult: OpenTeamsResult = {
    viewer: 'PART',
    total: 2,
    teams: [
      {
        id: 'team-1',
        name: 'Alpha Squad',
        pitch: 'Building a cutting-edge platform for open hackathon matching.',
        goal: 'Competitive',
        commitmentHours: 20,
        confirmedMembers: 2,
        openSlots: 1,
        isViewerMember: false,
        members: [
          { displayName: 'Alice (Captain)', role: 'Owner' },
          { displayName: 'Bob', role: 'Member' },
        ],
        vacancies: [
          {
            id: 'vac-1',
            role: 'Frontend',
            skills: ['React', 'Tailwind'],
          },
        ],
        createdAt: '2026-10-18T10:00:00.000Z',
      },
      {
        id: 'team-2',
        name: 'Beta Squad',
        pitch: 'Exploring decentralized protocols.',
        goal: 'Learning',
        commitmentHours: 10,
        confirmedMembers: 1,
        openSlots: 2,
        isViewerMember: true,
        members: [{ displayName: 'Charlie', role: 'Owner' }],
        vacancies: [
          {
            id: 'vac-2',
            role: 'Backend',
            skills: ['Node.js'],
          },
        ],
        createdAt: '2026-10-18T11:00:00.000Z',
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockOnNavigateToSignIn.mockClear();
    mockOnApply.mockClear();
  });

  it('renders loading state initially with role="status" and aria-busy="true"', () => {
    vi.mocked(openTeamsApi.fetchOpenTeams).mockReturnValue(new Promise(() => {}));

    render(
      <OpenTeamsBoard
        currentUser={null}
        onNavigateToSignIn={mockOnNavigateToSignIn}
        onApply={mockOnApply}
      />
    );

    const loadingEl = screen.getByRole('status', { busy: true });
    expect(loadingEl).toHaveTextContent('Loading open teams...');
  });

  it('renders visitor view with prompt banner, anonymized cards, and handles sign-in actions', async () => {
    vi.mocked(openTeamsApi.fetchOpenTeams).mockResolvedValueOnce(sampleVisitorResult);

    render(
      <OpenTeamsBoard
        currentUser={null}
        onNavigateToSignIn={mockOnNavigateToSignIn}
        onApply={mockOnApply}
      />
    );

    await waitFor(() => {
      expect(screen.queryByRole('status', { busy: true })).not.toBeInTheDocument();
    });

    // Sign-in prompt banner
    expect(screen.getByText('Viewing anonymized team previews.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Sign in as a verified participant to see team pitches, members, and apply.'
      )
    ).toBeInTheDocument();

    const bannerSignInBtn = screen.getByRole('button', { name: /^sign in$/i });
    fireEvent.click(bannerSignInBtn);
    expect(mockOnNavigateToSignIn).toHaveBeenCalledTimes(1);

    // Card content
    const cardEl = screen.getByRole('article', { name: 'Recruiting team preview' });
    expect(cardEl).toBeInTheDocument();
    expect(cardEl).toHaveTextContent('Recruiting team');
    expect(cardEl).toHaveTextContent('Project Completion');
    expect(cardEl).toHaveTextContent('⏱ 15 hrs/wk');
    expect(cardEl).toHaveTextContent('2 member(s) · 1 open slot(s)');

    // Privacy verification: no team name or pitch in DOM
    expect(screen.queryByText('Alpha Squad')).not.toBeInTheDocument();
    expect(screen.queryByText(/cutting-edge platform/i)).not.toBeInTheDocument();

    // Sign in to apply button on card vacancy
    const vacancySignInBtn = screen.getByRole('button', { name: /sign in to apply/i });
    fireEvent.click(vacancySignInBtn);
    expect(mockOnNavigateToSignIn).toHaveBeenCalledTimes(2);
  });

  it('renders PART view with team details, member lists, and handles onApply', async () => {
    vi.mocked(openTeamsApi.fetchOpenTeams).mockResolvedValueOnce(samplePartResult);

    render(
      <OpenTeamsBoard
        currentUser={mockPartUser}
        onNavigateToSignIn={mockOnNavigateToSignIn}
        onApply={mockOnApply}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Alpha Squad')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Building a cutting-edge platform for open hackathon matching.')
    ).toBeInTheDocument();
    expect(screen.getByText(/Alice \(Captain\) \(Owner\)/)).toBeInTheDocument();

    // Apply button for Alpha Squad
    const applyBtn = screen.getByRole('button', {
      name: 'Apply for Frontend slot on Alpha Squad',
    });
    fireEvent.click(applyBtn);

    expect(mockOnApply).toHaveBeenCalledWith({
      teamId: 'team-1',
      vacancyId: 'vac-1',
      role: 'Frontend',
      teamName: 'Alpha Squad',
    });
  });

  it('displays "Your team" badge and suppresses Apply button when isViewerMember is true', async () => {
    vi.mocked(openTeamsApi.fetchOpenTeams).mockResolvedValueOnce(samplePartResult);

    render(
      <OpenTeamsBoard
        currentUser={mockPartUser}
        onNavigateToSignIn={mockOnNavigateToSignIn}
        onApply={mockOnApply}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Beta Squad')).toBeInTheDocument();
    });

    expect(screen.getByText('Your team')).toBeInTheDocument();

    // Ensure no apply button exists for Beta Squad
    expect(
      screen.queryByRole('button', { name: /apply for backend slot on beta squad/i })
    ).not.toBeInTheDocument();
  });

  it('validates filter draft client-side and surfaces errors without dispatching fetch (preserves input)', async () => {
    vi.mocked(openTeamsApi.fetchOpenTeams).mockResolvedValueOnce(sampleVisitorResult);

    render(
      <OpenTeamsBoard
        currentUser={null}
        onNavigateToSignIn={mockOnNavigateToSignIn}
        onApply={mockOnApply}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Recruiting team')).toBeInTheDocument();
    });

    expect(openTeamsApi.fetchOpenTeams).toHaveBeenCalledTimes(1);

    // Type invalid minSlots: 99
    const minSlotsInput = screen.getByLabelText(/minimum open slots/i);
    fireEvent.change(minSlotsInput, { target: { value: '99' } });

    // Click Apply filters
    const submitBtn = screen.getByRole('button', { name: /apply filters/i });
    fireEvent.click(submitBtn);

    // Error alert is rendered
    expect(
      screen.getByText('Minimum open slots must be an integer between 1 and 20.')
    ).toBeInTheDocument();
    // Input value is preserved
    expect(minSlotsInput).toHaveValue(99);
    // fetchOpenTeams was NOT called a second time
    expect(openTeamsApi.fetchOpenTeams).toHaveBeenCalledTimes(1);
  });

  it('submits valid filter changes and triggers fetch with updated parameters', async () => {
    vi.mocked(openTeamsApi.fetchOpenTeams).mockResolvedValue(sampleVisitorResult);

    render(
      <OpenTeamsBoard
        currentUser={null}
        onNavigateToSignIn={mockOnNavigateToSignIn}
        onApply={mockOnApply}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Recruiting team')).toBeInTheDocument();
    });

    const skillsInput = screen.getByLabelText(/skills/i);
    fireEvent.change(skillsInput, { target: { value: 'React, Vite' } });

    const roleSelect = screen.getByLabelText(/role/i);
    fireEvent.change(roleSelect, { target: { value: 'Frontend' } });

    const submitBtn = screen.getByRole('button', { name: /apply filters/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(openTeamsApi.fetchOpenTeams).toHaveBeenCalledWith(
        expect.objectContaining({
          skills: 'React, Vite',
          role: 'Frontend',
        }),
        null,
        expect.any(AbortSignal)
      );
    });
  });

  it('renders empty state with "Reset Filters" when active filters return no teams, and clicking it resets', async () => {
    vi.mocked(openTeamsApi.fetchOpenTeams).mockResolvedValueOnce(sampleVisitorResult);

    render(
      <OpenTeamsBoard
        currentUser={null}
        onNavigateToSignIn={mockOnNavigateToSignIn}
        onApply={mockOnApply}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Recruiting team')).toBeInTheDocument();
    });

    // Mock next response as empty
    vi.mocked(openTeamsApi.fetchOpenTeams).mockResolvedValueOnce({
      viewer: 'VISITOR',
      total: 0,
      teams: [],
    });

    const roleSelect = screen.getByLabelText(/role/i);
    fireEvent.change(roleSelect, { target: { value: 'AI/ML' } });

    const submitBtn = screen.getByRole('button', { name: /apply filters/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('No teams match your filters.')).toBeInTheDocument();
    });

    const resetBtn = screen.getByRole('button', { name: 'Reset Filters' });
    expect(resetBtn).toBeInTheDocument();

    // Reset filters
    vi.mocked(openTeamsApi.fetchOpenTeams).mockResolvedValueOnce(sampleVisitorResult);
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(screen.getByText('Recruiting team')).toBeInTheDocument();
    });

    expect(roleSelect).toHaveValue('');
  });

  it('renders empty state without reset button when no filters are active and no teams exist', async () => {
    vi.mocked(openTeamsApi.fetchOpenTeams).mockResolvedValueOnce({
      viewer: 'VISITOR',
      total: 0,
      teams: [],
    });

    render(
      <OpenTeamsBoard
        currentUser={null}
        onNavigateToSignIn={mockOnNavigateToSignIn}
        onApply={mockOnApply}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('No teams are recruiting right now.')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Reset Filters' })).not.toBeInTheDocument();
  });

  it('renders error alert with "Try again" button when API rejects, and retries on click', async () => {
    vi.mocked(openTeamsApi.fetchOpenTeams).mockRejectedValueOnce(
      new Error('Failed to connect to team discovery service.')
    );

    render(
      <OpenTeamsBoard
        currentUser={null}
        onNavigateToSignIn={mockOnNavigateToSignIn}
        onApply={mockOnApply}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText('Failed to connect to team discovery service.')
      ).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /try again/i });
    expect(retryBtn).toBeInTheDocument();

    vi.mocked(openTeamsApi.fetchOpenTeams).mockResolvedValueOnce(sampleVisitorResult);
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('Recruiting team')).toBeInTheDocument();
    });
  });

  it('ignores stale response when a newer request resolves earlier', async () => {
    let resolveFirst!: (value: OpenTeamsResult) => void;
    let resolveSecond!: (value: OpenTeamsResult) => void;

    const firstPromise = new Promise<OpenTeamsResult>((res) => {
      resolveFirst = res;
    });
    const secondPromise = new Promise<OpenTeamsResult>((res) => {
      resolveSecond = res;
    });

    vi.mocked(openTeamsApi.fetchOpenTeams)
      .mockReturnValueOnce(firstPromise)
      .mockReturnValueOnce(secondPromise);

    const { rerender } = render(
      <OpenTeamsBoard
        currentUser={null}
        onNavigateToSignIn={mockOnNavigateToSignIn}
        onApply={mockOnApply}
      />
    );

    // Trigger second request by changing currentUser (e.g. participant signed in)
    rerender(
      <OpenTeamsBoard
        currentUser={mockPartUser}
        onNavigateToSignIn={mockOnNavigateToSignIn}
        onApply={mockOnApply}
      />
    );

    // Resolve second request first
    resolveSecond({
      viewer: 'PART',
      total: 1,
      teams: [
        {
          id: 'team-fast',
          name: 'Fast Squad',
          pitch: 'Fastest team in town',
          goal: 'Competitive',
          commitmentHours: 20,
          confirmedMembers: 1,
          openSlots: 2,
          isViewerMember: false,
          members: [{ displayName: 'Charlie', role: 'Owner' }],
          vacancies: [{ id: 'v-fast', role: 'Frontend', skills: ['Vue'] }],
          createdAt: '2026-10-18T12:00:00.000Z',
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Fast Squad')).toBeInTheDocument();
      expect(screen.getByText('Vue')).toBeInTheDocument();
    });

    // Now resolve first (stale) request with visitor data
    resolveFirst({
      viewer: 'VISITOR',
      total: 1,
      teams: [
        {
          displayLabel: 'Recruiting team',
          goal: 'Learning',
          commitmentHours: 5,
          confirmedMembers: 3,
          openSlots: 1,
          vacancies: [{ role: 'Pitch', skills: ['Public Speaking'] }],
        },
      ],
    });

    // Wait to confirm stale data was discarded and current data remains
    expect(screen.getByText('Fast Squad')).toBeInTheDocument();
    expect(screen.queryByText('Public Speaking')).not.toBeInTheDocument();
  });

  it('renders live region with result count and refinement message when total exceeds displayed', async () => {
    vi.mocked(openTeamsApi.fetchOpenTeams).mockResolvedValueOnce({
      viewer: 'PART',
      total: 55,
      teams: Array.from({ length: 50 }, (_, i) => ({
        id: `t-${i}`,
        name: `Team ${i}`,
        pitch: `Pitch ${i}`,
        goal: 'Project Completion',
        commitmentHours: 10,
        confirmedMembers: 1,
        openSlots: 1,
        isViewerMember: false,
        members: [{ displayName: 'Member', role: 'Owner' }],
        vacancies: [{ id: `v-${i}`, role: 'Frontend', skills: ['React'] }],
        createdAt: '2026-10-18T10:00:00.000Z',
      })),
    });

    render(
      <OpenTeamsBoard
        currentUser={mockPartUser}
        onNavigateToSignIn={mockOnNavigateToSignIn}
        onApply={mockOnApply}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Team 0')).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        'Showing 50 of 55 team(s) (Refine filters to see more)'
      )
    ).toBeInTheDocument();
  });
});

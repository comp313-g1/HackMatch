import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RecommendedTeamsPage } from './RecommendedTeamsPage';
import * as recommendedTeamsApi from './recommendedTeamsApi';
import type { RecommendedTeamsResponse } from './recommendedTeamsApi';

vi.mock('./recommendedTeamsApi', async () => {
  const actual = await vi.importActual<typeof import('./recommendedTeamsApi')>(
    './recommendedTeamsApi'
  );
  return {
    ...actual,
    fetchRecommendedTeams: vi.fn(),
  };
});

const fetchMock = vi.mocked(recommendedTeamsApi.fetchRecommendedTeams);

function response(overrides: Partial<RecommendedTeamsResponse> = {}): RecommendedTeamsResponse {
  return {
    status: 'ok',
    teams: [
      {
        teamId: 'team-1',
        teamName: 'Innovators',
        vacancyId: 'vacancy-1',
        role: 'Frontend',
        teamGoal: 'Project Completion',
        commitmentHours: 20,
        matchedSkills: ['react', 'typescript'],
        roleMatched: true,
        rank: 1,
        displayScore: '91.7',
        score: 91.7,
        components: { skill: 1, goal: 1, hours: 0.75 },
      },
    ],
    empty: false,
    message: null,
    notice: 'Scores use self-declared skills, role, goal, and hours.',
    ...overrides,
  };
}

describe('RecommendedTeamsPage (US-016)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the loading state before the request resolves', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<RecommendedTeamsPage onApply={vi.fn()} />);

    expect(screen.getByTestId('recommended-teams-loading')).toBeInTheDocument();
  });

  it('renders the match percentage, matched skills and role match on success', async () => {
    fetchMock.mockResolvedValue(response());

    render(<RecommendedTeamsPage onApply={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('recommended-teams-results')).toBeInTheDocument());
    expect(screen.getByText('Innovators')).toBeInTheDocument();
    expect(screen.getByTestId('recommended-team-score')).toHaveTextContent('91.7');
    expect(screen.getByTestId('recommended-team-skills')).toHaveTextContent('react');
    expect(screen.getByTestId('recommended-team-skills')).toHaveTextContent('typescript');
    expect(screen.getByTestId('recommended-team-role-match')).toBeInTheDocument();
  });

  it('renders the empty state with the server message', async () => {
    fetchMock.mockResolvedValue(
      response({
        teams: [],
        empty: true,
        message: 'No open teams match your profile yet.',
      })
    );

    render(<RecommendedTeamsPage onApply={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('recommended-teams-empty')).toBeInTheDocument());
    expect(screen.getByText('No open teams match your profile yet.')).toBeInTheDocument();
  });

  it('renders the error state and keeps previously loaded teams (NR-017)', async () => {
    fetchMock.mockResolvedValueOnce(response());
    fetchMock.mockRejectedValueOnce(
      new recommendedTeamsApi.RecommendedTeamsApiError(0, 'NETWORK', undefined, undefined, 'Network down.')
    );

    render(<RecommendedTeamsPage onApply={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Innovators')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('recommended-teams-refresh'));

    await waitFor(() => expect(screen.getByTestId('recommended-teams-error')).toBeInTheDocument());
    expect(screen.getByText('Network down.')).toBeInTheDocument();
    // Previously loaded recommendations survive the failed refresh.
    expect(screen.getByText('Innovators')).toBeInTheDocument();
    expect(screen.getByText('Your previously loaded teams are still shown below.')).toBeInTheDocument();
  });

  it('renders the degraded state without scores (NR-016)', async () => {
    fetchMock.mockResolvedValue(
      response({
        status: 'degraded',
        degradedNotice: 'Scores are temporarily unavailable. Showing open teams without ranking.',
        teams: [
          {
            teamId: 'team-1',
            teamName: 'Innovators',
            vacancyId: 'vacancy-1',
            role: 'Frontend',
            teamGoal: 'Project Completion',
            commitmentHours: 20,
          },
        ],
      })
    );

    render(<RecommendedTeamsPage onApply={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByTestId('recommended-teams-degraded')).toBeInTheDocument()
    );
    expect(screen.getByText('Innovators')).toBeInTheDocument();
    expect(screen.queryByTestId('recommended-team-score')).not.toBeInTheDocument();
  });

  it('maps Apply onto the existing application panel target', async () => {
    const onApply = vi.fn();
    fetchMock.mockResolvedValue(response());

    render(<RecommendedTeamsPage onApply={onApply} />);

    const applyButton = await screen.findByTestId('recommended-team-apply');
    fireEvent.click(applyButton);

    expect(onApply).toHaveBeenCalledWith({
      teamId: 'team-1',
      vacancyId: 'vacancy-1',
      role: 'Frontend',
      teamName: 'Innovators',
    });
  });

  it('asks a signed-out visitor to sign in', async () => {
    const onNavigateToSignIn = vi.fn();
    fetchMock.mockRejectedValue(new recommendedTeamsApi.AuthRequiredError());

    render(
      <RecommendedTeamsPage onApply={vi.fn()} onNavigateToSignIn={onNavigateToSignIn} />
    );

    await waitFor(() => expect(screen.getByTestId('recommended-teams-error')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(onNavigateToSignIn).toHaveBeenCalledTimes(1);
  });
});

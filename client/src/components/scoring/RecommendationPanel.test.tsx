import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RecommendationPanel } from './RecommendationPanel';
import * as recommendationsApi from './recommendationsApi';
import type { RecommendationsResponse } from './recommendationsApi';

vi.mock('./recommendationsApi', async () => {
  const actual = await vi.importActual<typeof import('./recommendationsApi')>(
    './recommendationsApi'
  );
  return {
    ...actual,
    fetchVacancyRecommendations: vi.fn(),
  };
});

const fetchMock = vi.mocked(recommendationsApi.fetchVacancyRecommendations);

const baseExclusions = {
  inactive: 0,
  unavailable: 0,
  confirmed: 0,
  owner: 0,
  totalExcluded: 0,
};

function rankedResponse(
  overrides: Partial<RecommendationsResponse> = {}
): RecommendationsResponse {
  return {
    status: 'ok',
    teamId: 't1',
    vacancyId: 'v1',
    slot: {
      vacancyId: 'v1',
      role: 'Frontend',
      requiredSkills: ['React'],
      requestedHours: 20,
      goal: 'Project Completion',
    },
    candidates: [
      {
        participantId: 'p1',
        displayName: 'Amy',
        handle: 'amy',
        primaryRole: 'Frontend',
        desiredRole: 'Frontend',
        skills: ['React'],
        commitmentHours: 10,
        goal: 'Project Completion',
        rank: 1,
        displayScore: '70.0',
        score: 70,
        contributions: {
          skill: 'Matched 2 of 4 required skills with primary-role match (×1.2, capped at 1.0).',
          goal: 'Identical goals.',
          hours: 'Commitment 10h vs requested 20h.',
        },
        explanation: {
          displayScore: '70.0',
          score: 70,
          notice: 'Scores use self-declared skills.',
          roleMatched: true,
          matchedSkills: ['react'],
          hadMissingInput: false,
          items: [
            {
              component: 'skill',
              label: 'Skills',
              value: 0.6,
              detail: 'Matched 2 of 4 required skills with primary-role match (×1.2, capped at 1.0).',
            },
            { component: 'goal', label: 'Goal', value: 1, detail: 'Identical goals.' },
            {
              component: 'hours',
              label: 'Hours',
              value: 0.5,
              detail: 'Commitment 10h vs requested 20h.',
            },
          ],
          contributions: {
            skill: 'Matched 2 of 4 required skills with primary-role match (×1.2, capped at 1.0).',
            goal: 'Identical goals.',
            hours: 'Commitment 10h vs requested 20h.',
          },
        },
      },
    ],
    empty: false,
    message: null,
    notice: 'Scores use self-declared skills.',
    exclusions: baseExclusions,
    ...overrides,
  };
}

describe('RecommendationPanel (US-015 list / empty / fallback)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('loads ranked list and shows score contributions on success', async () => {
    fetchMock.mockResolvedValue(rankedResponse());

    render(
      <RecommendationPanel teamId="t1" vacancyId="v1" vacancyLabel="Frontend slot" />
    );

    fireEvent.click(screen.getByTestId('load-recommendations'));

    await waitFor(() => {
      expect(screen.getByTestId('recommendation-results')).toBeInTheDocument();
    });
    expect(screen.getByText('#1 amy — 70.0')).toBeInTheDocument();
    expect(screen.getByTestId('score-contributions-panel')).toHaveTextContent(/Matched 2 of 4/);
  });

  it('shows empty state message when no eligible candidates', async () => {
    fetchMock.mockResolvedValue(
      rankedResponse({
        candidates: [],
        empty: true,
        message: 'No eligible candidates found for this open slot.',
        exclusions: { ...baseExclusions, confirmed: 2, totalExcluded: 2 },
      })
    );

    render(
      <RecommendationPanel teamId="t1" vacancyId="v1" vacancyLabel="Frontend slot" />
    );
    fireEvent.click(screen.getByTestId('load-recommendations'));

    await waitFor(() => {
      expect(screen.getByTestId('recommendation-empty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('recommendation-empty')).toHaveTextContent(/No eligible candidates/);
    expect(screen.getByText(/already confirmed for this event/i)).toBeInTheDocument();
  });

  it('shows degraded fallback list without scores (NR-016)', async () => {
    fetchMock.mockResolvedValue(
      rankedResponse({
        status: 'degraded',
        degradedNotice: 'Scores are temporarily unavailable. Showing eligible candidates without ranking.',
        candidates: [
          {
            participantId: 'p1',
            displayName: 'Amy',
            handle: 'amy',
            primaryRole: 'Frontend',
            desiredRole: 'Frontend',
            skills: [],
            commitmentHours: 10,
            goal: 'Learning',
          },
        ],
      })
    );

    render(
      <RecommendationPanel teamId="t1" vacancyId="v1" vacancyLabel="Frontend slot" />
    );
    fireEvent.click(screen.getByTestId('load-recommendations'));

    await waitFor(() => {
      expect(screen.getByTestId('recommendation-degraded')).toBeInTheDocument();
    });
    expect(screen.getByText(/without ranking/i)).toBeInTheDocument();
    expect(screen.getByText('amy')).toBeInTheDocument();
    expect(screen.queryByTestId('score-contributions-panel')).not.toBeInTheDocument();
  });

  it('shows error with retry and keeps vacancy context message', async () => {
    fetchMock.mockRejectedValue(
      new recommendationsApi.RecommendationsApiError(
        403,
        'FORBIDDEN_NOT_TEAM_OWNER',
        undefined,
        undefined,
        'You are not the owner of this team.'
      )
    );

    render(
      <RecommendationPanel teamId="t1" vacancyId="v1" vacancyLabel="Frontend slot" />
    );
    fireEvent.click(screen.getByTestId('load-recommendations'));

    await waitFor(() => {
      expect(screen.getByTestId('recommendation-error')).toBeInTheDocument();
    });
    expect(screen.getByText(/not the owner/i)).toBeInTheDocument();
    expect(screen.getByText(/were kept/i)).toBeInTheDocument();
  });
});

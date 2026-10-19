import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RecommendationPanel } from './RecommendationPanel';
import * as recommendationsApi from './recommendationsApi';
import * as invitationsApi from './invitationsApi';
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

vi.mock('./invitationsApi', async () => {
  const actual = await vi.importActual<typeof import('./invitationsApi')>('./invitationsApi');
  return {
    ...actual,
    issueTeamInvitation: vi.fn(),
  };
});

const fetchMock = vi.mocked(recommendationsApi.fetchVacancyRecommendations);
const inviteMock = vi.mocked(invitationsApi.issueTeamInvitation);

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
    inviteMock.mockReset();
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

  it('opens US-017 invite draft from eligible candidate and succeeds (FR-048)', async () => {
    fetchMock.mockResolvedValue(rankedResponse());
    inviteMock.mockResolvedValue({
      id: 'inv-1',
      teamId: 't1',
      eventId: 'e1',
      vacancyId: 'v1',
      inviteeParticipantId: 'p1',
      status: 'Pending',
      requestType: 'Invitation',
      expiresAt: '2026-10-21T12:00:00.000Z',
      createdAt: '2026-10-19T12:00:00.000Z',
      teamName: 'Team',
      vacancyRole: 'Frontend',
      source: 'recommendation',
      notice: 'Pending invitation created.',
    });

    render(
      <RecommendationPanel teamId="t1" vacancyId="v1" vacancyLabel="Frontend slot" />
    );
    fireEvent.click(screen.getByTestId('load-recommendations'));

    await waitFor(() => {
      expect(screen.getByTestId('invite-candidate-p1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('invite-candidate-p1'));

    expect(screen.getByTestId('invite-from-recommendation')).toBeInTheDocument();
    expect(screen.getByTestId('invite-draft-candidate')).toHaveTextContent('amy');
    expect(screen.getByTestId('invite-draft-slot')).toHaveTextContent('Frontend slot');

    fireEvent.click(screen.getByTestId('confirm-invitation'));

    await waitFor(() => {
      expect(screen.getByTestId('invite-success')).toBeInTheDocument();
    });
    expect(inviteMock).toHaveBeenCalledWith('t1', {
      vacancyId: 'v1',
      inviteeParticipantId: 'p1',
      source: 'recommendation',
    });
    expect(screen.getByTestId('recommendation-results')).toBeInTheDocument();
    expect(screen.getByTestId('invite-candidate-p1')).toHaveTextContent('Invited');
  });

  it('keeps recommendation list and invite draft on invitation failure', async () => {
    fetchMock.mockResolvedValue(rankedResponse());
    inviteMock.mockRejectedValue(
      new invitationsApi.InvitationsApiError(
        409,
        'DUPLICATE_PENDING_INVITATION',
        undefined,
        undefined,
        'A pending invitation already exists for this candidate on this team.'
      )
    );

    render(
      <RecommendationPanel teamId="t1" vacancyId="v1" vacancyLabel="Frontend slot" />
    );
    fireEvent.click(screen.getByTestId('load-recommendations'));
    await waitFor(() => {
      expect(screen.getByTestId('invite-candidate-p1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('invite-candidate-p1'));
    fireEvent.click(screen.getByTestId('confirm-invitation'));

    await waitFor(() => {
      expect(screen.getByTestId('invite-error')).toBeInTheDocument();
    });
    expect(screen.getByText(/pending invitation already exists/i)).toBeInTheDocument();
    expect(screen.getByText(/draft were kept/i)).toBeInTheDocument();
    expect(screen.getByTestId('recommendation-results')).toBeInTheDocument();
    expect(screen.getByTestId('invite-from-recommendation')).toBeInTheDocument();
  });
});

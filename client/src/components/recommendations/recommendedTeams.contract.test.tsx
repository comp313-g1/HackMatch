/**
 * US-016 / #159 — the client against the REAL server answer.
 *
 * The server integration test (server/src/routes/teamRecommendations.integration.test.ts) proves the
 * endpoint returns exactly the JSON in these fixtures. Here the client reads the same files, so if
 * either side changes the format without the other, one of the two test suites fails.
 */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import listFixture from '../../../../server/src/test-fixtures/recommendedTeamsResponse.json';
import emptyFixture from '../../../../server/src/test-fixtures/recommendedTeamsEmptyNotLooking.json';
import { RecommendedTeamsPage } from './RecommendedTeamsPage';
import { fetchRecommendedTeams, parseRecommendedTeamsResponse } from './recommendedTeamsApi';

vi.mock('../../config/authFetch', async () => {
  const actual = await vi.importActual<typeof import('../../config/authFetch')>('../../config/authFetch');
  return { ...actual, authFetch: vi.fn() };
});

import { authFetch } from '../../config/authFetch';

const asResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const handlers = () => ({
  onNavigateToSignIn: vi.fn(),
  onGoToLookingForTeam: vi.fn(),
  onGoToProfile: vi.fn(),
  onBrowseOpenTeams: vi.fn(),
});

describe('client reads the real server answer (US-016 / #159)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('contract', () => {
    it('accepts the server\'s list answer exactly as the server sends it', () => {
      const parsed = parseRecommendedTeamsResponse(listFixture);
      expect(parsed.empty).toBe(false);
      expect(parsed.eligibilityReason).toBeNull();
      expect(parsed.recommendations.map((r) => [r.rank, r.teamName, r.matchPercent])).toEqual([
        [1, 'Alpha Backend', 100],
        [2, 'Gamma Stretch', 47],
        [3, 'Beta Frontend', 37],
      ]);
      expect(parsed.recommendations[1]).toMatchObject({ matchedSkills: ['Node.js'], missingSkills: ['Go', 'Rust'], roleMatched: true });
      expect(parsed.notice).toMatch(/not predictions/);
    });

    it('accepts the server\'s empty answer for a participant who is not Looking for Team', () => {
      expect(parseRecommendedTeamsResponse(emptyFixture)).toMatchObject({
        empty: true,
        recommendations: [],
        eligibilityReason: 'participant_not_looking',
      });
    });

    it('carries nothing private: the fixtures hold no account or ownership data', () => {
      const text = JSON.stringify([listFixture, emptyFixture]);
      expect(text).not.toMatch(/@|email|firebase|owner|participantId|eventId|"score"/i);
    });

    it('rejects the answer if the server ever dropped a field the page needs', () => {
      for (const field of ['rank', 'matchPercent', 'matchedSkills', 'missingSkills', 'roleMatched', 'contributions', 'teamName', 'vacancyRole']) {
        const broken = structuredClone(listFixture) as { recommendations: Array<Record<string, unknown>> };
        delete broken.recommendations[0]![field];
        expect(() => parseRecommendedTeamsResponse(broken), field).toThrowError(/invalid recommendations response/);
      }
    });

    it('rejects the answer if the server ever dropped the empty flag', () => {
      const broken = structuredClone(listFixture) as Record<string, unknown>;
      delete broken.empty;
      expect(() => parseRecommendedTeamsResponse(broken)).toThrowError(/invalid recommendations response/);
    });
  });

  describe('full flow: server answer -> request -> page', () => {
    it('shows the three suggested teams best first with their percentages and skills', async () => {
      vi.mocked(authFetch).mockResolvedValue(asResponse(listFixture));
      render(<RecommendedTeamsPage {...handlers()} />);
      await act(async () => {});

      expect(authFetch).toHaveBeenCalledWith('/api/recommendations/teams', { method: 'GET' });
      const cards = screen.getAllByTestId('recommended-team');
      expect(cards.map((c) => within(c).getByRole('heading', { level: 3 }).textContent)).toEqual([
        'Alpha Backend', 'Gamma Stretch', 'Beta Frontend',
      ]);
      expect(cards.map((c) => /^(\d+)%/.exec(within(c).getByTestId('match-percent').textContent ?? '')?.[0])).toEqual(['100%', '47%', '37%']);
      expect(within(cards[1]!).getByTestId('matched-skills')).toHaveTextContent('Node.js');
      expect(within(cards[1]!).getByTestId('missing-skills')).toHaveTextContent('Go');
      expect(within(cards[1]!).getByTestId('missing-skills')).toHaveTextContent('Rust');
      expect(screen.getByTestId('recommended-teams-count')).toHaveTextContent('3 suggested teams');
    });

    it('shows the server\'s own explanations under "Why this match?"', async () => {
      vi.mocked(authFetch).mockResolvedValue(asResponse(listFixture));
      render(<RecommendedTeamsPage {...handlers()} />);
      await act(async () => {});
      const alpha = screen.getAllByTestId('recommended-team')[0]!;
      fireEvent.click(within(alpha).getByTestId('toggle-why'));
      expect(within(alpha).getByTestId('match-details')).toHaveTextContent('Matched 2 of 2 required skills');
      expect(within(alpha).getByTestId('match-details')).toHaveTextContent('Identical goals.');
    });

    it('shows the server\'s notice about self-declared scores', async () => {
      vi.mocked(authFetch).mockResolvedValue(asResponse(listFixture));
      render(<RecommendedTeamsPage {...handlers()} />);
      await act(async () => {});
      expect(screen.getByTestId('recommended-teams-notice')).toHaveTextContent(/not predictions/);
    });

    it('shows the turn-on-Looking-for-Team empty state from the server\'s empty answer', async () => {
      vi.mocked(authFetch).mockResolvedValue(asResponse(emptyFixture));
      const h = handlers();
      render(<RecommendedTeamsPage {...h} />);
      await act(async () => {});
      expect(screen.getByTestId('recommended-teams-empty')).toHaveAttribute('data-reason', 'participant_not_looking');
      fireEvent.click(screen.getByTestId('go-to-looking'));
      expect(h.onGoToLookingForTeam).toHaveBeenCalledTimes(1);
    });

    it.each([
      [401, { error: 'Authentication required.', code: 'UNAUTHORIZED' }, 'recommended-teams-signed-out'],
      [403, { error: 'You can only view recommendations for your own profile.', code: 'FORBIDDEN_NOT_OWN_PROFILE' }, 'recommended-teams-error'],
      [403, { error: 'Role not allowed.', code: 'FORBIDDEN_ROLE' }, 'recommended-teams-error'],
      [400, { error: 'Invalid request.', code: 'VALIDATION_ERROR', errors: { participantId: 'x' } }, 'recommended-teams-error'],
      [500, { error: 'Internal Server Error' }, 'recommended-teams-error'],
    ])('handles the server\'s %s answer without showing a list', async (status, body, testId) => {
      vi.mocked(authFetch).mockResolvedValue(asResponse(body, status));
      render(<RecommendedTeamsPage {...handlers()} />);
      await act(async () => {});
      expect(screen.getByTestId(testId)).toBeInTheDocument();
      expect(screen.queryByTestId('recommended-team')).not.toBeInTheDocument();
    });

    it('shows an error, not a list, when the server answers 200 with something unexpected', async () => {
      vi.mocked(authFetch).mockResolvedValue(asResponse({ status: 'ok', recommendations: [{ teamName: 'Half an answer' }], empty: false }));
      render(<RecommendedTeamsPage {...handlers()} />);
      await act(async () => {});
      expect(screen.getByTestId('recommended-teams-error')).toHaveTextContent(/invalid recommendations response/);
      expect(screen.queryByText('Half an answer')).not.toBeInTheDocument();
    });

    it('turns a network failure into a retryable error and recovers when the next request works', async () => {
      vi.mocked(authFetch).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(asResponse(listFixture));
      render(<RecommendedTeamsPage {...handlers()} />);
      await act(async () => {});
      expect(screen.getByTestId('recommended-teams-error')).toHaveTextContent(/network error/i);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      });
      expect(screen.getAllByTestId('recommended-team')).toHaveLength(3);
    });

    it('requests with the real fetch function exactly once per page load', async () => {
      vi.mocked(authFetch).mockResolvedValue(asResponse(listFixture));
      await fetchRecommendedTeams();
      expect(authFetch).toHaveBeenCalledTimes(1);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchVacancyRecommendations, RecommendationsApiError } from './recommendationsApi';

const authFetchMock = vi.fn();

vi.mock('../../config/authFetch', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  AuthRequiredError: class AuthRequiredError extends Error {
    constructor() {
      super('AUTH_REQUIRED');
      this.name = 'AuthRequiredError';
    }
  },
}));

describe('fetchVacancyRecommendations', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  it('returns ranked payload on 200', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          teamId: 't1',
          vacancyId: 'v1',
          slot: {
            vacancyId: 'v1',
            role: 'Frontend',
            requiredSkills: ['React'],
            requestedHours: 20,
            goal: 'Learning',
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
              goal: 'Learning',
              rank: 1,
              displayScore: '83.3',
              score: 83.333,
              contributions: { skill: 's', goal: 'g', hours: 'h' },
            },
          ],
          empty: false,
          message: null,
          notice: 'self-declared',
          exclusions: {
            inactive: 0,
            unavailable: 0,
            confirmed: 0,
            owner: 0,
            totalExcluded: 0,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await fetchVacancyRecommendations('t1', 'v1');
    expect(result.candidates[0].displayScore).toBe('83.3');
    expect(authFetchMock).toHaveBeenCalledWith(
      '/api/teams/t1/vacancies/v1/recommendations',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('throws RecommendationsApiError on 403 and preserves message', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'You are not the owner of this team.',
          code: 'FORBIDDEN_NOT_TEAM_OWNER',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(fetchVacancyRecommendations('t1', 'v1')).rejects.toMatchObject({
      name: 'RecommendationsApiError',
      status: 403,
      code: 'FORBIDDEN_NOT_TEAM_OWNER',
    } satisfies Partial<RecommendationsApiError>);
  });
});

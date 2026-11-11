import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthRequiredError } from '../../config/authFetch';
import {
  RecommendedTeamsApiError,
  fetchRecommendedTeams,
  parseRecommendedTeamsResponse,
} from './recommendedTeamsApi';

vi.mock('../../config/authFetch', async () => {
  const actual = await vi.importActual<typeof import('../../config/authFetch')>('../../config/authFetch');
  return { ...actual, authFetch: vi.fn() };
});

import { authFetch } from '../../config/authFetch';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const team = (over: Record<string, unknown> = {}) => ({
  rank: 1,
  teamId: 't-1',
  vacancyId: 'v-1',
  teamName: 'Civic Signal',
  goal: 'Learning',
  commitmentHours: 12,
  vacancyRole: 'Backend',
  matchPercent: 80,
  matchedSkills: ['Node.js'],
  missingSkills: ['PostgreSQL'],
  roleMatched: true,
  contributions: { skill: 'a', goal: 'b', hours: 'c' },
  ...over,
});

const ok = (over: Record<string, unknown> = {}) => ({
  recommendations: [team()],
  empty: false,
  ineligibleReason: null,
  message: null,
  notice: 'Self-declared.',
  ...over,
});

function invalid(body: unknown): void {
  expect(() => parseRecommendedTeamsResponse(body)).toThrowError(RecommendedTeamsApiError);
  try {
    parseRecommendedTeamsResponse(body);
  } catch (error) {
    expect(error).toMatchObject({ status: 502, code: 'INVALID_RESPONSE' });
  }
}

describe('recommended teams API (US-016 / #156)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('asks for the signed-in participant\'s own list with GET and no id', async () => {
    vi.mocked(authFetch).mockResolvedValue(json(ok()));
    const result = await fetchRecommendedTeams();
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(authFetch).toHaveBeenCalledWith('/api/recommendations/teams', { method: 'GET' });
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({ teamName: 'Civic Signal', matchPercent: 80, matchedSkills: ['Node.js'] });
    expect(result.empty).toBe(false);
    expect(result.notice).toBe('Self-declared.');
  });

  it('accepts an empty list, with or without a reason', () => {
    expect(parseRecommendedTeamsResponse(ok({ recommendations: [], empty: true }))).toMatchObject({ empty: true, ineligibleReason: null });
    expect(
      parseRecommendedTeamsResponse(ok({ recommendations: [], empty: true, ineligibleReason: 'participant_not_looking', message: 'm' }))
    ).toMatchObject({ ineligibleReason: 'participant_not_looking', message: 'm' });
  });

  it('keeps unset optional values as null', () => {
    const parsed = parseRecommendedTeamsResponse(
      ok({ recommendations: [team({ goal: undefined, commitmentHours: undefined })], notice: undefined, message: undefined })
    );
    expect(parsed.recommendations[0]).toMatchObject({ goal: null, commitmentHours: null });
    expect(parsed.notice).toBeNull();
    expect(parsed.message).toBeNull();
  });

  it('accepts the boundary percentages 0 and 100', () => {
    const parsed = parseRecommendedTeamsResponse(ok({ recommendations: [team({ matchPercent: 0 }), team({ rank: 2, vacancyId: 'v-2', matchPercent: 100 })] }));
    expect(parsed.recommendations.map((t) => t.matchPercent)).toEqual([0, 100]);
  });

  it.each([
    ['not an object', 'nope'],
    ['no list', { empty: false }],
    ['list is not an array', { recommendations: {}, empty: false }],
    ['no empty flag', { recommendations: [] }],
    ['empty flag disagrees with a non-empty list', ok({ empty: true })],
    ['empty flag disagrees with an empty list', ok({ recommendations: [], empty: false })],
    ['a reason on a non-empty list', ok({ ineligibleReason: 'participant_not_looking' })],
    ['an unknown reason', ok({ recommendations: [], empty: true, ineligibleReason: 'made_up' })],
    ['a percentage above 100', ok({ recommendations: [team({ matchPercent: 101 })] })],
    ['a negative percentage', ok({ recommendations: [team({ matchPercent: -1 })] })],
    ['a fractional percentage', ok({ recommendations: [team({ matchPercent: 80.5 })] })],
    ['a text percentage', ok({ recommendations: [team({ matchPercent: '80' })] })],
    ['a rank of 0', ok({ recommendations: [team({ rank: 0 })] })],
    ['no team name', ok({ recommendations: [team({ teamName: '  ' })] })],
    ['no team id', ok({ recommendations: [team({ teamId: '' })] })],
    ['skills that are not text', ok({ recommendations: [team({ matchedSkills: [1] })] })],
    ['missing skills list', ok({ recommendations: [team({ missingSkills: undefined })] })],
    ['role match that is not true/false', ok({ recommendations: [team({ roleMatched: 'yes' })] })],
    ['no explanations', ok({ recommendations: [team({ contributions: undefined })] })],
    ['an incomplete explanation', ok({ recommendations: [team({ contributions: { skill: 'a' } })] })],
    ['an explanation without the goal part', ok({ recommendations: [team({ contributions: { skill: 'a', hours: 'c' } })] })],
    ['an explanation without the hours part', ok({ recommendations: [team({ contributions: { skill: 'a', goal: 'b' } })] })],
    ['an explanation whose parts are not text', ok({ recommendations: [team({ contributions: { skill: 'a', goal: 'b', hours: 3 } })] })],
    ['a row that is not an object', ok({ recommendations: ['x'] })],
  ])('rejects %s as an invalid response', (_label, body) => {
    invalid(body);
  });

  it('turns an invalid body from the server into an INVALID_RESPONSE error', async () => {
    vi.mocked(authFetch).mockResolvedValue(json({ recommendations: 'x' }));
    await expect(fetchRecommendedTeams()).rejects.toMatchObject({ name: 'RecommendedTeamsApiError', status: 502, code: 'INVALID_RESPONSE' });
  });

  it('turns a non-JSON success body into an INVALID_RESPONSE error', async () => {
    vi.mocked(authFetch).mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(fetchRecommendedTeams()).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' });
  });

  it('passes the status, code and message of an error answer through', async () => {
    vi.mocked(authFetch).mockResolvedValue(json({ error: 'Not allowed.', code: 'FORBIDDEN' }, 403));
    await expect(fetchRecommendedTeams()).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', message: 'Not allowed.' });
  });

  it('copes with an error answer that is not JSON', async () => {
    vi.mocked(authFetch).mockResolvedValue(new Response('oops', { status: 500 }));
    await expect(fetchRecommendedTeams()).rejects.toMatchObject({ status: 500, code: 'UNKNOWN_ERROR', message: 'Request failed with status 500' });
  });

  it('passes a sign-in requirement through unchanged', async () => {
    vi.mocked(authFetch).mockRejectedValue(new AuthRequiredError());
    await expect(fetchRecommendedTeams()).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('reports a network failure with a retry message', async () => {
    vi.mocked(authFetch).mockRejectedValue(new Error('offline'));
    await expect(fetchRecommendedTeams()).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
  });
});

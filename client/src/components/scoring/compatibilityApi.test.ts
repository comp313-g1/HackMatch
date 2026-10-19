import { describe, it, expect, vi, beforeEach } from 'vitest';
import { previewCompatibilityScore, CompatibilityScoreApiError } from './compatibilityApi';

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

describe('previewCompatibilityScore', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  it('returns success payload on 200', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          score: 70,
          displayScore: '70.0',
          components: { skill: 0.6, goal: 1, hours: 0.5 },
          matchedSkills: ['react', 'typescript'],
          roleMatched: true,
          hadMissingInput: false,
          contributions: {
            skill: 'Matched 2 of 4 required skills with primary-role match (×1.2, capped at 1.0).',
            goal: 'Identical goals.',
            hours: 'Commitment 10h vs requested 20h.',
          },
          notice: 'Scores use self-declared skills.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await previewCompatibilityScore({
      slot: {
        role: 'Frontend',
        requiredSkills: ['React'],
        requestedHours: 20,
        goal: 'Project Completion',
      },
      candidate: {
        primaryRole: 'Frontend',
        skills: ['React'],
        commitmentHours: 10,
        goal: 'Project Completion',
      },
    });

    expect(result.displayScore).toBe('70.0');
    expect(result.hadMissingInput).toBe(false);
  });

  it('throws with field errors and submitted payload on 400', async () => {
    const submitted = {
      slot: { role: 'Wizard', requiredSkills: [], requestedHours: 1, goal: 'Learning' },
      candidate: {
        primaryRole: 'Frontend',
        skills: [],
        commitmentHours: 1,
        goal: 'Learning',
      },
    };
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Validation failed.',
          code: 'COMPATIBILITY_SCORE_VALIDATION',
          errors: { role: 'Slot role must be one of: Frontend, Backend, Mobile, AI/ML, UI/UX, Pitch.' },
          submitted,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(previewCompatibilityScore(submitted)).rejects.toMatchObject({
      name: 'CompatibilityScoreApiError',
      status: 400,
      code: 'COMPATIBILITY_SCORE_VALIDATION',
      errors: { role: expect.stringContaining('Frontend') },
      submitted,
    } satisfies Partial<CompatibilityScoreApiError>);
  });

  it('preserves entered values on network failure', async () => {
    authFetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const payload = {
      slot: {
        role: 'Frontend',
        requiredSkills: [],
        requestedHours: 10,
        goal: 'Learning',
      },
      candidate: {
        primaryRole: 'Frontend',
        skills: [],
        commitmentHours: 10,
        goal: 'Learning',
      },
    };

    try {
      await previewCompatibilityScore(payload);
      expect.unreachable('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CompatibilityScoreApiError);
      const apiErr = err as CompatibilityScoreApiError;
      expect(apiErr.errors?._form).toMatch(/kept/);
      expect(apiErr.submitted).toEqual(payload);
    }
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from 'firebase/auth';
import {
  buildOpenTeamsQuery,
  validateFilterDraft,
  fetchOpenTeams,
  OpenTeamsApiError,
  EMPTY_FILTERS,
  type OpenTeamsResult,
} from './openTeamsApi';
import { authFetch } from '../../config/authFetch';

vi.mock('../../config/authFetch', () => ({
  authFetch: vi.fn(),
}));

describe('openTeamsApi client module (US-013 / Task 4)', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  describe('buildOpenTeamsQuery', () => {
    it('returns empty string when all draft filters are empty or whitespace', () => {
      expect(buildOpenTeamsQuery(EMPTY_FILTERS)).toBe('');
      expect(
        buildOpenTeamsQuery({
          skills: '   ',
          role: '   ',
          goal: '   ',
          minSlots: '   ',
        })
      ).toBe('');
    });

    it('encodes URI components for skills containing special characters', () => {
      const qs = buildOpenTeamsQuery({
        ...EMPTY_FILTERS,
        skills: 'C++, Node.js',
      });
      // URLSearchParams encodes spaces as + and comma as %2C, plus as %2B
      expect(qs).toBe('?skills=C%2B%2B%2C+Node.js');
    });

    it('builds query with all four parameters in stable order', () => {
      const qs = buildOpenTeamsQuery({
        skills: 'react, typescript',
        role: 'Frontend',
        goal: 'Project Completion',
        minSlots: '2',
      });
      expect(qs).toBe(
        '?skills=react%2C+typescript&role=Frontend&goal=Project+Completion&minSlots=2'
      );
    });

    it('omits fields that are empty while including non-empty ones', () => {
      const qs = buildOpenTeamsQuery({
        skills: '',
        role: 'Backend',
        goal: '',
        minSlots: '3',
      });
      expect(qs).toBe('?role=Backend&minSlots=3');
    });
  });

  describe('validateFilterDraft', () => {
    it('returns no errors for EMPTY_FILTERS', () => {
      expect(validateFilterDraft(EMPTY_FILTERS)).toEqual({});
    });

    it('accepts valid draft filters across all fields', () => {
      const errors = validateFilterDraft({
        skills: 'React, Node.js, TypeScript',
        role: 'frontend',
        goal: ' project  completion ',
        minSlots: '2',
      });
      expect(errors).toEqual({});
    });

    describe('skills validation', () => {
      it('allows up to 5 unique skill tags', () => {
        const errors = validateFilterDraft({
          ...EMPTY_FILTERS,
          skills: 'a, b, c, d, e',
        });
        expect(errors.skills).toBeUndefined();
      });

      it('deduplicates case-insensitively before enforcing 5 tag limit', () => {
        const errors = validateFilterDraft({
          ...EMPTY_FILTERS,
          skills: 'react, REACT, React, ts, node',
        });
        expect(errors.skills).toBeUndefined();
      });

      it('rejects more than 5 unique skill tags', () => {
        const errors = validateFilterDraft({
          ...EMPTY_FILTERS,
          skills: 'a, b, c, d, e, f',
        });
        expect(errors.skills).toBe('Skills filter cannot exceed 5 tags.');
      });

      it('rejects any skill tag longer than 50 characters', () => {
        const errors = validateFilterDraft({
          ...EMPTY_FILTERS,
          skills: 'valid, ' + 'x'.repeat(51),
        });
        expect(errors.skills).toBe('Each skill tag cannot exceed 50 characters.');
      });
    });

    describe('role validation', () => {
      it.each(['Frontend', 'backend', 'MOBILE', 'ai/ml', 'UI/UX', 'pitch'])(
        'accepts allowed role %s case-insensitively',
        (role) => {
          const errors = validateFilterDraft({ ...EMPTY_FILTERS, role });
          expect(errors.role).toBeUndefined();
        }
      );

      it('rejects an unknown role', () => {
        const errors = validateFilterDraft({ ...EMPTY_FILTERS, role: 'Fullstack' });
        expect(errors.role).toBe('Invalid role filter.');
      });
    });

    describe('goal validation', () => {
      it.each(['Learning', 'project completion', 'COMPETITIVE', ' project   completion '])(
        'accepts allowed goal %s case-insensitively with space collapsing',
        (goal) => {
          const errors = validateFilterDraft({ ...EMPTY_FILTERS, goal });
          expect(errors.goal).toBeUndefined();
        }
      );

      it('rejects an unknown goal', () => {
        const errors = validateFilterDraft({ ...EMPTY_FILTERS, goal: 'Casual' });
        expect(errors.goal).toBe('Invalid goal filter.');
      });
    });

    describe('minSlots validation', () => {
      it.each(['1', '2', '10', '20'])('accepts valid integer minSlots %s', (minSlots) => {
        const errors = validateFilterDraft({ ...EMPTY_FILTERS, minSlots });
        expect(errors.minSlots).toBeUndefined();
      });

      it.each(['0', '21', '-1', '1.5', 'abc', '1e2'])(
        'rejects invalid minSlots %s',
        (minSlots) => {
          const errors = validateFilterDraft({ ...EMPTY_FILTERS, minSlots });
          expect(errors.minSlots).toBe('Minimum open slots must be an integer between 1 and 20.');
        }
      );
    });
  });

  describe('fetchOpenTeams', () => {
    const mockVisitorResult: OpenTeamsResult = {
      viewer: 'VISITOR',
      total: 1,
      teams: [
        {
          displayLabel: 'Recruiting team',
          goal: 'Project Completion',
          commitmentHours: 15,
          confirmedMembers: 2,
          openSlots: 2,
          vacancies: [{ role: 'Frontend', skills: ['React'] }],
        },
      ],
    };

    const mockPartUser = { uid: 'u-123' } as User;

    it('performs plain fetch without authFetch when user is null', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockVisitorResult), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const res = await fetchOpenTeams({ ...EMPTY_FILTERS, role: 'Frontend' }, null);

      expect(vi.mocked(authFetch)).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith('/api/teams?role=Frontend', {
        method: 'GET',
        signal: undefined,
      });
      expect(res).toEqual(mockVisitorResult);
    });

    it('calls authFetch with user when user is logged in', async () => {
      const partResult: OpenTeamsResult = {
        viewer: 'PART',
        total: 1,
        teams: [
          {
            id: 't-1',
            name: 'Alpha Team',
            pitch: 'Great pitch',
            goal: 'Project Completion',
            commitmentHours: 15,
            confirmedMembers: 2,
            openSlots: 2,
            isViewerMember: false,
            members: [{ displayName: 'Alice', role: 'Owner' }],
            vacancies: [{ id: 'v-1', role: 'Frontend', skills: ['React'] }],
            createdAt: '2026-10-18T10:00:00.000Z',
          },
        ],
      };

      vi.mocked(authFetch).mockResolvedValueOnce(
        new Response(JSON.stringify(partResult), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const res = await fetchOpenTeams(EMPTY_FILTERS, mockPartUser);

      expect(vi.mocked(authFetch)).toHaveBeenCalledWith('/api/teams', {
        method: 'GET',
        signal: undefined,
      }, mockPartUser);
      expect(res).toEqual(partResult);
    });

    it('retries once as plain visitor fetch when authFetch responds with 401', async () => {
      vi.mocked(authFetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Session expired', code: 'INVALID_TOKEN' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockVisitorResult), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const res = await fetchOpenTeams(EMPTY_FILTERS, mockPartUser);

      expect(mockFetch).toHaveBeenCalledWith('/api/teams', {
        method: 'GET',
        signal: undefined,
      });
      expect(res).toEqual(mockVisitorResult);
    });

    it('retries once as plain visitor fetch when authFetch responds with 403', async () => {
      vi.mocked(authFetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'MFA required', code: 'MFA_REQUIRED' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockVisitorResult), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const res = await fetchOpenTeams(EMPTY_FILTERS, mockPartUser);

      expect(mockFetch).toHaveBeenCalledWith('/api/teams', {
        method: 'GET',
        signal: undefined,
      });
      expect(res).toEqual(mockVisitorResult);
    });

    it('falls back to plain fetch when authFetch throws an error', async () => {
      vi.mocked(authFetch).mockRejectedValueOnce(new Error('Network failure getting token'));

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockVisitorResult), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const res = await fetchOpenTeams(EMPTY_FILTERS, mockPartUser);

      expect(mockFetch).toHaveBeenCalledWith('/api/teams', {
        method: 'GET',
        signal: undefined,
      });
      expect(res).toEqual(mockVisitorResult);
    });

    it('throws OpenTeamsApiError with status, code, and errors when API returns non-ok status', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            errors: { minSlots: 'Minimum open slots must be between 1 and 20.' },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await expect(fetchOpenTeams({ ...EMPTY_FILTERS, minSlots: '99' }, null)).rejects.toThrow(
        OpenTeamsApiError
      );

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            errors: { minSlots: 'Minimum open slots must be between 1 and 20.' },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      );

      try {
        await fetchOpenTeams({ ...EMPTY_FILTERS, minSlots: '99' }, null);
      } catch (e) {
        const err = e as OpenTeamsApiError;
        expect(err.status).toBe(400);
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.errors?.minSlots).toBe('Minimum open slots must be between 1 and 20.');
        expect(err.message).toBe('Validation failed');
      }
    });

    it('gracefully handles non-JSON error response body', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Bad Gateway 502', {
          status: 502,
          headers: { 'Content-Type': 'text/plain' },
        })
      );

      try {
        await fetchOpenTeams(EMPTY_FILTERS, null);
        expect.unreachable('Should have thrown OpenTeamsApiError');
      } catch (e) {
        const err = e as OpenTeamsApiError;
        expect(err.status).toBe(502);
        expect(err.code).toBe('UNKNOWN_ERROR');
        expect(err.message).toBe('Request failed with status 502');
      }
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseClient } from './client.js';
import { teamRecommendationsRepository } from './teamRecommendations.repository.js';

vi.mock('./client.js', () => ({ getSupabaseClient: vi.fn() }));

const ME = '11111111-1111-4111-8111-111111111111';
const MEMBER_TEAM = '22222222-2222-4222-8222-222222222222';
const PENDING_TEAM = '33333333-3333-4333-8333-333333333333';
const TEAM = '44444444-4444-4444-8444-444444444444';
const OWNER = '55555555-5555-4555-8555-555555555555';
const VACANCY = '66666666-6666-4666-8666-666666666666';

describe('teamRecommendationsRepository (US-016 / #154)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses participant-scoped set queries and database-side candidate filters', async () => {
    const candidateCalls: Array<[string, ...unknown[]]> = [];
    const candidateBuilder: Record<string, unknown> = {};
    for (const method of ['eq', 'is', 'neq', 'order', 'limit', 'not']) {
      candidateBuilder[method] = vi.fn((...args: unknown[]) => {
        candidateCalls.push([method, ...args]);
        return candidateBuilder;
      });
    }
    candidateBuilder.select = vi.fn(() => candidateBuilder);
    candidateBuilder.then = (
      resolve: (value: { data: unknown[]; error: null }) => unknown
    ) =>
      Promise.resolve(
        resolve({
          data: [
            {
              id: VACANCY,
              team_id: TEAM,
              role: 'Backend',
              skills: ['Node.js'],
              status: 'Open',
              removed_at: null,
              created_at: '2026-01-02T00:00:00.000Z',
              team: {
                id: TEAM,
                owner_participant_id: OWNER,
                name: 'Set Query Team',
                pitch: 'Loaded once, not once per team.',
                goal: 'Learning',
                commitment_hours: '12',
                recruitment_status: 'Open',
                locked_at: null,
                disbanded_at: null,
                moderation_hidden_at: null,
                moderation_status: 'None',
                created_at: '2026-01-01T00:00:00.000Z',
                team_memberships: [
                  { participant_id: OWNER, status: 'Confirmed' },
                  { participant_id: ME, status: 'Removed' },
                ],
              },
            },
          ],
          error: null,
        })
      );

    const membershipBuilder = {
      select: vi.fn(() => membershipBuilder),
      eq: vi.fn((column: string) =>
        column === 'status'
          ? Promise.resolve({ data: [{ team_id: MEMBER_TEAM }], error: null })
          : membershipBuilder
      ),
    };
    const requestBuilder = {
      select: vi.fn(() => requestBuilder),
      eq: vi.fn(() => requestBuilder),
      in: vi.fn(() =>
        Promise.resolve({ data: [{ team_id: PENDING_TEAM }], error: null })
      ),
    };

    const from = vi.fn((table: string) => {
      if (table === 'team_memberships') return membershipBuilder;
      if (table === 'team_requests') return requestBuilder;
      if (table === 'team_vacancies') return candidateBuilder;
      throw new Error(`Unexpected table: ${table}`);
    });
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);

    const result = await teamRecommendationsRepository.listEligibleTeamVacanciesForParticipant(ME);

    expect(from.mock.calls.map(([table]) => table)).toEqual([
      'team_memberships',
      'team_requests',
      'team_vacancies',
    ]);
    expect(requestBuilder.in).toHaveBeenCalledWith('request_type', [
      'Application',
      'Invitation',
    ]);
    expect(candidateCalls).toEqual(
      expect.arrayContaining([
        ['eq', 'status', 'Open'],
        ['is', 'removed_at', null],
        ['eq', 'team.recruitment_status', 'Open'],
        ['is', 'team.locked_at', null],
        ['is', 'team.disbanded_at', null],
        ['is', 'team.moderation_hidden_at', null],
        ['neq', 'team.owner_participant_id', ME],
        ['neq', 'team.moderation_status', 'Hidden'],
      ])
    );
    expect(candidateCalls).toContainEqual([
      'not',
      'team_id',
      'in',
      `(${MEMBER_TEAM},${PENDING_TEAM})`,
    ]);
    expect(result.pendingRequestTeamIds).toEqual(new Set([PENDING_TEAM]));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      team: { id: TEAM, name: 'Set Query Team', commitment_hours: 12 },
      vacancy: { id: VACANCY, team_id: TEAM, status: 'Open' },
    });
    expect([...result.candidates[0]!.confirmedMemberIds]).toEqual([OWNER]);
  });

  it('propagates participant-scope lookup failures and does not issue the candidate query', async () => {
    const membershipBuilder = {
      select: vi.fn(() => membershipBuilder),
      eq: vi.fn((column: string) =>
        column === 'status'
          ? Promise.resolve({ data: null, error: new Error('membership lookup failed') })
          : membershipBuilder
      ),
    };
    const requestBuilder = {
      select: vi.fn(() => requestBuilder),
      eq: vi.fn(() => requestBuilder),
      in: vi.fn(() => Promise.resolve({ data: [], error: null })),
    };
    const from = vi.fn((table: string) => {
      if (table === 'team_memberships') return membershipBuilder;
      if (table === 'team_requests') return requestBuilder;
      throw new Error('candidate query should not run');
    });
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);

    await expect(
      teamRecommendationsRepository.listEligibleTeamVacanciesForParticipant(ME)
    ).rejects.toThrow('membership lookup failed');
    expect(from).not.toHaveBeenCalledWith('team_vacancies');
  });
});

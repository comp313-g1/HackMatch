import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MEMBERSHIP_PSEUDONYM_PREFIX,
  buildMembershipPseudonym,
  pseudonymizeHistoricalMemberships,
  resolveMembershipDisplayName,
} from './membershipPseudonymization.js';
import { getSupabaseClient } from '../db/client.js';

vi.mock('../db/client.js', () => ({
  getSupabaseClient: vi.fn(),
}));

const participantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const lockedTeamId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const unlockedTeamId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const lockedMembershipId = '11111111-1111-4111-8111-111111111111';
const unlockedMembershipId = '22222222-2222-4222-8222-222222222222';

describe('buildMembershipPseudonym / resolveMembershipDisplayName (US-027 / #253)', () => {
  it('builds a stable non-identifying label (happy path)', () => {
    expect(buildMembershipPseudonym(participantId)).toBe(
      `${MEMBERSHIP_PSEUDONYM_PREFIX} bbbbbbbb`
    );
  });

  it('rejects empty participantId (invalid input)', () => {
    expect(() => buildMembershipPseudonym('   ')).toThrow(/participantId is required/i);
  });

  it('prefers pseudonymized snapshot over live name/handle', () => {
    const resolved = resolveMembershipDisplayName({
      identityPseudonymizedAt: '2026-10-21T12:00:00.000Z',
      identityDisplayName: 'Former Member bbbbbbbb',
      handle: 'ada',
      fullName: 'Ada Lovelace',
    });
    expect(resolved).toEqual({
      displayName: 'Former Member bbbbbbbb',
      handle: null,
      isPseudonymized: true,
    });
  });

  it('falls back to handle then full name when not pseudonymized (boundary)', () => {
    expect(
      resolveMembershipDisplayName({
        identityPseudonymizedAt: null,
        identityDisplayName: null,
        handle: 'ada',
        fullName: 'Ada Lovelace',
      }).displayName
    ).toBe('ada');
    expect(
      resolveMembershipDisplayName({
        identityPseudonymizedAt: null,
        handle: null,
        fullName: null,
      }).displayName
    ).toBe('Participant');
  });
});

describe('pseudonymizeHistoricalMemberships (US-027 / #253)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects missing participantId (invalid input)', async () => {
    await expect(pseudonymizeHistoricalMemberships('')).rejects.toThrow(/participantId is required/i);
  });

  it('returns zero counts when the participant has no memberships (boundary / empty)', async () => {
    const maybeList = vi.fn(async () => ({ data: [], error: null }));
    const eq = vi.fn(() => ({ then: undefined, ...{ data: [], error: null } }));
    // chain: select().eq() resolves via awaitable - make eq return promise-like via thenable object
    const select = vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
    }));
    vi.mocked(getSupabaseClient).mockReturnValue({
      from: vi.fn(() => ({ select })),
    } as never);
    void maybeList;
    void eq;

    const result = await pseudonymizeHistoricalMemberships(participantId);
    expect(result).toEqual({
      lockedMembershipsPseudonymized: 0,
      unlockedMembershipsPseudonymized: 0,
      membershipIdsPreserved: [],
      lockedTeamIdsPreserved: [],
      membershipsDeleted: false,
    });
  });

  it('pseudonymizes locked and unlocked memberships without deleting rows (happy path)', async () => {
    const lockedRow = {
      id: lockedMembershipId,
      team_id: lockedTeamId,
      role: 'Member',
      status: 'Confirmed',
      joined_at: '2026-10-18T10:00:00.000Z',
      ended_at: null,
      teams: { id: lockedTeamId, locked_at: '2026-10-20T00:00:00.000Z' },
    };
    const unlockedRow = {
      id: unlockedMembershipId,
      team_id: unlockedTeamId,
      role: 'Member',
      status: 'Released',
      joined_at: '2026-09-01T10:00:00.000Z',
      ended_at: '2026-09-15T10:00:00.000Z',
      teams: { id: unlockedTeamId, locked_at: null },
    };

    const updateCalls: Array<Record<string, unknown>> = [];

    const from = vi.fn((table: string) => {
      if (table !== 'team_memberships') return {};
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() =>
            Promise.resolve({ data: [lockedRow, unlockedRow], error: null })
          ),
        })),
        update: vi.fn((patch: Record<string, unknown>) => {
          updateCalls.push(patch);
          const api: Record<string, unknown> = {};
          api.eq = vi.fn(() => api);
          api.select = vi.fn(() => api);
          api.single = vi.fn(async () => {
            const source = updateCalls.length === 1 ? lockedRow : unlockedRow;
            return {
              data: {
                id: source.id,
                team_id: source.team_id,
                role: source.role,
                status: source.status,
                joined_at: source.joined_at,
                ended_at: source.ended_at,
              },
              error: null,
            };
          });
          return api;
        }),
      };
    });
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);

    const result = await pseudonymizeHistoricalMemberships(participantId);

    expect(result.membershipsDeleted).toBe(false);
    expect(result.lockedMembershipsPseudonymized).toBe(1);
    expect(result.unlockedMembershipsPseudonymized).toBe(1);
    expect(result.membershipIdsPreserved).toEqual([
      lockedMembershipId,
      unlockedMembershipId,
    ]);
    expect(result.lockedTeamIdsPreserved).toEqual([lockedTeamId]);
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({
        identity_display_name: buildMembershipPseudonym(participantId),
        identity_handle: null,
        identity_email: null,
      })
    );
    // Never pass structural roster fields in the update payload.
    expect(updateCalls[0]).not.toHaveProperty('role');
    expect(updateCalls[0]).not.toHaveProperty('status');
    expect(updateCalls[0]).not.toHaveProperty('team_id');
    expect(updateCalls[0]).not.toHaveProperty('participant_id');
  });

  it('surfaces repository failures (failure path)', async () => {
    const from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() =>
          Promise.resolve({ data: null, error: { message: 'db down', code: '57014' } })
        ),
      })),
    }));
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);

    await expect(pseudonymizeHistoricalMemberships(participantId)).rejects.toMatchObject({
      message: 'db down',
    });
  });

  it('fails when a structural roster field would change (integrity / boundary)', async () => {
    const lockedRow = {
      id: lockedMembershipId,
      team_id: lockedTeamId,
      role: 'Member',
      status: 'Confirmed',
      joined_at: '2026-10-18T10:00:00.000Z',
      ended_at: null,
      teams: { id: lockedTeamId, locked_at: '2026-10-20T00:00:00.000Z' },
    };
    const from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: [lockedRow], error: null })),
      })),
      update: vi.fn(() => {
        const api: Record<string, unknown> = {};
        api.eq = vi.fn(() => api);
        api.select = vi.fn(() => api);
        api.single = vi.fn(async () => ({
          data: {
            id: lockedMembershipId,
            team_id: lockedTeamId,
            role: 'Owner', // mutated — must fail integrity check
            status: 'Confirmed',
            joined_at: lockedRow.joined_at,
            ended_at: null,
          },
          error: null,
        }));
        return api;
      }),
    }));
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);

    await expect(pseudonymizeHistoricalMemberships(participantId)).rejects.toThrow(
      /roster integrity/i
    );
  });
});

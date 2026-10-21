import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ACCOUNT_SUSPEND_CANCEL_REASON,
  applySuspensionCascade,
} from './accountSuspensionCascade.js';
import { getSupabaseClient } from '../db/client.js';
import { availabilityRepository } from '../repositories/availability.repository.js';

vi.mock('../db/client.js', () => ({
  getSupabaseClient: vi.fn(),
}));

type ChainResult = { data: unknown; error: unknown };

function chainable(result: ChainResult) {
  const terminal = vi.fn(async () => result);
  const api: Record<string, unknown> = {};
  const methods = ['select', 'update', 'eq', 'in', 'is'];
  for (const m of methods) {
    api[m] = vi.fn(() => api);
  }
  // Final select after update resolves the promise.
  api.select = vi.fn(() => Promise.resolve(result));
  // Allow await on the chain itself when callers do `.select('id')` as the last step.
  Object.assign(api, {
    then: undefined,
  });
  // Make the object thenable via the last select returning a promise (above).
  void terminal;
  return api;
}

describe('applySuspensionCascade (US-027 / #251)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('cancels pending requests, hides profile, clears LFT, and pauses owned Open teams', async () => {
    const teamId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const participantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    // Shared across both .from('team_requests') calls (incoming then outgoing).
    const teamRequestResults: ChainResult[] = [
      { data: [{ id: 'req-1' }, { id: 'req-2' }], error: null },
      { data: [{ id: 'inv-1' }], error: null },
    ];
    let teamRequestCall = 0;

    const from = vi.fn((table: string) => {
      if (table === 'team_requests') {
        return {
          update: vi.fn(() => {
            const result =
              teamRequestResults[Math.min(teamRequestCall, teamRequestResults.length - 1)]!;
            teamRequestCall += 1;
            const api: Record<string, unknown> = {};
            api.eq = vi.fn(() => api);
            api.in = vi.fn(() => api);
            api.select = vi.fn(() => Promise.resolve(result));
            return api;
          }),
        };
      }
      if (table === 'teams') {
        let phase = 0;
        return {
          select: vi.fn(() => {
            const api: Record<string, unknown> = {};
            api.eq = vi.fn(() => api);
            api.is = vi.fn(() => Promise.resolve({ data: [{ id: teamId }], error: null }));
            return api;
          }),
          update: vi.fn(() => {
            phase += 1;
            void phase;
            const api: Record<string, unknown> = {};
            api.in = vi.fn(() => api);
            api.select = vi.fn(() =>
              Promise.resolve({ data: [{ id: teamId }], error: null })
            );
            return api;
          }),
        };
      }
      if (table === 'participant_profiles') {
        return {
          update: vi.fn(() => {
            const api: Record<string, unknown> = {};
            api.eq = vi.fn(() => api);
            api.select = vi.fn(() =>
              Promise.resolve({ data: [{ participant_id: participantId }], error: null })
            );
            return api;
          }),
        };
      }
      return chainable({ data: [], error: null });
    });

    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);
    vi.spyOn(availabilityRepository, 'clearLookingForTeamStatus').mockResolvedValue(true);

    const effects = await applySuspensionCascade(participantId);

    expect(effects).toEqual({
      pendingIncomingRequestsCanceled: 2,
      outgoingInvitationsCanceled: 1,
      profileHidden: true,
      availabilityCleared: true,
      ownedTeamsPaused: 1,
      membershipsPreserved: true,
    });
    expect(availabilityRepository.clearLookingForTeamStatus).toHaveBeenCalledWith(participantId);

    // Incoming cancel used ACCOUNT_SUSPENDED reason.
    const teamRequestsUpdate = from.mock.calls
      .filter(([t]) => t === 'team_requests')
      .map(() => true);
    expect(teamRequestsUpdate.length).toBeGreaterThanOrEqual(1);

    const firstTeamRequestsBuilder = from.mock.results.find(
      (r, idx) => from.mock.calls[idx]?.[0] === 'team_requests'
    )?.value as { update: ReturnType<typeof vi.fn> };
    expect(firstTeamRequestsBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'Canceled',
        cancel_reason: ACCOUNT_SUSPEND_CANCEL_REASON,
      })
    );
  });

  it('returns zeroed counts when the participant has no pending requests or owned Open teams', async () => {
    const participantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const from = vi.fn((table: string) => {
      if (table === 'team_requests') {
        return {
          update: vi.fn(() => {
            const api: Record<string, unknown> = {};
            api.eq = vi.fn(() => api);
            api.select = vi.fn(() => Promise.resolve({ data: [], error: null }));
            return api;
          }),
        };
      }
      if (table === 'teams') {
        return {
          select: vi.fn(() => {
            const api: Record<string, unknown> = {};
            api.eq = vi.fn(() => api);
            api.is = vi.fn(() => Promise.resolve({ data: [], error: null }));
            return api;
          }),
        };
      }
      if (table === 'participant_profiles') {
        return {
          update: vi.fn(() => {
            const api: Record<string, unknown> = {};
            api.eq = vi.fn(() => api);
            api.select = vi.fn(() => Promise.resolve({ data: [], error: null }));
            return api;
          }),
        };
      }
      return {};
    });
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);
    vi.spyOn(availabilityRepository, 'clearLookingForTeamStatus').mockResolvedValue(false);

    const effects = await applySuspensionCascade(participantId);

    expect(effects).toEqual({
      pendingIncomingRequestsCanceled: 0,
      outgoingInvitationsCanceled: 0,
      profileHidden: false,
      availabilityCleared: false,
      ownedTeamsPaused: 0,
      membershipsPreserved: true,
    });
  });
});

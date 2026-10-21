import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DELETION_TARGET_NOTICE,
  eraseLiveAccountPii,
  requestAccountDeletion,
} from './accountDeletion.js';
import { accountDeletionRepository } from '../db/accountDeletion.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { accountsRepository } from '../db/accounts.repository.js';
import { getSupabaseClient } from '../db/client.js';
import { firebaseAuth } from '../config/firebase.js';
import { applySuspensionCascade } from './accountSuspensionCascade.js';
import type { Participant } from '../db/types.js';

vi.mock('../config/firebase.js', () => ({
  firebaseAuth: {
    revokeRefreshTokens: vi.fn(),
    deleteUser: vi.fn(),
  },
}));

vi.mock('./accountSuspensionCascade.js', () => ({
  applySuspensionCascade: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  getSupabaseClient: vi.fn(),
}));

const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const part: Participant = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  firebase_uid: 'fb-part-1',
  email: 'part@example.com',
  full_name: 'Ada Lovelace',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  suspended_at: null,
  created_at: '2026-10-18T00:00:00.000Z',
  updated_at: '2026-10-18T01:00:00.000Z',
};

function mockTeamsQuery(teams: Array<{ id: string; name: string }>) {
  // .select().eq().is().is() — final is() resolves.
  const finalIs = vi.fn(async () => ({ data: teams, error: null }));
  const firstIs = vi.fn(() => ({ is: finalIs }));
  const eq = vi.fn(() => ({ is: firstIs }));
  const select = vi.fn(() => ({ eq }));
  return { select };
}

describe('requestAccountDeletion (US-027 / #252)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(firebaseAuth.revokeRefreshTokens).mockResolvedValue(undefined as never);
    vi.mocked(firebaseAuth.deleteUser).mockResolvedValue(undefined as never);
    vi.mocked(applySuspensionCascade).mockResolvedValue({
      pendingIncomingRequestsCanceled: 0,
      outgoingInvitationsCanceled: 0,
      profileHidden: true,
      availabilityCleared: true,
      ownedTeamsPaused: 0,
      membershipsPreserved: true,
    });
  });

  it('rejects PART actors', async () => {
    await expect(
      requestAccountDeletion({
        actorParticipantId: adminId,
        actorRole: 'PART',
        accountId: part.id,
        reason: 'Nope',
        ownershipVerified: true,
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE', status: 403 });
  });

  it('rejects when ownershipVerified is false', async () => {
    await expect(
      requestAccountDeletion({
        actorParticipantId: adminId,
        actorRole: 'ADMIN',
        accountId: part.id,
        reason: 'Owner asked',
        ownershipVerified: false,
      })
    ).rejects.toMatchObject({ code: 'OWNERSHIP_NOT_VERIFIED', status: 400 });
  });

  it('rejects self-deletion', async () => {
    await expect(
      requestAccountDeletion({
        actorParticipantId: part.id,
        actorRole: 'ADMIN',
        accountId: part.id,
        reason: 'Nope',
        ownershipVerified: true,
      })
    ).rejects.toMatchObject({ code: 'SELF_DELETE_FORBIDDEN', status: 400 });
  });

  it('blocks deletion when the account owns unlocked teams (US-027-T5)', async () => {
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(part);
    vi.spyOn(accountDeletionRepository, 'findOpenByParticipantId').mockResolvedValue(null);
    const teamsChain = mockTeamsQuery([
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Rocket' },
    ]);
    vi.mocked(getSupabaseClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'teams') return teamsChain;
        return {};
      }),
    } as never);

    const created = {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      participant_id: part.id,
      requested_by: adminId,
      reason: 'Verified owner request',
      status: 'BlockedNeedsDisband' as const,
      ownership_verified: true,
      ownership_verified_at: '2026-10-21T12:00:00.000Z',
      ownership_verified_by: adminId,
      blocked_reason: 'Owner must disband 1 unlocked team(s)',
      target_completion_at: '2026-11-20T12:00:00.000Z',
      completed_at: null,
      safe_state_summary: {},
      created_at: '2026-10-21T12:00:00.000Z',
      updated_at: '2026-10-21T12:00:00.000Z',
    };
    vi.spyOn(accountDeletionRepository, 'create').mockResolvedValue(created);
    vi.spyOn(moderationRepository, 'insertActionRecord').mockResolvedValue({
      id: 'rec-block',
      actor_id: adminId,
      target_type: 'account',
      target_id: part.id,
      action_type: 'account_delete',
      reason: 'Verified owner request',
      outcome: 'deletion_blocked_needs_disband',
      safe_state_summary: {},
      created_at: created.created_at,
    });
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue(null);
    vi.spyOn(accountsRepository, 'listRelevantListings').mockResolvedValue([]);
    vi.spyOn(accountsRepository, 'findById').mockResolvedValue(part);

    await expect(
      requestAccountDeletion({
        actorParticipantId: adminId,
        actorRole: 'ADMIN',
        accountId: part.id,
        reason: 'Verified owner request',
        ownershipVerified: true,
      })
    ).rejects.toMatchObject({
      code: 'UNLOCKED_OWNER_MUST_DISBAND',
      status: 409,
      details: expect.objectContaining({
        outcome: 'deletion_blocked_needs_disband',
        request: expect.objectContaining({
          status: 'BlockedNeedsDisband',
          targetCompletionAt: created.target_completion_at,
          targetNotice: DELETION_TARGET_NOTICE,
        }),
      }),
    });

    expect(firebaseAuth.deleteUser).not.toHaveBeenCalled();
    expect(accountDeletionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownership_verified: true,
        status: 'BlockedNeedsDisband',
      })
    );
  });

  it('records ownership-verified request, erases live PII, and completes within 30-day target workflow', async () => {
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(part);
    vi.spyOn(accountDeletionRepository, 'findOpenByParticipantId').mockResolvedValue(null);

    const teamsChain = mockTeamsQuery([]);
    const eraseFrom = vi.fn((table: string): Record<string, unknown> => {
      if (table === 'teams') return teamsChain;
      if (table === 'participants') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: {}, error: null })),
          })),
        };
      }
      if (table === 'participant_profiles') {
        return {
          update: vi.fn(() => {
            const api: Record<string, unknown> = {};
            api.eq = vi.fn(() => api);
            api.select = vi.fn(async () => ({
              data: [{ participant_id: part.id }],
              error: null,
            }));
            return api;
          }),
        };
      }
      if (table === 'participant_skills' || table === 'participant_portfolios') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: null, error: null })),
          })),
        };
      }
      if (table === 'provider_identities' || table === 'mfa_challenges') {
        return {
          delete: vi.fn(() => {
            const api: Record<string, unknown> = {};
            api.eq = vi.fn(() => api);
            api.select = vi.fn(async () => ({ data: [], error: null }));
            return api;
          }),
        };
      }
      return {};
    });
    vi.mocked(getSupabaseClient).mockReturnValue({ from: eraseFrom } as never);

    const pending = {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      participant_id: part.id,
      requested_by: adminId,
      reason: 'Verified owner requested deletion',
      status: 'Pending' as const,
      ownership_verified: true,
      ownership_verified_at: '2026-10-21T12:00:00.000Z',
      ownership_verified_by: adminId,
      blocked_reason: null,
      target_completion_at: '2026-11-20T12:00:00.000Z',
      completed_at: null,
      safe_state_summary: {},
      created_at: '2026-10-21T12:00:00.000Z',
      updated_at: '2026-10-21T12:00:00.000Z',
    };
    vi.spyOn(accountDeletionRepository, 'create').mockResolvedValue(pending);
    vi.spyOn(accountDeletionRepository, 'update')
      .mockResolvedValueOnce({ ...pending, status: 'Processing' })
      .mockResolvedValueOnce({
        ...pending,
        status: 'Completed',
        completed_at: '2026-10-21T12:05:00.000Z',
      });
    vi.spyOn(moderationRepository, 'insertActionRecord').mockResolvedValue({
      id: 'rec-del',
      actor_id: adminId,
      target_type: 'account',
      target_id: part.id,
      action_type: 'account_delete',
      reason: pending.reason,
      outcome: 'deletion_completed',
      safe_state_summary: {},
      created_at: '2026-10-21T12:05:00.000Z',
    });
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue(null);
    vi.spyOn(accountsRepository, 'listRelevantListings').mockResolvedValue([]);
    vi.spyOn(accountsRepository, 'findById').mockResolvedValue({
      ...part,
      email: 'deleted+bbbbbbbbbbbb@deleted.invalid',
      full_name: 'Deleted User',
      is_deactivated: true,
      is_suspended: true,
    });

    const result = await requestAccountDeletion({
      actorParticipantId: adminId,
      actorRole: 'ADMIN',
      accountId: part.id,
      reason: 'Verified owner requested deletion',
      ownershipVerified: true,
    });

    expect(result.outcome).toBe('deletion_completed');
    expect(result.livePiiErased).toBe(true);
    expect(result.firebaseUserDeleted).toBe(true);
    expect(result.lockedMembershipsPseudonymized).toBe(false);
    expect(result.request.targetCompletionAt).toBe(pending.target_completion_at);
    expect(result.request.targetNotice).toBe(DELETION_TARGET_NOTICE);
    expect(result.account.state).toBe('Deactivated');
    expect(firebaseAuth.revokeRefreshTokens).toHaveBeenCalledWith('fb-part-1');
    expect(firebaseAuth.deleteUser).toHaveBeenCalledWith('fb-part-1');
    expect(applySuspensionCascade).toHaveBeenCalledWith(part.id);
  });
});

describe('eraseLiveAccountPii (US-027 / #252)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('tombstones participant identity and clears profile PII', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'participants') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: {}, error: null })),
          })),
        };
      }
      if (table === 'participant_profiles') {
        return {
          update: vi.fn(() => {
            const api: Record<string, unknown> = {};
            api.eq = vi.fn(() => api);
            api.select = vi.fn(async () => ({
              data: [{ participant_id: part.id }],
              error: null,
            }));
            return api;
          }),
        };
      }
      if (table === 'participant_skills' || table === 'participant_portfolios') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: null })),
          })),
        };
      }
      if (table === 'provider_identities' || table === 'mfa_challenges') {
        return {
          delete: vi.fn(() => {
            const api: Record<string, unknown> = {};
            api.eq = vi.fn(() => api);
            api.select = vi.fn(async () => ({ data: [{ id: 'x' }], error: null }));
            return api;
          }),
        };
      }
      return {};
    });
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);

    const stats = await eraseLiveAccountPii(part.id);
    expect(stats.profileCleared).toBe(true);
    expect(stats.providerIdentitiesRemoved).toBe(1);
    expect(from).toHaveBeenCalledWith('participants');
    expect(from).toHaveBeenCalledWith('participant_profiles');
  });
});

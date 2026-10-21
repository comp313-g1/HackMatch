import { describe, it, expect, vi, beforeEach } from 'vitest';
import { suspendAccount } from './accountSuspension.js';
import { participantsRepository } from '../db/participants.repository.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { accountsRepository } from '../db/accounts.repository.js';
import { firebaseAuth } from '../config/firebase.js';
import { applySuspensionCascade } from './accountSuspensionCascade.js';
import type { Participant } from '../db/types.js';

vi.mock('../config/firebase.js', () => ({
  firebaseAuth: {
    revokeRefreshTokens: vi.fn(),
    updateUser: vi.fn(),
  },
}));

vi.mock('./accountSuspensionCascade.js', () => ({
  applySuspensionCascade: vi.fn(),
}));

const cascadeEffects = {
  pendingIncomingRequestsCanceled: 2,
  outgoingInvitationsCanceled: 1,
  profileHidden: true,
  availabilityCleared: true,
  ownedTeamsPaused: 1,
  membershipsPreserved: true as const,
};

describe('suspendAccount (US-027 / #250 / #251)', () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(firebaseAuth.revokeRefreshTokens).mockResolvedValue(undefined as never);
    vi.mocked(firebaseAuth.updateUser).mockResolvedValue({} as never);
    vi.mocked(applySuspensionCascade).mockResolvedValue(cascadeEffects);
  });

  it('suspends account, revokes sessions, disables Firebase sign-in, and writes action record', async () => {
    const suspendedAt = '2026-10-21T12:00:00.000Z';
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(part);
    vi.spyOn(participantsRepository, 'updateParticipant').mockResolvedValue({
      ...part,
      is_suspended: true,
      suspended_at: suspendedAt,
      suspended_by: adminId,
      suspension_reason: 'Harassment',
    });
    vi.spyOn(moderationRepository, 'insertActionRecord').mockResolvedValue({
      id: 'rec-1',
      actor_id: adminId,
      target_type: 'account',
      target_id: part.id,
      action_type: 'account_suspend',
      reason: 'Harassment',
      outcome: 'account_suspended',
      safe_state_summary: {},
      created_at: suspendedAt,
    });
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue(null);
    vi.spyOn(accountsRepository, 'listRelevantListings').mockResolvedValue([]);
    vi.spyOn(accountsRepository, 'findById').mockResolvedValue({
      ...part,
      is_suspended: true,
      suspended_at: suspendedAt,
      suspended_by: adminId,
      suspension_reason: 'Harassment',
    });

    const result = await suspendAccount({
      actorParticipantId: adminId,
      actorRole: 'ADMIN',
      accountId: part.id,
      reason: 'Harassment',
    });

    expect(participantsRepository.updateParticipant).toHaveBeenCalledWith(
      part.id,
      expect.objectContaining({
        is_suspended: true,
        suspension_reason: 'Harassment',
        suspended_by: adminId,
      })
    );
    expect(firebaseAuth.revokeRefreshTokens).toHaveBeenCalledWith('fb-part-1');
    expect(firebaseAuth.updateUser).toHaveBeenCalledWith('fb-part-1', { disabled: true });
    expect(result.sessionsRevoked).toBe(true);
    expect(result.firebaseSignInDisabled).toBe(true);
    expect(result.alreadySuspended).toBe(false);
    expect(result.outcome).toBe('account_suspended');
    expect(result.account.state).toBe('Suspended');
    expect(applySuspensionCascade).toHaveBeenCalledWith(part.id);
    expect(result.effects).toEqual(cascadeEffects);
    expect(moderationRepository.insertActionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        safe_state_summary: expect.objectContaining({
          effects: cascadeEffects,
          credentialsIncluded: false,
        }),
      })
    );
  });

  it('rejects self-suspension', async () => {
    await expect(
      suspendAccount({
        actorParticipantId: part.id,
        actorRole: 'ADMIN',
        accountId: part.id,
        reason: 'Nope',
      })
    ).rejects.toMatchObject({ code: 'SELF_SUSPEND_FORBIDDEN', status: 400 });
  });

  it('rejects PART actors', async () => {
    await expect(
      suspendAccount({
        actorParticipantId: adminId,
        actorRole: 'PART',
        accountId: part.id,
        reason: 'Nope',
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE', status: 403 });
  });

  it('returns FIREBASE_REVOKE_FAILED when token revocation fails after DB update', async () => {
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(part);
    vi.spyOn(participantsRepository, 'updateParticipant').mockResolvedValue({
      ...part,
      is_suspended: true,
      suspended_at: '2026-10-21T12:00:00.000Z',
      suspended_by: adminId,
      suspension_reason: 'Spam',
    });
    vi.mocked(firebaseAuth.revokeRefreshTokens).mockRejectedValue(new Error('firebase down'));

    await expect(
      suspendAccount({
        actorParticipantId: adminId,
        actorRole: 'ADMIN',
        accountId: part.id,
        reason: 'Spam',
      })
    ).rejects.toMatchObject({ code: 'FIREBASE_REVOKE_FAILED', status: 502 });
  });

  it('idempotently re-revokes when account is already suspended (boundary)', async () => {
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue({
      ...part,
      is_suspended: true,
      suspended_at: '2026-10-20T00:00:00.000Z',
      suspension_reason: 'Old reason',
    });
    vi.spyOn(participantsRepository, 'updateParticipant').mockResolvedValue({
      ...part,
      is_suspended: true,
      suspended_at: '2026-10-20T00:00:00.000Z',
      suspended_by: adminId,
      suspension_reason: 'Updated reason',
    });
    vi.spyOn(moderationRepository, 'insertActionRecord').mockResolvedValue({
      id: 'rec-2',
      actor_id: adminId,
      target_type: 'account',
      target_id: part.id,
      action_type: 'account_suspend',
      reason: 'Updated reason',
      outcome: 'account_already_suspended',
      safe_state_summary: {},
      created_at: '2026-10-21T12:00:00.000Z',
    });
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue(null);
    vi.spyOn(accountsRepository, 'listRelevantListings').mockResolvedValue([]);
    vi.spyOn(accountsRepository, 'findById').mockResolvedValue({
      ...part,
      is_suspended: true,
      suspended_at: '2026-10-20T00:00:00.000Z',
      suspension_reason: 'Updated reason',
    });

    const result = await suspendAccount({
      actorParticipantId: adminId,
      actorRole: 'ADMIN',
      accountId: part.id,
      reason: 'Updated reason',
    });

    expect(result.alreadySuspended).toBe(true);
    expect(result.outcome).toBe('account_already_suspended');
    expect(firebaseAuth.revokeRefreshTokens).toHaveBeenCalled();
  });
});

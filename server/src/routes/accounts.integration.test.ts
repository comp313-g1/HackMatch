/**
 * US-027 / #256 — Suspension and deletion rules integration suite
 *
 * Exercises the full Express pipeline (Firebase → MFA → active → ADMIN)
 * for account list/detail, suspend cascade, ownership-verified deletion,
 * and suspended-session denial.
 *
 * Maps to acceptance tests:
 *   US-027-T1 ADMIN suspends with reason → sessions revoked, sign-in blocked, profile hidden
 *   US-027-T2 Suspended user session / renew → Access denied (ACCOUNT_SUSPENDED)
 *   US-027-T3 Suspend unlocked team owner → recruitment paused, invites canceled, memberships kept
 *   US-027-T4 Ownership-verified deletion → request recorded + live PII workflow + 30-day target
 *   US-027-T5 Delete unlocked owner without disband → 409 UNLOCKED_OWNER_MUST_DISBAND
 *   US-027-T6 PART / Visitor denied on every account-management endpoint
 *
 * Also covers invalid input, reason-length boundary, self-suspend, Firebase revoke failure,
 * and draft-preserving validation errors with repeatable evidence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { accountsRepository } from '../db/accounts.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { accountDeletionRepository } from '../db/accountDeletion.repository.js';
import { getSupabaseClient } from '../db/client.js';
import { applySuspensionCascade } from '../services/accountSuspensionCascade.js';
import { pseudonymizeHistoricalMemberships } from '../services/membershipPseudonymization.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import { ACCOUNT_ENFORCEMENT_REASON_MAX } from '../validators/accounts.validator.js';
import type { Participant } from '../db/types.js';

const mockVerifyIdToken = vi.fn();
const mockRevokeRefreshTokens = vi.fn();
const mockUpdateUser = vi.fn();
const mockDeleteUser = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    getUser: vi.fn(),
    setCustomUserClaims: vi.fn(),
    revokeRefreshTokens: (...args: unknown[]) => mockRevokeRefreshTokens(...args),
    updateUser: (...args: unknown[]) => mockUpdateUser(...args),
    deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
  };
  return {
    firebaseAuth: authMock,
    auth: authMock,
    getFirebaseAdminAuth: vi.fn(),
    verifyEmailActionCode: vi.fn(),
    sendVerificationEmail: vi.fn(),
    _resetFirebaseInstances: vi.fn(),
  };
});

vi.mock('../db/client.js', () => ({
  getSupabaseClient: vi.fn(),
}));

vi.mock('../services/accountSuspensionCascade.js', () => ({
  applySuspensionCascade: vi.fn(),
}));

vi.mock('../services/membershipPseudonymization.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/membershipPseudonymization.js')>();
  return {
    ...actual,
    pseudonymizeHistoricalMemberships: vi.fn(),
  };
});

const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;
const AUTH = 'Bearer valid-mfa-token';
const ACCOUNT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEAM_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const adminParticipant: Participant = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  firebase_uid: 'fb-admin-1',
  email: 'admin@example.com',
  full_name: 'Platform Admin',
  role: 'ADMIN',
  is_verified: true,
  is_suspended: false,
  created_at: '2026-10-18T00:00:00.000Z',
  updated_at: '2026-10-18T00:00:00.000Z',
};

const partParticipant: Participant = {
  id: ACCOUNT_ID,
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

const accountEndpoints = [
  { method: 'get' as const, path: '/api/admin/accounts', label: 'list' },
  {
    method: 'get' as const,
    path: `/api/admin/accounts/${ACCOUNT_ID}`,
    label: 'detail',
  },
  {
    method: 'post' as const,
    path: `/api/admin/accounts/${ACCOUNT_ID}/suspend`,
    label: 'suspend',
    body: { reason: 'Nope' },
  },
  {
    method: 'post' as const,
    path: `/api/admin/accounts/${ACCOUNT_ID}/delete`,
    label: 'delete',
    body: { reason: 'Nope', ownershipVerified: true },
  },
];

function adminToken(): DecodedIdToken {
  return {
    uid: 'fb-admin-1',
    email: 'admin@example.com',
    role: 'ADMIN',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;
}

function partToken(): DecodedIdToken {
  return {
    uid: 'fb-part-1',
    email: 'part@example.com',
    role: 'PART',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;
}

function mockEmptyUnlockedTeams(): void {
  const finalIs = vi.fn(async () => ({ data: [], error: null }));
  const firstIs = vi.fn(() => ({ is: finalIs }));
  const eq = vi.fn(() => ({ is: firstIs }));
  const select = vi.fn(() => ({ eq }));
  vi.mocked(getSupabaseClient).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'teams') return { select };
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
              data: [{ participant_id: ACCOUNT_ID }],
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
    }),
  } as never);
}

function mockUnlockedOwnedTeam(name = 'Rocket'): void {
  const finalIs = vi.fn(async () => ({
    data: [{ id: TEAM_ID, name }],
    error: null,
  }));
  const firstIs = vi.fn(() => ({ is: finalIs }));
  const eq = vi.fn(() => ({ is: firstIs }));
  const select = vi.fn(() => ({ eq }));
  vi.mocked(getSupabaseClient).mockReturnValue({
    from: vi.fn((table: string) => (table === 'teams' ? { select } : {})),
  } as never);
}

function stubSuspendedDetail(reason: string): void {
  const suspendedAt = '2026-10-21T12:00:00.000Z';
  vi.spyOn(accountsRepository, 'findById').mockResolvedValue({
    ...partParticipant,
    is_suspended: true,
    suspended_at: suspendedAt,
    suspension_reason: reason,
  });
  vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue(null);
  vi.spyOn(accountsRepository, 'listRelevantListings').mockResolvedValue([]);
}

describe('Account suspension and deletion rules integration (US-027 / #256)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(adminToken());
    mockRevokeRefreshTokens.mockResolvedValue(undefined);
    mockUpdateUser.mockResolvedValue({});
    mockDeleteUser.mockResolvedValue(undefined);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(adminParticipant);
    vi.spyOn(participantsRepository, 'findById').mockImplementation(async (id) => {
      if (id === adminParticipant.id) return adminParticipant;
      if (id === partParticipant.id) return { ...partParticipant };
      return null;
    });
    vi.mocked(applySuspensionCascade).mockResolvedValue({
      pendingIncomingRequestsCanceled: 0,
      outgoingInvitationsCanceled: 0,
      profileHidden: true,
      availabilityCleared: true,
      ownedTeamsPaused: 0,
      membershipsPreserved: true,
    });
    vi.mocked(pseudonymizeHistoricalMemberships).mockResolvedValue({
      lockedMembershipsPseudonymized: 1,
      unlockedMembershipsPseudonymized: 0,
      membershipIdsPreserved: ['11111111-1111-4111-8111-111111111111'],
      lockedTeamIdsPreserved: [TEAM_ID],
      membershipsDeleted: false,
    });
    mockEmptyUnlockedTeams();
  });

  describe('US-027-T6 unauthorized access (Visitor / PART)', () => {
    it.each(accountEndpoints)(
      'Visitor receives 401 UNAUTHORIZED on $label',
      async ({ method, path, body }) => {
        const req = request(app)[method](path);
        if (method === 'post' && body) req.send(body);
        const res = await req;
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('UNAUTHORIZED');
        expect(res.headers['cache-control']).toMatch(/no-store/i);
      }
    );

    it.each(accountEndpoints)(
      'PART receives 403 FORBIDDEN_ROLE on $label',
      async ({ method, path, body }) => {
        mockVerifyIdToken.mockResolvedValue(partToken());
        vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(partParticipant);

        const req = request(app)[method](path).set('Authorization', AUTH);
        if (method === 'post' && body) req.send(body);
        const res = await req;

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN_ROLE');
        expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
        expect(mockDeleteUser).not.toHaveBeenCalled();
      }
    );

    it('rejects forged ADMIN claim when DB role is PART (ROLE_MISMATCH)', async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: 'fb-part-1',
        email: 'part@example.com',
        role: 'ADMIN',
        auth_time: AUTH_TIME,
        [MFA_CLAIM]: AUTH_TIME,
      } as unknown as DecodedIdToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(partParticipant);

      const res = await request(app)
        .post(`/api/admin/accounts/${ACCOUNT_ID}/suspend`)
        .set('Authorization', AUTH)
        .send({ reason: 'Forged role' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ROLE_MISMATCH');
      expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
    });
  });

  describe('US-027-T1 suspend happy path', () => {
    it('revokes sessions, blocks sign-in, hides profile, and records the action', async () => {
      const suspendedAt = '2026-10-21T12:00:00.000Z';
      vi.spyOn(participantsRepository, 'updateParticipant').mockResolvedValue({
        ...partParticipant,
        is_suspended: true,
        suspended_at: suspendedAt,
        suspended_by: adminParticipant.id,
        suspension_reason: 'Harassment',
      });
      vi.spyOn(moderationRepository, 'insertActionRecord').mockResolvedValue({
        id: 'rec-suspend-1',
        actor_id: adminParticipant.id,
        target_type: 'account',
        target_id: ACCOUNT_ID,
        action_type: 'account_suspend',
        reason: 'Harassment',
        outcome: 'account_suspended',
        safe_state_summary: {},
        created_at: suspendedAt,
      });
      stubSuspendedDetail('Harassment');

      const res = await request(app)
        .post(`/api/admin/accounts/${ACCOUNT_ID}/suspend`)
        .set('Authorization', AUTH)
        .send({ reason: 'Harassment' });

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('account_suspended');
      expect(res.body.sessionsRevoked).toBe(true);
      expect(res.body.firebaseSignInDisabled).toBe(true);
      expect(res.body.account.state).toBe('Suspended');
      expect(res.body.effects.profileHidden).toBe(true);
      expect(res.body.effects.membershipsPreserved).toBe(true);
      expect(res.body.privacy.credentialsIncluded).toBe(false);
      expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('fb-part-1');
      expect(mockUpdateUser).toHaveBeenCalledWith('fb-part-1', { disabled: true });
      expect(applySuspensionCascade).toHaveBeenCalledWith(ACCOUNT_ID);
      expect(moderationRepository.insertActionRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: 'account_suspend',
          reason: 'Harassment',
          outcome: 'account_suspended',
        })
      );
    });
  });

  describe('US-027-T2 suspended session denied', () => {
    it('denies account-status and protected access for a suspended participant', async () => {
      mockVerifyIdToken.mockResolvedValue(partToken());
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        ...partParticipant,
        is_suspended: true,
        suspended_at: '2026-10-21T12:00:00.000Z',
        suspension_reason: 'Harassment',
      });

      const statusRes = await request(app)
        .get('/api/auth/account-status')
        .set('Authorization', AUTH);
      expect(statusRes.status).toBe(403);
      expect(statusRes.body.code).toBe('ACCOUNT_SUSPENDED');

      const accessRes = await request(app)
        .get('/api/access/participant')
        .set('Authorization', AUTH);
      expect(accessRes.status).toBe(403);
      expect(accessRes.body.code).toBe('ACCOUNT_SUSPENDED');

      const sessionRes = await request(app)
        .post('/api/auth/session')
        .set('Authorization', AUTH);
      expect(sessionRes.status).toBe(403);
      expect(sessionRes.body.code).toBe('ACCOUNT_SUSPENDED');
    });
  });

  describe('US-027-T3 suspend unlocked team owner cascade', () => {
    it('pauses owned recruitment and cancels outgoing invites without deleting memberships', async () => {
      vi.mocked(applySuspensionCascade).mockResolvedValue({
        pendingIncomingRequestsCanceled: 1,
        outgoingInvitationsCanceled: 2,
        profileHidden: true,
        availabilityCleared: true,
        ownedTeamsPaused: 1,
        membershipsPreserved: true,
      });
      vi.spyOn(participantsRepository, 'updateParticipant').mockResolvedValue({
        ...partParticipant,
        is_suspended: true,
        suspended_at: '2026-10-21T12:00:00.000Z',
        suspended_by: adminParticipant.id,
        suspension_reason: 'Owns abusive Open team',
      });
      vi.spyOn(moderationRepository, 'insertActionRecord').mockResolvedValue({
        id: 'rec-cascade',
        actor_id: adminParticipant.id,
        target_type: 'account',
        target_id: ACCOUNT_ID,
        action_type: 'account_suspend',
        reason: 'Owns abusive Open team',
        outcome: 'account_suspended',
        safe_state_summary: {},
        created_at: '2026-10-21T12:00:00.000Z',
      });
      stubSuspendedDetail('Owns abusive Open team');
      vi.spyOn(accountsRepository, 'listRelevantListings').mockResolvedValue([
        {
          teamId: TEAM_ID,
          teamName: 'Rocket',
          recruitmentStatus: 'Paused',
          lockedAt: null,
          membershipRole: 'Owner',
          isOwner: true,
        },
      ]);

      const res = await request(app)
        .post(`/api/admin/accounts/${ACCOUNT_ID}/suspend`)
        .set('Authorization', AUTH)
        .send({ reason: 'Owns abusive Open team' });

      expect(res.status).toBe(200);
      expect(res.body.effects).toEqual({
        pendingIncomingRequestsCanceled: 1,
        outgoingInvitationsCanceled: 2,
        profileHidden: true,
        availabilityCleared: true,
        ownedTeamsPaused: 1,
        membershipsPreserved: true,
      });
      expect(applySuspensionCascade).toHaveBeenCalledWith(ACCOUNT_ID);
    });
  });

  describe('US-027-T4 ownership-verified deletion happy path', () => {
    it('records the request, erases live PII, and exposes the 30-day target', async () => {
      vi.spyOn(accountDeletionRepository, 'findOpenByParticipantId').mockResolvedValue(null);
      const pending = {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        participant_id: ACCOUNT_ID,
        requested_by: adminParticipant.id,
        reason: 'Verified owner requested deletion',
        status: 'Pending' as const,
        ownership_verified: true,
        ownership_verified_at: '2026-10-21T12:00:00.000Z',
        ownership_verified_by: adminParticipant.id,
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
        actor_id: adminParticipant.id,
        target_type: 'account',
        target_id: ACCOUNT_ID,
        action_type: 'account_delete',
        reason: pending.reason,
        outcome: 'deletion_completed',
        safe_state_summary: {},
        created_at: '2026-10-21T12:05:00.000Z',
      });
      vi.spyOn(accountsRepository, 'findById').mockResolvedValue({
        ...partParticipant,
        email: 'deleted+bbbbbbbbbbbb@deleted.invalid',
        full_name: 'Deleted User',
        is_deactivated: true,
        is_suspended: true,
        deactivated_at: '2026-10-21T12:05:00.000Z',
        deactivation_reason: 'Ownership-verified deletion completed',
      });
      vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue(null);
      vi.spyOn(accountsRepository, 'listRelevantListings').mockResolvedValue([]);

      const res = await request(app)
        .post(`/api/admin/accounts/${ACCOUNT_ID}/delete`)
        .set('Authorization', AUTH)
        .send({
          reason: 'Verified owner requested deletion',
          ownershipVerified: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('deletion_completed');
      expect(res.body.livePiiErased).toBe(true);
      expect(res.body.firebaseUserDeleted).toBe(true);
      expect(res.body.sessionsRevoked).toBe(true);
      expect(res.body.lockedMembershipsPseudonymized).toBe(true);
      expect(res.body.request.targetCompletionAt).toBe('2026-11-20T12:00:00.000Z');
      expect(res.body.request.targetNotice).toMatch(/30-day/);
      expect(res.body.account.state).toBe('Deactivated');
      expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('fb-part-1');
      expect(mockDeleteUser).toHaveBeenCalledWith('fb-part-1');
      expect(accountDeletionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownership_verified: true,
          participant_id: ACCOUNT_ID,
        })
      );
      expect(pseudonymizeHistoricalMemberships).toHaveBeenCalledWith(ACCOUNT_ID);
    });
  });

  describe('US-027-T5 unlocked owner must disband', () => {
    it('returns 409 UNLOCKED_OWNER_MUST_DISBAND and does not erase PII', async () => {
      mockUnlockedOwnedTeam('Rocket');
      vi.spyOn(accountDeletionRepository, 'findOpenByParticipantId').mockResolvedValue(null);
      vi.spyOn(accountDeletionRepository, 'create').mockResolvedValue({
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        participant_id: ACCOUNT_ID,
        requested_by: adminParticipant.id,
        reason: 'Verified owner requested deletion',
        status: 'BlockedNeedsDisband',
        ownership_verified: true,
        ownership_verified_at: '2026-10-21T12:00:00.000Z',
        ownership_verified_by: adminParticipant.id,
        blocked_reason: 'Owner must disband 1 unlocked team(s)',
        target_completion_at: '2026-11-20T12:00:00.000Z',
        completed_at: null,
        safe_state_summary: {},
        created_at: '2026-10-21T12:00:00.000Z',
        updated_at: '2026-10-21T12:00:00.000Z',
      });
      vi.spyOn(moderationRepository, 'insertActionRecord').mockResolvedValue({
        id: 'rec-block',
        actor_id: adminParticipant.id,
        target_type: 'account',
        target_id: ACCOUNT_ID,
        action_type: 'account_delete',
        reason: 'Verified owner requested deletion',
        outcome: 'deletion_blocked_needs_disband',
        safe_state_summary: {},
        created_at: '2026-10-21T12:00:00.000Z',
      });
      stubSuspendedDetail('n/a');
      vi.spyOn(accountsRepository, 'findById').mockResolvedValue(partParticipant);

      const res = await request(app)
        .post(`/api/admin/accounts/${ACCOUNT_ID}/delete`)
        .set('Authorization', AUTH)
        .send({
          reason: 'Verified owner requested deletion',
          ownershipVerified: true,
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('UNLOCKED_OWNER_MUST_DISBAND');
      expect(res.body.details.outcome).toBe('deletion_blocked_needs_disband');
      expect(res.body.details.unlockedOwnedTeamIds).toEqual([TEAM_ID]);
      expect(mockDeleteUser).not.toHaveBeenCalled();
      expect(pseudonymizeHistoricalMemberships).not.toHaveBeenCalled();
    });
  });

  describe('invalid input, boundaries, and failure handling', () => {
    it('rejects blank suspend reason and echoes submitted draft (NR-017)', async () => {
      const body = { reason: '   ' };
      const res = await request(app)
        .post(`/api/admin/accounts/${ACCOUNT_ID}/suspend`)
        .set('Authorization', AUTH)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.reason).toMatch(/required/i);
      expect(res.body.submitted).toEqual(body);
      expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
    });

    it('rejects suspend reason exceeding max length (boundary)', async () => {
      const body = { reason: 'x'.repeat(ACCOUNT_ENFORCEMENT_REASON_MAX + 1) };
      const res = await request(app)
        .post(`/api/admin/accounts/${ACCOUNT_ID}/suspend`)
        .set('Authorization', AUTH)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.reason).toMatch(/at most/i);
      expect(res.body.submitted.reason).toHaveLength(ACCOUNT_ENFORCEMENT_REASON_MAX + 1);
    });

    it('rejects self-suspension', async () => {
      const res = await request(app)
        .post(`/api/admin/accounts/${adminParticipant.id}/suspend`)
        .set('Authorization', AUTH)
        .send({ reason: 'Self' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SELF_SUSPEND_FORBIDDEN');
      expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
    });

    it('returns 502 FIREBASE_REVOKE_FAILED when session revocation fails', async () => {
      vi.spyOn(participantsRepository, 'updateParticipant').mockResolvedValue({
        ...partParticipant,
        is_suspended: true,
        suspended_at: '2026-10-21T12:00:00.000Z',
        suspended_by: adminParticipant.id,
        suspension_reason: 'Spam',
      });
      mockRevokeRefreshTokens.mockRejectedValue(new Error('Firebase Admin unavailable'));

      const res = await request(app)
        .post(`/api/admin/accounts/${ACCOUNT_ID}/suspend`)
        .set('Authorization', AUTH)
        .send({ reason: 'Spam' });

      expect(res.status).toBe(502);
      expect(res.body.code).toBe('FIREBASE_REVOKE_FAILED');
      expect(res.body.details).toEqual(
        expect.objectContaining({
          accountId: ACCOUNT_ID,
          sessionsRevoked: false,
        })
      );
      // Credentials / OTPs must not appear in failure payloads.
      expect(JSON.stringify(res.body)).not.toMatch(/password|otpCode|otpHash/i);
    });

    it('rejects delete without ownershipVerified and echoes draft', async () => {
      const body = { reason: 'Owner asked', ownershipVerified: false };
      const res = await request(app)
        .post(`/api/admin/accounts/${ACCOUNT_ID}/delete`)
        .set('Authorization', AUTH)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.ownershipVerified).toMatch(/ownershipVerified must be true/i);
      expect(res.body.submitted).toEqual(body);
      expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it('returns 404 ACCOUNT_NOT_FOUND for unknown delete target', async () => {
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/admin/accounts/${ACCOUNT_ID}/delete`)
        .set('Authorization', AUTH)
        .send({ reason: 'Missing account', ownershipVerified: true });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ACCOUNT_NOT_FOUND');
    });

    it('rejects deleting an ADMIN target (boundary)', async () => {
      const otherAdmin: Participant = {
        ...adminParticipant,
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        firebase_uid: 'fb-admin-2',
        email: 'other-admin@example.com',
      };
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(otherAdmin);

      const res = await request(app)
        .post(`/api/admin/accounts/${otherAdmin.id}/delete`)
        .set('Authorization', AUTH)
        .send({ reason: 'Cannot delete admin', ownershipVerified: true });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_TARGET');
      expect(mockDeleteUser).not.toHaveBeenCalled();
    });
  });
});

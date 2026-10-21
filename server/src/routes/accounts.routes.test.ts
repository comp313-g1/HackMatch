import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { accountsRepository } from '../db/accounts.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { applySuspensionCascade } from '../services/accountSuspensionCascade.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { Participant } from '../db/types.js';

const mockVerifyIdToken = vi.fn();
const mockRevokeRefreshTokens = vi.fn();
const mockUpdateUser = vi.fn();
const mockDeleteUser = vi.fn();
const mockRequestAccountDeletion = vi.fn();

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

vi.mock('../services/accountSuspensionCascade.js', () => ({
  applySuspensionCascade: vi.fn().mockResolvedValue({
    pendingIncomingRequestsCanceled: 0,
    outgoingInvitationsCanceled: 0,
    profileHidden: true,
    availabilityCleared: false,
    ownedTeamsPaused: 0,
    membershipsPreserved: true,
  }),
}));

vi.mock('../services/accountDeletion.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/accountDeletion.js')>();
  return {
    ...actual,
    requestAccountDeletion: (...args: unknown[]) => mockRequestAccountDeletion(...args),
  };
});

const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;
const AUTH = 'Bearer valid-mfa-token';
const ACCOUNT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

describe('ADMIN account-management list, detail, and suspend (US-027 / #248 / #250)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue({
      uid: 'fb-admin-1',
      email: 'admin@example.com',
      role: 'ADMIN',
      auth_time: AUTH_TIME,
      [MFA_CLAIM]: AUTH_TIME,
    } as unknown as DecodedIdToken);
    mockRevokeRefreshTokens.mockResolvedValue(undefined);
    mockUpdateUser.mockResolvedValue({});
    mockDeleteUser.mockResolvedValue(undefined);
    mockRequestAccountDeletion.mockReset();
    vi.mocked(applySuspensionCascade).mockResolvedValue({
      pendingIncomingRequestsCanceled: 0,
      outgoingInvitationsCanceled: 0,
      profileHidden: true,
      availabilityCleared: false,
      ownedTeamsPaused: 0,
      membershipsPreserved: true,
    });
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(adminParticipant);
  });

  describe('authorization', () => {
    it('returns 401 without a token (Visitor)', async () => {
      const res = await request(app).get('/api/admin/accounts');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 FORBIDDEN_ROLE for PART callers (US-027-T6)', async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: 'fb-part-1',
        email: 'part@example.com',
        role: 'PART',
        auth_time: AUTH_TIME,
        [MFA_CLAIM]: AUTH_TIME,
      } as unknown as DecodedIdToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(partParticipant);

      const res = await request(app).get('/api/admin/accounts').set('Authorization', AUTH);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });
  });

  describe('GET /api/admin/accounts', () => {
    it('returns empty list with 200', async () => {
      vi.spyOn(accountsRepository, 'listForAdmin').mockResolvedValue([]);

      const res = await request(app).get('/api/admin/accounts').set('Authorization', AUTH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ accounts: [] });
    });

    it('returns accounts with identifier, role, and state (happy path)', async () => {
      vi.spyOn(accountsRepository, 'listForAdmin').mockResolvedValue([partParticipant]);
      vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
        participant_id: partParticipant.id,
        handle: 'ada',
        primary_role: 'Frontend',
        institution: null,
        shared_contact_handle: 'secret',
        created_at: partParticipant.created_at,
        updated_at: partParticipant.updated_at,
      });

      const res = await request(app).get('/api/admin/accounts').set('Authorization', AUTH);

      expect(res.status).toBe(200);
      expect(res.body.accounts).toHaveLength(1);
      expect(res.body.accounts[0]).toEqual(
        expect.objectContaining({
          accountId: ACCOUNT_ID,
          email: 'part@example.com',
          fullName: 'Ada Lovelace',
          role: 'PART',
          state: 'Active',
          handle: 'ada',
        })
      );
      expect(JSON.stringify(res.body)).not.toMatch(/fb-part-1|secret|firebase_uid|otp/i);
    });

    it('rejects invalid state query and echoes submitted values', async () => {
      const res = await request(app)
        .get('/api/admin/accounts?state=Nope')
        .set('Authorization', AUTH);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.state).toBeTruthy();
      expect(res.body.submitted.state).toBe('Nope');
    });
  });

  describe('GET /api/admin/accounts/:accountId', () => {
    it('rejects invalid accountId with 400 and preserves submitted value', async () => {
      const res = await request(app)
        .get('/api/admin/accounts/not-a-uuid')
        .set('Authorization', AUTH);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.submitted.accountId).toBe('not-a-uuid');
    });

    it('returns 404 ACCOUNT_NOT_FOUND when missing', async () => {
      vi.spyOn(accountsRepository, 'findById').mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/admin/accounts/${ACCOUNT_ID}`)
        .set('Authorization', AUTH);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ACCOUNT_NOT_FOUND');
    });

    it('returns sanitized detail with relevant listings and privacy flags', async () => {
      vi.spyOn(accountsRepository, 'findById').mockResolvedValue(partParticipant);
      vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
        participant_id: partParticipant.id,
        handle: 'ada',
        primary_role: 'Backend',
        institution: 'UofT',
        shared_contact_handle: 'secret-discord#1',
        moderation_status: 'None',
        created_at: partParticipant.created_at,
        updated_at: partParticipant.updated_at,
      });
      vi.spyOn(accountsRepository, 'listRelevantListings').mockResolvedValue([
        {
          team_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          team_name: 'Phishy Team',
          recruitment_status: 'Open',
          locked_at: null,
          membership_role: 'Owner',
          is_owner: true,
        },
      ]);

      const res = await request(app)
        .get(`/api/admin/accounts/${ACCOUNT_ID}`)
        .set('Authorization', AUTH);

      expect(res.status).toBe(200);
      expect(res.body.account.accountId).toBe(ACCOUNT_ID);
      expect(res.body.relevantListings[0].teamName).toBe('Phishy Team');
      expect(res.body.privacy.credentialsIncluded).toBe(false);
      expect(res.body.privacy.otpsIncluded).toBe(false);
      expect(res.body.privacy.privateTeamNotesIncluded).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/secret-discord|fb-part-1|otp_hash/i);
    });
  });

  describe('POST /api/admin/accounts/:accountId/suspend (US-027 / #250)', () => {
    it('rejects missing reason and echoes submitted draft', async () => {
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

    it('returns 403 for PART callers', async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: 'fb-part-1',
        email: 'part@example.com',
        role: 'PART',
        auth_time: AUTH_TIME,
        [MFA_CLAIM]: AUTH_TIME,
      } as unknown as DecodedIdToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(partParticipant);

      const res = await request(app)
        .post(`/api/admin/accounts/${ACCOUNT_ID}/suspend`)
        .set('Authorization', AUTH)
        .send({ reason: 'Should not work' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('suspends account, revokes sessions, and disables Firebase sign-in (happy path)', async () => {
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(partParticipant);
      vi.spyOn(participantsRepository, 'updateParticipant').mockResolvedValue({
        ...partParticipant,
        is_suspended: true,
        suspended_at: '2026-10-21T12:00:00.000Z',
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
        created_at: '2026-10-21T12:00:00.000Z',
      });
      vi.spyOn(accountsRepository, 'findById').mockResolvedValue({
        ...partParticipant,
        is_suspended: true,
        suspended_at: '2026-10-21T12:00:00.000Z',
        suspension_reason: 'Harassment',
      });
      vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue(null);
      vi.spyOn(accountsRepository, 'listRelevantListings').mockResolvedValue([]);

      const res = await request(app)
        .post(`/api/admin/accounts/${ACCOUNT_ID}/suspend`)
        .set('Authorization', AUTH)
        .send({ reason: 'Harassment' });

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('account_suspended');
      expect(res.body.sessionsRevoked).toBe(true);
      expect(res.body.firebaseSignInDisabled).toBe(true);
      expect(res.body.account.state).toBe('Suspended');
      expect(res.body.effects).toEqual(
        expect.objectContaining({
          profileHidden: true,
          membershipsPreserved: true,
        })
      );
      expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('fb-part-1');
      expect(mockUpdateUser).toHaveBeenCalledWith('fb-part-1', { disabled: true });
    });

    it('returns 404 when target account is missing', async () => {
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/admin/accounts/${ACCOUNT_ID}/suspend`)
        .set('Authorization', AUTH)
        .send({ reason: 'Missing' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ACCOUNT_NOT_FOUND');
    });
  });

  describe('POST /api/admin/accounts/:accountId/delete (US-027 / #252)', () => {
    it('rejects missing ownershipVerified and echoes submitted draft', async () => {
      const body = { reason: 'Owner asked', ownershipVerified: false };
      const res = await request(app)
        .post(`/api/admin/accounts/${ACCOUNT_ID}/delete`)
        .set('Authorization', AUTH)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.ownershipVerified).toMatch(/ownershipVerified must be true/i);
      expect(res.body.submitted).toEqual(body);
      expect(mockRequestAccountDeletion).not.toHaveBeenCalled();
    });

    it('completes ownership-verified deletion workflow (happy path)', async () => {
      mockRequestAccountDeletion.mockResolvedValue({
        outcome: 'deletion_completed',
        request: {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          participantId: ACCOUNT_ID,
          status: 'Completed',
          ownershipVerified: true,
          ownershipVerifiedAt: '2026-10-21T12:00:00.000Z',
          blockedReason: null,
          targetCompletionAt: '2026-11-20T12:00:00.000Z',
          completedAt: '2026-10-21T12:05:00.000Z',
          reason: 'Verified owner requested deletion',
          createdAt: '2026-10-21T12:00:00.000Z',
          targetNotice: 'Proposed 30-day live-PII processing target',
        },
        account: {
          accountId: ACCOUNT_ID,
          email: 'deleted+bbbb@deleted.invalid',
          fullName: 'Deleted User',
          role: 'PART',
          state: 'Deactivated',
          isVerified: false,
          suspendedAt: '2026-10-21T12:05:00.000Z',
          suspensionReason: 'Account deletion processed',
          deactivatedAt: '2026-10-21T12:05:00.000Z',
          deactivationReason: 'Ownership-verified deletion completed',
          createdAt: partParticipant.created_at,
          handle: null,
          updatedAt: '2026-10-21T12:05:00.000Z',
        },
        livePiiErased: true,
        firebaseUserDeleted: true,
        sessionsRevoked: true,
        lockedMembershipsPseudonymized: true,
        lockedMembershipsPseudonymizedCount: 1,
        membershipIdsPreserved: ['11111111-1111-4111-8111-111111111111'],
        unlockedOwnedTeamIds: [],
        actionRecordId: 'rec-del-1',
      });

      const res = await request(app)
        .post(`/api/admin/accounts/${ACCOUNT_ID}/delete`)
        .set('Authorization', AUTH)
        .send({ reason: 'Verified owner requested deletion', ownershipVerified: true });

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('deletion_completed');
      expect(res.body.livePiiErased).toBe(true);
      expect(res.body.request.targetCompletionAt).toBe('2026-11-20T12:00:00.000Z');
      expect(mockRequestAccountDeletion).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: ACCOUNT_ID,
          reason: 'Verified owner requested deletion',
          ownershipVerified: true,
          actorRole: 'ADMIN',
        })
      );
    });

    it('returns 409 when unlocked owner must disband first', async () => {
      const { AccountManagementError } = await import('../services/accountManagement.js');
      mockRequestAccountDeletion.mockRejectedValue(
        new AccountManagementError(
          409,
          'UNLOCKED_OWNER_MUST_DISBAND',
          'Owner must disband 1 unlocked team(s) before deletion can proceed: Rocket.',
          {
            outcome: 'deletion_blocked_needs_disband',
            unlockedOwnedTeamIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
          }
        )
      );

      const res = await request(app)
        .post(`/api/admin/accounts/${ACCOUNT_ID}/delete`)
        .set('Authorization', AUTH)
        .send({ reason: 'Verified owner requested deletion', ownershipVerified: true });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('UNLOCKED_OWNER_MUST_DISBAND');
      expect(res.body.details.outcome).toBe('deletion_blocked_needs_disband');
    });
  });
});

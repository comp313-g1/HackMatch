import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { accountsRepository } from '../db/accounts.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { Participant } from '../db/types.js';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    getUser: vi.fn(),
    setCustomUserClaims: vi.fn(),
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

describe('ADMIN account-management list and detail (US-027 / #248)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue({
      uid: 'fb-admin-1',
      email: 'admin@example.com',
      role: 'ADMIN',
      auth_time: AUTH_TIME,
      [MFA_CLAIM]: AUTH_TIME,
    } as unknown as DecodedIdToken);
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
});

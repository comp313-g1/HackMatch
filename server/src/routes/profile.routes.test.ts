import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { Participant, ParticipantProfile } from '../db/types.js';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
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

describe('Express Profile Read & Update Endpoints (US-006 / #64)', () => {
  const ownerParticipant: Participant = {
    id: 'part-owner-1',
    firebase_uid: 'fb-owner-1',
    email: 'owner@example.com',
    full_name: 'Owner Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-17T00:00:00.000Z',
    updated_at: '2026-10-17T00:00:00.000Z',
  };

  const otherParticipant: Participant = {
    id: 'part-other-2',
    firebase_uid: 'fb-other-2',
    email: 'other@example.com',
    full_name: 'Other Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-17T00:00:00.000Z',
    updated_at: '2026-10-17T00:00:00.000Z',
  };

  const validDecodedToken = {
    uid: 'fb-owner-1',
    email: 'owner@example.com',
    role: 'PART',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;

  const sampleProfileRecord: ParticipantProfile = {
    participant_id: 'part-owner-1',
    handle: 'owner_handle',
    primary_role: 'Frontend',
    institution: 'Centennial College',
    shared_contact_handle: 'owner#1234',
    created_at: '2026-10-17T00:00:00.000Z',
    updated_at: '2026-10-17T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockReset();
  });

  describe('GET /api/profiles/me', () => {
    it('rejects unauthenticated requests with 401 UNAUTHORIZED', async () => {
      const res = await request(app).get('/api/profiles/me');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('rejects requests without completed MFA claim with 403 MFA_REQUIRED', async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: 'fb-owner-1',
        role: 'PART',
        auth_time: AUTH_TIME,
      } as unknown as DecodedIdToken);

      const res = await request(app)
        .get('/api/profiles/me')
        .set('Authorization', 'Bearer token-no-mfa');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
    });

    it('returns the authenticated PART user profile with self-declared labels and audience notice', async () => {
      mockVerifyIdToken.mockResolvedValue(validDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      vi.spyOn(profileRepository, 'getFullProfile').mockResolvedValue({
        profile: sampleProfileRecord,
        skills: [
          {
            id: 's1',
            participant_id: ownerParticipant.id,
            skill_name: 'React',
            created_at: '2026-10-17T00:00:00.000Z',
          },
        ],
        portfolios: [
          {
            id: 'p1',
            participant_id: ownerParticipant.id,
            url: 'https://github.com/owner',
            label: 'GitHub',
            created_at: '2026-10-17T00:00:00.000Z',
            updated_at: '2026-10-17T00:00:00.000Z',
          },
        ],
      });

      const res = await request(app)
        .get('/api/profiles/me')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.profile).toMatchObject({
        participantId: 'part-owner-1',
        displayName: 'Owner Participant',
        handle: 'owner_handle',
        primaryRole: 'Frontend',
        institution: 'Centennial College',
        skills: ['React'],
        skillsSelfDeclared: true,
        portfolioLinks: [
          {
            url: 'https://github.com/owner',
            label: 'GitHub',
            isSelfDeclared: true,
          },
        ],
        sharedContactHandle: 'owner#1234',
      });
      expect(res.body.profile.sharedContactAudienceNotice).toContain('confirmed teammates');
      expect(res.body.profile.email).toBeUndefined();
    });
  });

  describe('PUT /api/profiles/me and PUT /api/profiles/:participantId', () => {
    it('persists valid profile edits for the owner and returns updated profile (US-006 AC 1, AC 5)', async () => {
      mockVerifyIdToken.mockResolvedValue(validDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      vi.spyOn(profileRepository, 'findByHandle').mockResolvedValue(null);
      const upsertSpy = vi.spyOn(profileRepository, 'upsertFullProfile').mockResolvedValue({
        profile: {
          ...sampleProfileRecord,
          handle: 'new_handle',
          primary_role: 'AI/ML',
          institution: 'University of Toronto',
          shared_contact_handle: '@new_contact',
        },
        skills: [
          {
            id: 's1',
            participant_id: ownerParticipant.id,
            skill_name: 'Python',
            created_at: '2026-10-17T00:00:00.000Z',
          },
          {
            id: 's2',
            participant_id: ownerParticipant.id,
            skill_name: 'PyTorch',
            created_at: '2026-10-17T00:00:00.000Z',
          },
        ],
        portfolios: [
          {
            id: 'p1',
            participant_id: ownerParticipant.id,
            url: 'https://portfolio.example.com/owner',
            label: 'Portfolio',
            created_at: '2026-10-17T00:00:00.000Z',
            updated_at: '2026-10-17T00:00:00.000Z',
          },
        ],
      });

      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer valid-token')
        .send({
          handle: 'new_handle',
          primaryRole: 'AI/ML',
          institution: 'University of Toronto',
          skills: ['Python', 'PyTorch'],
          portfolioLinks: [{ url: 'https://portfolio.example.com/owner', label: 'Portfolio' }],
          sharedContactHandle: '@new_contact',
        });

      expect(res.status).toBe(200);
      expect(upsertSpy).toHaveBeenCalledOnce();
      expect(res.body.profile.primaryRole).toBe('AI/ML');
      expect(res.body.profile.skills).toEqual(['Python', 'PyTorch']);
      expect(res.body.profile.portfolioLinks[0]).toEqual({
        url: 'https://portfolio.example.com/owner',
        label: 'Portfolio',
        isSelfDeclared: true,
      });
    });

    it('denies cross-account profile edit attempts with 403 FORBIDDEN_PROFILE_EDIT without mutating data (US-006 AC 1 / T6 / FR-082)', async () => {
      mockVerifyIdToken.mockResolvedValue(validDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      const upsertSpy = vi.spyOn(profileRepository, 'upsertFullProfile');

      const res = await request(app)
        .put(`/api/profiles/${otherParticipant.id}`)
        .set('Authorization', 'Bearer valid-token')
        .send({
          handle: 'hijacked_handle',
          primaryRole: 'Backend',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_PROFILE_EDIT');
      expect(upsertSpy).not.toHaveBeenCalled();
    });

    it('returns 400 with field-specific errors on invalid input and preserves existing stored data (US-006 AC 2, AC 5)', async () => {
      mockVerifyIdToken.mockResolvedValue(validDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      const upsertSpy = vi.spyOn(profileRepository, 'upsertFullProfile');

      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer valid-token')
        .send({
          handle: 'bad handle with spaces!',
          primaryRole: 'InvalidRole',
          portfolioLinks: [{ url: 'http://insecure.example.com' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors).toMatchObject({
        handle: expect.any(String),
        primaryRole: expect.any(String),
        portfolioLinks: expect.any(String),
      });
      expect(upsertSpy).not.toHaveBeenCalled();
    });

    it('returns 409 HANDLE_ALREADY_IN_USE when another participant owns the requested handle', async () => {
      mockVerifyIdToken.mockResolvedValue(validDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      vi.spyOn(profileRepository, 'findByHandle').mockResolvedValue({
        ...sampleProfileRecord,
        participant_id: otherParticipant.id,
        handle: 'taken_handle',
      });
      const upsertSpy = vi.spyOn(profileRepository, 'upsertFullProfile');

      const res = await request(app)
        .put('/api/profiles/me')
        .set('Authorization', 'Bearer valid-token')
        .send({
          handle: 'taken_handle',
          primaryRole: 'Backend',
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('HANDLE_ALREADY_IN_USE');
      expect(res.body.errors.handle).toBeDefined();
      expect(upsertSpy).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/profiles/:participantId', () => {
    it('returns permitted candidate profile fields to authenticated PART user without exposing private email or non-teammate contact handle (US-006 AC 3, AC 4)', async () => {
      mockVerifyIdToken.mockResolvedValue(validDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(otherParticipant);
      vi.spyOn(profileRepository, 'areConfirmedTeammates').mockResolvedValue(false);
      vi.spyOn(profileRepository, 'getFullProfile').mockResolvedValue({
        profile: {
          ...sampleProfileRecord,
          participant_id: otherParticipant.id,
          handle: 'other_dev',
          shared_contact_handle: '@secret_contact',
        },
        skills: [],
        portfolios: [],
      });

      const res = await request(app)
        .get(`/api/profiles/${otherParticipant.id}`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.profile.handle).toBe('other_dev');
      expect(res.body.profile.email).toBeUndefined();
      expect(res.body.profile.participantId).toBeUndefined();
      expect(res.body.profile.sharedContactHandle).toBeUndefined();
    });

    it('includes sharedContactHandle when the authenticated PART viewer is a confirmed teammate (US-006 AC 4)', async () => {
      mockVerifyIdToken.mockResolvedValue(validDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(otherParticipant);
      vi.spyOn(profileRepository, 'areConfirmedTeammates').mockResolvedValue(true);
      vi.spyOn(profileRepository, 'getFullProfile').mockResolvedValue({
        profile: {
          ...sampleProfileRecord,
          participant_id: otherParticipant.id,
          handle: 'other_dev',
          shared_contact_handle: '@teammate_contact',
        },
        skills: [],
        portfolios: [],
      });

      const res = await request(app)
        .get(`/api/profiles/${otherParticipant.id}`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.profile.sharedContactHandle).toBe('@teammate_contact');
    });
  });
});

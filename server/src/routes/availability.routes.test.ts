import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { availabilityRepository } from '../repositories/availability.repository.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { Participant } from '../db/types.js';

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

describe('Express Availability Endpoints (US-011 / #US-286 & #US-288)', () => {
  const verifiedParticipant: Participant = {
    id: '11111111-1111-4111-8111-111111111111',
    firebase_uid: 'fb-verified-1',
    email: 'part@example.com',
    full_name: 'Verified Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };

  const unverifiedParticipant: Participant = {
    id: '22222222-2222-4222-8222-222222222222',
    firebase_uid: 'fb-unverified-2',
    email: 'unverified@example.com',
    full_name: 'Unverified Participant',
    role: 'PART',
    is_verified: false,
    is_suspended: false,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };

  const validDecodedToken = {
    uid: 'fb-verified-1',
    email: 'part@example.com',
    role: 'PART',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;

  const validTokenHeader = 'Bearer valid-mfa-token';

  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(verifiedParticipant);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(verifiedParticipant);
  });

  describe('Authorization & Access Control (AC 3)', () => {
    it('rejects unauthenticated visitor requests with 401 on GET /me, PUT /me, and GET /', async () => {
      const getMeRes = await request(app).get('/api/availability/me');
      expect(getMeRes.status).toBe(401);
      expect(getMeRes.body.code).toBe('UNAUTHORIZED');

      const putMeRes = await request(app).put('/api/availability/me').send({ isLooking: false });
      expect(putMeRes.status).toBe(401);

      const getCandidatesRes = await request(app).get('/api/availability');
      expect(getCandidatesRes.status).toBe(401);
    });

    it('rejects unverified participant with 403 EMAIL_NOT_VERIFIED', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(unverifiedParticipant);

      const res = await request(app)
        .get('/api/availability/me')
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('rejects participant missing MFA claim with 403 MFA_REQUIRED', async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: 'fb-verified-1',
        email: 'part@example.com',
        auth_time: AUTH_TIME,
      });

      const res = await request(app)
        .get('/api/availability/me')
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
    });
  });

  describe('GET /api/availability/me (AC 1)', () => {
    it('returns default availability record when no record exists yet', async () => {
      vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue(null);

      const res = await request(app)
        .get('/api/availability/me')
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.status).toBe('ok');
      expect(res.body.availability).toEqual({
        participantId: verifiedParticipant.id,
        isLooking: false,
        desiredRole: null,
        commitmentHours: null,
        goal: null,
        updatedAt: null,
      });
    });

    it('returns stored availability preferences', async () => {
      const savedRecord = {
        participantId: verifiedParticipant.id,
        isLooking: true,
        desiredRole: 'Frontend' as const,
        commitmentHours: 25.5,
        goal: 'Project Completion' as const,
        updatedAt: '2026-10-18T12:00:00.000Z',
      };
      vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue(savedRecord);

      const res = await request(app)
        .get('/api/availability/me')
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.availability).toEqual(savedRecord);
    });
  });

  describe('PUT /api/availability/me (AC 1 & AC 2)', () => {
    it('rejects requests supplying client eventId with 400 VALIDATION_ERROR', async () => {
      const upsertSpy = vi.spyOn(availabilityRepository, 'upsertByParticipantId');

      const res = await request(app)
        .put('/api/availability/me')
        .set('Authorization', validTokenHeader)
        .send({
          eventId: '44444444-4444-4444-8444-444444444444',
          isLooking: true,
          desiredRole: 'Frontend',
          commitmentHours: 20,
          goal: 'Learning',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.fieldErrors.eventId).toContain('eventId is not accepted');
      expect(upsertSpy).not.toHaveBeenCalled();
    });

    it('rejects invalid commitment hours (>168 or <0 or >1 decimal)', async () => {
      const res = await request(app)
        .put('/api/availability/me')
        .set('Authorization', validTokenHeader)
        .send({
          isLooking: true,
          desiredRole: 'Frontend',
          commitmentHours: 200,
          goal: 'Learning',
        });

      expect(res.status).toBe(400);
      expect(res.body.fieldErrors.commitmentHours).toBe('Commitment hours must be between 0 and 168.');
    });

    it('successfully updates Looking-for-Team preferences when valid', async () => {
      const updatedRecord = {
        participantId: verifiedParticipant.id,
        isLooking: true,
        desiredRole: 'Backend' as const,
        commitmentHours: 15,
        goal: 'Competitive' as const,
        updatedAt: new Date().toISOString(),
      };
      const upsertSpy = vi
        .spyOn(availabilityRepository, 'upsertByParticipantId')
        .mockResolvedValue(updatedRecord);
      vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue(null);
      vi.spyOn(profileRepository, 'getFullProfile').mockResolvedValue({
        profile: {
          participant_id: verifiedParticipant.id,
          handle: 'verified_dev',
          primary_role: 'Backend',
          institution: 'Centennial College',
          shared_contact_handle: null,
          created_at: '2026-10-18T00:00:00.000Z',
          updated_at: '2026-10-18T00:00:00.000Z',
        },
        skills: [
          {
            id: 's1',
            participant_id: verifiedParticipant.id,
            skill_name: 'TypeScript',
            created_at: '',
          },
        ],
        portfolios: [
          {
            id: 'p1',
            participant_id: verifiedParticipant.id,
            url: 'https://github.com/sample',
            label: 'GitHub',
            created_at: '',
            updated_at: '',
          },
        ],
      });

      const res = await request(app)
        .put('/api/availability/me')
        .set('Authorization', validTokenHeader)
        .send({
          isLooking: true,
          desiredRole: 'backend',
          commitmentHours: 15,
          goal: 'competitive',
        });

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.availability).toEqual(updatedRecord);
      expect(upsertSpy).toHaveBeenCalledWith(
        verifiedParticipant.id,
        expect.objectContaining({
          isLooking: true,
          desiredRole: 'Backend',
          commitmentHours: 15,
          goal: 'Competitive',
        })
      );
    });

    it('rejects enabling Looking for Team when profile discovery fields are incomplete (#360)', async () => {
      const upsertSpy = vi.spyOn(availabilityRepository, 'upsertByParticipantId');
      vi.spyOn(profileRepository, 'getFullProfile').mockResolvedValue({
        profile: {
          participant_id: verifiedParticipant.id,
          handle: null,
          primary_role: 'Backend',
          institution: null,
          shared_contact_handle: null,
          created_at: '2026-10-18T00:00:00.000Z',
          updated_at: '2026-10-18T00:00:00.000Z',
        },
        skills: [],
        portfolios: [],
      });

      const res = await request(app)
        .put('/api/availability/me')
        .set('Authorization', validTokenHeader)
        .send({
          isLooking: true,
          desiredRole: 'Backend',
          commitmentHours: 13,
          goal: 'Project Completion',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.fieldErrors.handle).toMatch(/handle/i);
      expect(res.body.fieldErrors.institution).toMatch(/institution/i);
      expect(res.body.fieldErrors.skills).toMatch(/skill/i);
      expect(res.body.fieldErrors.portfolioLinks).toMatch(/portfolio/i);
      expect(upsertSpy).not.toHaveBeenCalled();
    });

    it('preserves existing stored preferences when toggling off Looking-for-Team without supplying fields', async () => {
      const existing = {
        participantId: verifiedParticipant.id,
        isLooking: true,
        desiredRole: 'Frontend' as const,
        commitmentHours: 30,
        goal: 'Learning' as const,
        updatedAt: '2026-10-18T10:00:00.000Z',
      };
      vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue(existing);

      const upsertSpy = vi
        .spyOn(availabilityRepository, 'upsertByParticipantId')
        .mockImplementation(async (_id, vals) => ({
          participantId: verifiedParticipant.id,
          isLooking: vals.isLooking,
          desiredRole: vals.desiredRole,
          commitmentHours: vals.commitmentHours,
          goal: vals.goal,
          updatedAt: new Date().toISOString(),
        }));

      const res = await request(app)
        .put('/api/availability/me')
        .set('Authorization', validTokenHeader)
        .send({
          isLooking: false,
        });

      expect(res.status).toBe(200);
      expect(upsertSpy).toHaveBeenCalledWith(verifiedParticipant.id, {
        isLooking: false,
        desiredRole: 'Frontend',
        commitmentHours: 30,
        goal: 'Learning',
      });
    });
  });

  describe('GET /api/availability (Candidate Pool & Privacy Protection, AC 3)', () => {
    it('returns eligible candidate cards projected without sensitive contact data', async () => {
      vi.spyOn(availabilityRepository, 'findAllActiveLooking').mockResolvedValue([
        {
          participantId: verifiedParticipant.id,
          isLooking: true,
          desiredRole: 'Frontend',
          commitmentHours: 20,
          goal: 'Learning',
          updatedAt: '2026-10-18T12:00:00.000Z',
        },
      ]);

      vi.spyOn(profileRepository, 'getFullProfile').mockResolvedValue({
        profile: {
          participant_id: verifiedParticipant.id,
          handle: 'verified_dev',
          primary_role: 'Frontend',
          institution: 'Centennial College',
          shared_contact_handle: 'secret_discord_handle',
          created_at: '2026-10-18T00:00:00.000Z',
          updated_at: '2026-10-18T00:00:00.000Z',
        },
        skills: [{ id: 's1', participant_id: verifiedParticipant.id, skill_name: 'TypeScript', created_at: '' }],
        portfolios: [{ id: 'p1', participant_id: verifiedParticipant.id, url: 'https://github.com/sample', label: 'GitHub', created_at: '', updated_at: '' }],
      });

      const res = await request(app)
        .get('/api/availability')
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.candidates).toHaveLength(1);
      const card = res.body.candidates[0];

      // Safe projected candidate fields
      expect(card.displayName).toBe('Verified Participant');
      expect(card.handle).toBe('verified_dev');
      expect(card.desiredRole).toBe('Frontend');
      expect(card.commitmentHours).toBe(20);
      expect(card.goal).toBe('Learning');
      expect(card.skills).toEqual(['TypeScript']);
      expect(card.portfolioLinks).toHaveLength(1);

      // Privacy verification (FR-027 / AC 3): never expose email or sharedContactHandle
      expect(card.email).toBeUndefined();
      expect(card.sharedContactHandle).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('secret_discord_handle');
      expect(JSON.stringify(res.body)).not.toContain('part@example.com');
    });
  });
});

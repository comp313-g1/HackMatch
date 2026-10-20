import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { ModerationCase, Participant, Team } from '../db/types.js';

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
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  firebase_uid: 'fb-part-1',
  email: 'part@example.com',
  full_name: 'Ada Lovelace',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  created_at: '2026-10-18T00:00:00.000Z',
  updated_at: '2026-10-18T00:00:00.000Z',
};

const adminToken = {
  uid: 'fb-admin-1',
  email: 'admin@example.com',
  role: 'ADMIN',
  auth_time: AUTH_TIME,
  [MFA_CLAIM]: AUTH_TIME,
} as unknown as DecodedIdToken;

const partToken = {
  uid: 'fb-part-1',
  email: 'part@example.com',
  role: 'PART',
  auth_time: AUTH_TIME,
  [MFA_CLAIM]: AUTH_TIME,
} as unknown as DecodedIdToken;

const sampleTeam: Team = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  event_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  owner_participant_id: partParticipant.id,
  name: 'Phishy Team',
  pitch: 'Join us via this link',
  goal: 'Learning',
  commitment_hours: 10,
  communication_link: 'https://evil.example/phish',
  recruitment_status: 'Open',
  locked_at: null,
  disbanded_at: null,
  created_at: '2026-10-18T01:00:00.000Z',
  updated_at: '2026-10-18T01:00:00.000Z',
};

const olderCase: ModerationCase = {
  id: '11111111-1111-4111-8111-111111111111',
  target_type: 'team',
  target_id: sampleTeam.id,
  reason: 'Older spam pitch',
  status: 'Open',
  created_by: adminParticipant.id,
  report_count: 0,
  flagged_url: null,
  created_at: '2026-10-18T10:00:00.000Z',
  updated_at: '2026-10-18T10:00:00.000Z',
};

const newerCase: ModerationCase = {
  id: '22222222-2222-4222-8222-222222222222',
  target_type: 'profile',
  target_id: partParticipant.id,
  reason: 'Newer phishing portfolio',
  status: 'Open',
  created_by: adminParticipant.id,
  report_count: 2,
  flagged_url: null,
  created_at: '2026-10-18T12:00:00.000Z',
  updated_at: '2026-10-18T12:00:00.000Z',
};

const authHeader = 'Bearer valid-mfa-token';

describe('ADMIN moderation queue + target detail (US-026 / #239)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(adminToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(adminParticipant);
    vi.spyOn(participantsRepository, 'findById').mockImplementation(async (id) => {
      if (id === adminParticipant.id) return adminParticipant;
      if (id === partParticipant.id) return partParticipant;
      return null;
    });
  });

  describe('authorization', () => {
    it('returns 401 without a token', async () => {
      const res = await request(app).get('/api/admin/moderation/cases');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 FORBIDDEN_ROLE for PART callers', async () => {
      mockVerifyIdToken.mockResolvedValue(partToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(partParticipant);

      const res = await request(app)
        .get('/api/admin/moderation/cases')
        .set('Authorization', authHeader);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });
  });

  describe('GET /api/admin/moderation/cases (queue)', () => {
    it('returns empty queue with 200', async () => {
      vi.spyOn(moderationRepository, 'listNewestFirst').mockResolvedValue([]);

      const res = await request(app)
        .get('/api/admin/moderation/cases')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toMatch(/no-store/i);
      expect(res.body).toEqual({ cases: [] });
    });

    it('returns cases newest first with target, reason, time, and reportCount', async () => {
      vi.spyOn(moderationRepository, 'listNewestFirst').mockResolvedValue([newerCase, olderCase]);

      const res = await request(app)
        .get('/api/admin/moderation/cases')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.cases).toHaveLength(2);
      expect(res.body.cases[0].id).toBe(newerCase.id);
      expect(res.body.cases[0].createdAt).toBe(newerCase.created_at);
      expect(res.body.cases[0].reason).toBe(newerCase.reason);
      expect(res.body.cases[0].targetType).toBe('profile');
      expect(res.body.cases[0].reportCount).toBe(2);
      expect(res.body.cases[1].id).toBe(olderCase.id);
      expect(JSON.stringify(res.body)).not.toMatch(/admin@example\.com|part@example\.com|firebase_uid|shared_contact/i);
    });

    it('rejects invalid status query and echoes submitted values', async () => {
      const res = await request(app)
        .get('/api/admin/moderation/cases?status=Nope')
        .set('Authorization', authHeader);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.status).toBeTruthy();
      expect(res.body.submitted.status).toBe('Nope');
    });
  });

  describe('GET /api/admin/moderation/cases/:caseId (target detail)', () => {
    it('rejects invalid caseId with 400 and preserves submitted value', async () => {
      const res = await request(app)
        .get('/api/admin/moderation/cases/not-a-uuid')
        .set('Authorization', authHeader);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.caseId).toBeTruthy();
      expect(res.body.submitted.caseId).toBe('not-a-uuid');
    });

    it('returns 404 CASE_NOT_FOUND when the case is missing', async () => {
      vi.spyOn(moderationRepository, 'findById').mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/admin/moderation/cases/${olderCase.id}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('CASE_NOT_FOUND');
    });

    it('returns sanitized team target detail without credentials or private contacts', async () => {
      vi.spyOn(moderationRepository, 'findById').mockResolvedValue(olderCase);
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
      vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
        participant_id: partParticipant.id,
        handle: 'ada',
        primary_role: 'Backend',
        institution: 'UofT',
        shared_contact_handle: 'secret-discord#1234',
        created_at: '2026-10-18T00:00:00.000Z',
        updated_at: '2026-10-18T00:00:00.000Z',
      });

      const res = await request(app)
        .get(`/api/admin/moderation/cases/${olderCase.id}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.case.id).toBe(olderCase.id);
      expect(res.body.target.type).toBe('team');
      expect(res.body.target.team.name).toBe('Phishy Team');
      expect(res.body.target.team.communicationLink).toBe('https://evil.example/phish');
      expect(res.body.target.team.ownerHandle).toBe('ada');
      expect(res.body.target.team.ownerDisplayName).toBe('Ada Lovelace');
      expect(JSON.stringify(res.body)).not.toMatch(
        /admin@example\.com|part@example\.com|fb-part-1|secret-discord|firebase_uid|shared_contact/i
      );
    });

    it('returns sanitized profile target with portfolios and skills, omitting private contact', async () => {
      vi.spyOn(moderationRepository, 'findById').mockResolvedValue(newerCase);
      vi.spyOn(profileRepository, 'getFullProfile').mockResolvedValue({
        profile: {
          participant_id: partParticipant.id,
          handle: 'ada',
          primary_role: 'Frontend',
          institution: 'UofT',
          shared_contact_handle: 'private@im',
          created_at: '2026-10-18T00:00:00.000Z',
          updated_at: '2026-10-18T00:00:00.000Z',
        },
        skills: [
          {
            id: 's1',
            participant_id: partParticipant.id,
            skill_name: 'React',
            created_at: '2026-10-18T00:00:00.000Z',
          },
        ],
        portfolios: [
          {
            id: 'p1',
            participant_id: partParticipant.id,
            url: 'https://portfolio.example/ada',
            label: 'Site',
            created_at: '2026-10-18T00:00:00.000Z',
            updated_at: '2026-10-18T00:00:00.000Z',
          },
        ],
      });

      const res = await request(app)
        .get(`/api/admin/moderation/cases/${newerCase.id}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.target.type).toBe('profile');
      expect(res.body.target.profile.handle).toBe('ada');
      expect(res.body.target.profile.skills).toEqual(['React']);
      expect(res.body.target.profile.portfolios).toEqual([
        { url: 'https://portfolio.example/ada', label: 'Site' },
      ]);
      expect(JSON.stringify(res.body)).not.toMatch(/private@im|part@example\.com|fb-part-1/i);
    });
  });

  describe('POST /api/admin/moderation/cases (open case)', () => {
    it('creates a team case and returns 201', async () => {
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
      vi.spyOn(moderationRepository, 'createCase').mockResolvedValue(olderCase);

      const body = {
        targetType: 'team',
        targetId: sampleTeam.id,
        reason: 'Suspicious communication link',
      };

      const res = await request(app)
        .post('/api/admin/moderation/cases')
        .set('Authorization', authHeader)
        .send(body);

      expect(res.status).toBe(201);
      expect(res.body.case.id).toBe(olderCase.id);
      expect(res.body.case.targetType).toBe('team');
      expect(res.body.case.reason).toBe(olderCase.reason);
      expect(moderationRepository.createCase).toHaveBeenCalledWith(
        expect.objectContaining({
          target_type: 'team',
          target_id: sampleTeam.id,
          created_by: adminParticipant.id,
          reason: 'Suspicious communication link',
        })
      );
    });

    it('rejects missing reason with 400 and echoes submitted draft', async () => {
      const createSpy = vi.spyOn(moderationRepository, 'createCase');
      const body = {
        targetType: 'team',
        targetId: sampleTeam.id,
        reason: '   ',
      };

      const res = await request(app)
        .post('/api/admin/moderation/cases')
        .set('Authorization', authHeader)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.reason).toBeTruthy();
      expect(res.body.submitted).toEqual(body);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('rejects url targets without flaggedUrl and preserves submitted fields', async () => {
      const body = {
        targetType: 'url',
        targetId: sampleTeam.id,
        reason: 'Phishing link spotted',
      };

      const res = await request(app)
        .post('/api/admin/moderation/cases')
        .set('Authorization', authHeader)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.errors.flaggedUrl).toBeTruthy();
      expect(res.body.submitted).toEqual(body);
    });

    it('returns 404 TARGET_NOT_FOUND when the team does not exist', async () => {
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(null);
      const createSpy = vi.spyOn(moderationRepository, 'createCase');

      const res = await request(app)
        .post('/api/admin/moderation/cases')
        .set('Authorization', authHeader)
        .send({
          targetType: 'team',
          targetId: sampleTeam.id,
          reason: 'Listing looks fake',
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('TARGET_NOT_FOUND');
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('denies PART from creating cases', async () => {
      mockVerifyIdToken.mockResolvedValue(partToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(partParticipant);
      const createSpy = vi.spyOn(moderationRepository, 'createCase');

      const res = await request(app)
        .post('/api/admin/moderation/cases')
        .set('Authorization', authHeader)
        .send({
          targetType: 'team',
          targetId: sampleTeam.id,
          reason: 'Should not work',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
      expect(createSpy).not.toHaveBeenCalled();
    });
  });
});

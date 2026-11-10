import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { moderationTargetRepository } from '../db/moderationTarget.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import { MODERATION_REASON_MAX } from '../validators/moderation.validator.js';
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
      expect(res.body.privacy).toEqual(
        expect.objectContaining({
          credentialsIncluded: false,
          privateContactsIncluded: false,
          privateWorkspaceAccessGranted: false,
        })
      );
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

    it('returns privacy-safe chat evidence to ADMIN and no unrelated conversation data', async () => {
      const chatCase: ModerationCase = {
        ...olderCase,
        target_type: 'chat_message',
        target_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      };
      vi.spyOn(moderationRepository, 'findById').mockResolvedValue(chatCase);
      vi.spyOn(moderationTargetRepository, 'findChatMessageEvidence').mockResolvedValue({
        id: chatCase.target_id,
        author_id: partParticipant.id,
        body: 'Target body; email=private@example.test; OTP=123456',
        created_at: '2026-11-10T12:00:00.000Z',
      });
      vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
        participant_id: partParticipant.id,
        handle: 'ada',
        primary_role: null,
        institution: 'UNRELATED_PROFILE_DATA',
        shared_contact_handle: 'hidden-contact',
        created_at: partParticipant.created_at,
        updated_at: partParticipant.updated_at,
      });

      const res = await request(app)
        .get(`/api/admin/moderation/cases/${chatCase.id}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toMatch(/no-store/i);
      expect(res.body.target.chatMessage).toMatchObject({
        id: chatCase.target_id,
        availability: 'Available',
        authorHandle: 'ada',
        createdAt: '2026-11-10T12:00:00.000Z',
      });
      expect(JSON.stringify(res.body)).not.toMatch(
        /private@example|123456|UNRELATED_PROFILE_DATA|hidden-contact|part@example|firebase_uid/i
      );
    });

    it('returns only safe channel metadata to ADMIN without team membership or message history', async () => {
      const chatCase: ModerationCase = {
        ...olderCase,
        target_type: 'chat_channel',
        target_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      };
      vi.spyOn(moderationRepository, 'findById').mockResolvedValue(chatCase);
      vi.spyOn(moderationTargetRepository, 'findChatChannelEvidence').mockResolvedValue({
        id: chatCase.target_id,
        title: 'Private team channel',
        description: 'Contact owner@example.test with token=private-token',
        created_by: partParticipant.id,
        channel_type: 'team',
        created_at: '2026-11-10T07:00:00-05:00',
      });
      vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
        participant_id: partParticipant.id,
        handle: 'ada',
        primary_role: null,
        institution: null,
        shared_contact_handle: 'hidden-contact',
        created_at: partParticipant.created_at,
        updated_at: partParticipant.updated_at,
      });

      const res = await request(app)
        .get(`/api/admin/moderation/cases/${chatCase.id}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.target.chatChannel).toEqual({
        id: chatCase.target_id,
        availability: 'Available',
        channelType: 'team',
        title: 'Private team channel',
        description: 'Contact [redacted email] with token: [redacted]',
        creatorHandle: 'ada',
        createdAt: '2026-11-10T12:00:00.000Z',
        contentRedacted: true,
      });
      expect(JSON.stringify(res.body)).not.toMatch(
        /owner@example|private-token|hidden-contact|team_id|membership|messages/i
      );
    });

    it('denies a PART before resolving any chat evidence', async () => {
      mockVerifyIdToken.mockResolvedValue(partToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(partParticipant);
      const caseLookup = vi.spyOn(moderationRepository, 'findById');
      const evidenceLookup = vi.spyOn(moderationTargetRepository, 'findChatMessageEvidence');

      const res = await request(app)
        .get(`/api/admin/moderation/cases/${olderCase.id}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
      expect(caseLookup).not.toHaveBeenCalled();
      expect(evidenceLookup).not.toHaveBeenCalled();
    });

    it('denies an unauthenticated visitor before resolving any chat evidence', async () => {
      const caseLookup = vi.spyOn(moderationRepository, 'findById');
      const evidenceLookup = vi.spyOn(moderationTargetRepository, 'findChatChannelEvidence');

      const res = await request(app).get(`/api/admin/moderation/cases/${olderCase.id}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(caseLookup).not.toHaveBeenCalled();
      expect(evidenceLookup).not.toHaveBeenCalled();
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

    describe('US-033 ADMIN chat-case creation (#393)', () => {
      const channelId = '44444444-4444-4444-8444-444444444444';
      const messageId = '55555555-5555-4555-8555-555555555555';

      function chatCase(
        targetType: 'chat_channel' | 'chat_message',
        targetId: string,
        reason: string
      ): ModerationCase {
        return {
          id: '66666666-6666-4666-8666-666666666666',
          target_type: targetType,
          target_id: targetId,
          reason,
          status: 'Open',
          created_by: adminParticipant.id,
          report_count: 0,
          flagged_url: null,
          created_at: '2026-11-10T01:00:00.000Z',
          updated_at: '2026-11-10T01:00:00.000Z',
        };
      }

      it.each([
        ['chat_channel', channelId, 'chatChannelExists'],
        ['chat_message', messageId, 'chatMessageExists'],
      ] as const)(
        'allows an authenticated ADMIN to create a %s case through the existing US-026 endpoint',
        async (targetType, targetId, lookup) => {
          const reason = '  Repeated abusive chat content  ';
          vi.spyOn(moderationTargetRepository, lookup).mockResolvedValue(true);
          const createSpy = vi
            .spyOn(moderationRepository, 'createCase')
            .mockResolvedValue(chatCase(targetType, targetId, reason.trim()));

          const res = await request(app)
            .post('/api/admin/moderation/cases')
            .set('Authorization', authHeader)
            .send({ targetType, targetId, reason });

          expect(res.status).toBe(201);
          expect(res.headers['cache-control']).toMatch(/no-store/i);
          expect(res.body.case).toMatchObject({
            targetType,
            targetId,
            reason: reason.trim(),
            status: 'Open',
            reportCount: 0,
            flaggedUrl: null,
            createdBy: adminParticipant.id,
          });
          expect(createSpy).toHaveBeenCalledWith({
            target_type: targetType,
            target_id: targetId,
            reason: reason.trim(),
            created_by: adminParticipant.id,
            flagged_url: null,
          });
          expect(JSON.stringify(res.body)).not.toMatch(
            /messageBody|channelMembership|email|firebase|credential|token|otp/i
          );
        }
      );

      it('returns 401 before target lookup when the visitor is unauthenticated', async () => {
        const targetLookup = vi.spyOn(moderationTargetRepository, 'chatChannelExists');
        const createSpy = vi.spyOn(moderationRepository, 'createCase');

        const res = await request(app).post('/api/admin/moderation/cases').send({
          targetType: 'chat_channel',
          targetId: channelId,
          reason: 'Should not run',
        });

        expect(res.status).toBe(401);
        expect(res.body.code).toBe('UNAUTHORIZED');
        expect(targetLookup).not.toHaveBeenCalled();
        expect(createSpy).not.toHaveBeenCalled();
      });

      it('returns 403 before target lookup for an authenticated PART caller', async () => {
        mockVerifyIdToken.mockResolvedValue(partToken);
        vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(partParticipant);
        const targetLookup = vi.spyOn(moderationTargetRepository, 'chatMessageExists');
        const createSpy = vi.spyOn(moderationRepository, 'createCase');

        const res = await request(app)
          .post('/api/admin/moderation/cases')
          .set('Authorization', authHeader)
          .send({
            targetType: 'chat_message',
            targetId: messageId,
            reason: 'Should not run',
          });

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN_ROLE');
        expect(targetLookup).not.toHaveBeenCalled();
        expect(createSpy).not.toHaveBeenCalled();
      });

      it.each([
        ['missing', undefined],
        ['empty', ''],
        ['whitespace-only', '   '],
        ['over-limit', 'x'.repeat(MODERATION_REASON_MAX + 1)],
      ])('rejects a %s reason before target lookup', async (_label, reason) => {
        const targetLookup = vi.spyOn(moderationTargetRepository, 'chatMessageExists');
        const createSpy = vi.spyOn(moderationRepository, 'createCase');
        const body: Record<string, unknown> = {
          targetType: 'chat_message',
          targetId: messageId,
        };
        if (reason !== undefined) body.reason = reason;

        const res = await request(app)
          .post('/api/admin/moderation/cases')
          .set('Authorization', authHeader)
          .send(body);

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.errors.reason).toBeTruthy();
        expect(res.body.submitted).toEqual(body);
        expect(targetLookup).not.toHaveBeenCalled();
        expect(createSpy).not.toHaveBeenCalled();
      });

      it.each([
        ['malformed target ID', { targetType: 'chat_channel', targetId: 'not-a-uuid' }, 'targetId'],
        ['unsupported target type', { targetType: 'direct_message', targetId: messageId }, 'targetType'],
      ] as const)('rejects %s without resolving chat data', async (_label, target, errorField) => {
        const channelLookup = vi.spyOn(moderationTargetRepository, 'chatChannelExists');
        const messageLookup = vi.spyOn(moderationTargetRepository, 'chatMessageExists');
        const createSpy = vi.spyOn(moderationRepository, 'createCase');

        const res = await request(app)
          .post('/api/admin/moderation/cases')
          .set('Authorization', authHeader)
          .send({ ...target, reason: 'Invalid target request' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.errors[errorField]).toBeTruthy();
        expect(channelLookup).not.toHaveBeenCalled();
        expect(messageLookup).not.toHaveBeenCalled();
        expect(createSpy).not.toHaveBeenCalled();
      });

      it.each([
        ['chat_channel', channelId, 'chatChannelExists'],
        ['chat_message', messageId, 'chatMessageExists'],
      ] as const)('returns the same safe 404 for a stale %s target', async (targetType, targetId, lookup) => {
        vi.spyOn(moderationTargetRepository, lookup).mockResolvedValue(false);
        const createSpy = vi.spyOn(moderationRepository, 'createCase');

        const res = await request(app)
          .post('/api/admin/moderation/cases')
          .set('Authorization', authHeader)
          .send({ targetType, targetId, reason: 'Target is now stale' });

        expect(res.status).toBe(404);
        expect(res.body).toEqual({
          error: 'The moderation target was not found.',
          code: 'TARGET_NOT_FOUND',
          details: { targetType, targetId },
        });
        expect(JSON.stringify(res.body)).not.toMatch(
          /SELECT|chat_channels|chat_messages|body|author|member|email|token|otp|stack/i
        );
        expect(createSpy).not.toHaveBeenCalled();
      });

      it('rejects a channel identifier labelled as chat_message without checking the channel table', async () => {
        const channelLookup = vi
          .spyOn(moderationTargetRepository, 'chatChannelExists')
          .mockResolvedValue(true);
        const messageLookup = vi
          .spyOn(moderationTargetRepository, 'chatMessageExists')
          .mockResolvedValue(false);
        const createSpy = vi.spyOn(moderationRepository, 'createCase');

        const res = await request(app)
          .post('/api/admin/moderation/cases')
          .set('Authorization', authHeader)
          .send({
            targetType: 'chat_message',
            targetId: channelId,
            reason: 'Mismatched entity type',
          });

        expect(res.status).toBe(404);
        expect(res.body.code).toBe('TARGET_NOT_FOUND');
        expect(messageLookup).toHaveBeenCalledWith(channelId);
        expect(channelLookup).not.toHaveBeenCalled();
        expect(createSpy).not.toHaveBeenCalled();
      });

      it('returns a generic 500 if target validation fails unexpectedly', async () => {
        const privateFailure =
          'SELECT body FROM chat_messages: private-message-content admin@example.test';
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(moderationTargetRepository, 'chatMessageExists').mockRejectedValue(
          new Error(privateFailure)
        );

        const res = await request(app)
          .post('/api/admin/moderation/cases')
          .set('Authorization', authHeader)
          .send({
            targetType: 'chat_message',
            targetId: messageId,
            reason: 'Validate safely',
          });

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Internal Server Error');
        expect(JSON.stringify(res.body)).not.toMatch(
          /private-message-content|admin@example|SELECT body|stack/i
        );
      });
    });
  });
});

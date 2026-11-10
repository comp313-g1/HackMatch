import type { DecodedIdToken } from 'firebase-admin/auth';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../app.js';
import { chatRepository } from '../db/chat.repository.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { clearModerationReportsStore } from '../db/moderationReports.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import type {
  ChatChannel,
  ChatMessage,
  ModerationCase,
  Participant,
  Team,
} from '../db/types.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';

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

vi.mock('../db/client.js', () => ({
  getSupabaseClient: vi.fn(),
}));

const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;

const partParticipant: Participant = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  firebase_uid: 'fb-part-1',
  email: 'part@example.com',
  full_name: 'Reporting Participant',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-10-18T00:00:00.000Z',
  updated_at: '2026-10-18T00:00:00.000Z',
};

const adminParticipant: Participant = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  firebase_uid: 'fb-admin-1',
  email: 'admin@example.com',
  full_name: 'Platform Admin',
  role: 'ADMIN',
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-10-18T00:00:00.000Z',
  updated_at: '2026-10-18T00:00:00.000Z',
};

const partToken = {
  uid: 'fb-part-1',
  email: 'part@example.com',
  role: 'PART',
  auth_time: AUTH_TIME,
  [MFA_CLAIM]: AUTH_TIME,
} as unknown as DecodedIdToken;

const adminToken = {
  uid: 'fb-admin-1',
  email: 'admin@example.com',
  role: 'ADMIN',
  auth_time: AUTH_TIME,
  [MFA_CLAIM]: AUTH_TIME,
} as unknown as DecodedIdToken;

const sampleTeam: Team = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  event_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  owner_participant_id: '99999999-9999-4999-8999-999999999999',
  name: 'Sample Team',
  pitch: 'Join our team for the hackathon',
  goal: 'Learning',
  commitment_hours: 10,
  communication_link: 'https://discord.gg/sample',
  recruitment_status: 'Open',
  locked_at: null,
  disbanded_at: null,
  moderation_status: 'None',
  created_at: '2026-10-18T01:00:00.000Z',
  updated_at: '2026-10-18T01:00:00.000Z',
};

const authHeader = 'Bearer valid-part-token';
const chatMessageId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const chatChannelId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const publicChannel: ChatChannel = {
  id: chatChannelId,
  title: 'General',
  description: 'Public participant forum',
  created_by: partParticipant.id,
  channel_type: 'public',
  team_id: null,
  created_at: '2026-11-10T10:00:00.000Z',
  updated_at: '2026-11-10T10:00:00.000Z',
};

const visibleMessage: ChatMessage = {
  id: chatMessageId,
  channel_id: chatChannelId,
  author_id: '99999999-9999-4999-8999-999999999999',
  body: 'Private message body must not appear in a report receipt.',
  created_at: '2026-11-10T11:00:00.000Z',
};

describe('/api/reports routes (US-025 / #236 / #237)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockReset();
    clearModerationReportsStore();
    mockVerifyIdToken.mockResolvedValue(partToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(
      partParticipant
    );
    vi.spyOn(participantsRepository, 'findById').mockImplementation(
      async (id) => {
        if (id === partParticipant.id) return partParticipant;
        if (id === adminParticipant.id) return adminParticipant;
        return null;
      }
    );
  });

  describe('authentication and authorization guards', () => {
    it('returns 401 when request is unauthenticated', async () => {
      const res = await request(app).post('/api/reports').send({
        targetType: 'team',
        targetId: sampleTeam.id,
        category: 'Spam',
      });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 FORBIDDEN_ROLE when an ADMIN attempts to use the participant report endpoint', async () => {
      mockVerifyIdToken.mockResolvedValue(adminToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(
        adminParticipant
      );

      const res = await request(app)
        .post('/api/reports')
        .set('Authorization', 'Bearer admin-token')
        .send({
          targetType: 'team',
          targetId: sampleTeam.id,
          category: 'Spam',
        });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('returns 403 EMAIL_NOT_VERIFIED for unverified participants', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        ...partParticipant,
        is_verified: false,
      });

      const res = await request(app)
        .post('/api/reports')
        .set('Authorization', authHeader)
        .send({
          targetType: 'team',
          targetId: sampleTeam.id,
          category: 'Spam',
        });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('returns 403 ACCOUNT_SUSPENDED before resolving a chat target', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        ...partParticipant,
        is_suspended: true,
      });
      const messageLookup = vi.spyOn(chatRepository, 'findMessageById');

      const res = await request(app)
        .post('/api/reports')
        .set('Authorization', authHeader)
        .send({
          targetType: 'chat_message',
          targetId: chatMessageId,
          category: 'Harassment',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
      expect(messageLookup).not.toHaveBeenCalled();
    });

    it('uses the current 403 ACCOUNT_SUSPENDED convention for a deactivated account', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        ...partParticipant,
        is_deactivated: true,
      });
      const messageLookup = vi.spyOn(chatRepository, 'findMessageById');

      const res = await request(app)
        .post('/api/reports')
        .set('Authorization', authHeader)
        .send({
          targetType: 'chat_message',
          targetId: chatMessageId,
          category: 'Harassment',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
      expect(messageLookup).not.toHaveBeenCalled();
    });
  });

  describe('confidentiality protection (US-025 AC 2 / FR-073)', () => {
    it('denies GET /api/reports with 403 REPORT_READ_FORBIDDEN', async () => {
      const res = await request(app)
        .get('/api/reports')
        .set('Authorization', authHeader);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('REPORT_READ_FORBIDDEN');
      expect(res.body.error.message).toContain('confidential');
    });

    it('denies GET /api/reports/:reportId with 403 REPORT_READ_FORBIDDEN', async () => {
      const res = await request(app)
        .get('/api/reports/11111111-1111-4111-8111-111111111111')
        .set('Authorization', authHeader);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('REPORT_READ_FORBIDDEN');
    });
  });

  describe('POST /api/reports submission lifecycle', () => {
    it('reports a visible public message and returns only the existing safe receipt DTO', async () => {
      vi.spyOn(chatRepository, 'findMessageById').mockResolvedValue(visibleMessage);
      vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue(publicChannel);
      vi.spyOn(moderationRepository, 'findOpenCaseByTarget').mockResolvedValue(null);
      const createdCase: ModerationCase = {
        id: '12121212-1212-4121-8121-121212121212',
        target_type: 'chat_message',
        target_id: chatMessageId,
        reason: '[Harassment] Abusive message',
        status: 'Open',
        created_by: partParticipant.id,
        report_count: 1,
        flagged_url: null,
        created_at: '2026-11-10T12:00:00.000Z',
        updated_at: '2026-11-10T12:00:00.000Z',
      };
      const createCaseSpy = vi
        .spyOn(moderationRepository, 'createCase')
        .mockResolvedValue(createdCase);

      const res = await request(app)
        .post('/api/reports')
        .set('Authorization', authHeader)
        .send({
          targetType: 'chat_message',
          targetId: chatMessageId,
          category: 'Harassment',
          explanation: 'Abusive message',
        });

      expect(res.status).toBe(201);
      expect(Object.keys(res.body.data).sort()).toEqual(
        [
          'caseId',
          'category',
          'confirmationMessage',
          'rateLimit',
          'reportId',
          'status',
          'submittedAt',
          'targetId',
          'targetType',
        ].sort()
      );
      expect(res.body.data).toMatchObject({
        caseId: createdCase.id,
        targetType: 'chat_message',
        targetId: chatMessageId,
        category: 'Harassment',
        status: 'Received',
      });
      expect(createCaseSpy).toHaveBeenCalledWith({
        target_type: 'chat_message',
        target_id: chatMessageId,
        reason: '[Harassment] Abusive message',
        created_by: partParticipant.id,
        flagged_url: null,
        report_count: 1,
      });
      expect(JSON.stringify(res.body)).not.toMatch(
        /Private message body|admin.?note|action.?record|other.?report|email|password|otp|token/i
      );

      // The linked case enters the same ADMIN queue without exposing the report store to PART.
      mockVerifyIdToken.mockResolvedValue(adminToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(adminParticipant);
      vi.spyOn(moderationRepository, 'listNewestFirst').mockResolvedValue([createdCase]);

      const queueRes = await request(app)
        .get('/api/admin/moderation/cases')
        .set('Authorization', 'Bearer valid-admin-token');

      expect(queueRes.status).toBe(200);
      expect(queueRes.body.cases).toEqual([
        expect.objectContaining({
          id: createdCase.id,
          targetType: 'chat_message',
          targetId: chatMessageId,
          reason: '[Harassment] Abusive message',
          reportCount: 1,
        }),
      ]);
      expect(JSON.stringify(queueRes.body)).not.toMatch(
        /Private message body|part@example|firebase_uid|password|otp|token/i
      );
    });

    it('conceals a private team message from an unrelated participant', async () => {
      vi.spyOn(chatRepository, 'findMessageById').mockResolvedValue(visibleMessage);
      vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue({
        ...publicChannel,
        channel_type: 'team',
        team_id: sampleTeam.id,
      });
      vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForTeam').mockResolvedValue([]);
      const caseLookup = vi.spyOn(moderationRepository, 'findOpenCaseByTarget');

      const res = await request(app)
        .post('/api/reports')
        .set('Authorization', authHeader)
        .send({
          targetType: 'chat_message',
          targetId: chatMessageId,
          category: 'Harassment',
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('TARGET_NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toMatch(/Private message body|team|member|channel/i);
      expect(caseLookup).not.toHaveBeenCalled();
    });

    it('returns the same concealed response for stale and unsupported direct-message IDs', async () => {
      vi.spyOn(chatRepository, 'findMessageById').mockResolvedValue(null);
      const caseLookup = vi.spyOn(moderationRepository, 'findOpenCaseByTarget');

      const res = await request(app)
        .post('/api/reports')
        .set('Authorization', authHeader)
        .send({
          targetType: 'chat_message',
          targetId: chatMessageId,
          category: 'Harassment',
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('TARGET_NOT_FOUND');
      expect(res.body.error.message).toBe(
        'The specified chat message is not available for reporting.'
      );
      expect(JSON.stringify(res.body)).not.toMatch(/direct_messages|thread|body|author/i);
      expect(caseLookup).not.toHaveBeenCalled();
    });

    it('returns 400 VALIDATION_ERROR and echoes submitted body on malformed input (NR-010)', async () => {
      const invalidPayload = {
        targetType: 'team',
        targetId: 'bad-uuid',
        category: 'InvalidCategory',
        explanation: 'Some explanation',
      };

      const res = await request(app)
        .post('/api/reports')
        .set('Authorization', authHeader)
        .send(invalidPayload);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.submitted).toEqual(invalidPayload);
      expect(res.body.errors.targetId).toBeDefined();
      expect(res.body.errors.category).toBeDefined();
    });

    it('returns 403 SELF_REPORT_FORBIDDEN when participant reports their own profile', async () => {
      const res = await request(app)
        .post('/api/reports')
        .set('Authorization', authHeader)
        .send({
          targetType: 'profile',
          targetId: partParticipant.id,
          category: 'Harassment',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('SELF_REPORT_FORBIDDEN');
    });

    it('returns 404 TARGET_NOT_FOUND when reporting a non-existent team', async () => {
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(null);

      const res = await request(app)
        .post('/api/reports')
        .set('Authorization', authHeader)
        .send({
          targetType: 'team',
          targetId: sampleTeam.id,
          category: 'Spam',
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('TARGET_NOT_FOUND');
    });

    it('submits a valid report, creates a US-026 moderation case, and returns 201 receipt', async () => {
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
      vi.spyOn(moderationRepository, 'findOpenCaseByTarget').mockResolvedValue(
        null
      );

      const createdCase: ModerationCase = {
        id: '66666666-6666-4666-8666-666666666666',
        target_type: 'team',
        target_id: sampleTeam.id,
        reason: '[Spam] Promotional spam link in team pitch',
        status: 'Open',
        created_by: partParticipant.id,
        report_count: 1,
        flagged_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      vi.spyOn(moderationRepository, 'createCase').mockResolvedValue(
        createdCase
      );

      const res = await request(app)
        .post('/api/reports')
        .set('Authorization', authHeader)
        .send({
          targetType: 'team',
          targetId: sampleTeam.id,
          category: 'Spam',
          explanation: 'Promotional spam link in team pitch',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({
        reportId: expect.any(String),
        caseId: createdCase.id,
        targetType: 'team',
        targetId: sampleTeam.id,
        category: 'Spam',
        status: 'Received',
        submittedAt: expect.any(String),
        confirmationMessage: expect.any(String),
        rateLimit: {
          limit: 5,
          remaining: 4,
          windowSeconds: 3600,
        },
      });
    });

    it('enforces 5 reports per rolling hour and rejects the 6th with 429 and Retry-After (US-025 AC 3)', async () => {
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
      const openCase: ModerationCase = {
        id: '77777777-7777-4777-8777-777777777777',
        target_type: 'team',
        target_id: sampleTeam.id,
        reason: '[Spam] Initial report',
        status: 'Open',
        created_by: partParticipant.id,
        report_count: 1,
        flagged_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      vi.spyOn(moderationRepository, 'findOpenCaseByTarget').mockResolvedValue(
        openCase
      );
      vi.spyOn(
        moderationRepository,
        'incrementCaseReportCount'
      ).mockResolvedValue(openCase);

      // Submit 5 valid reports
      for (let i = 1; i <= 5; i++) {
        const res = await request(app)
          .post('/api/reports')
          .set('Authorization', authHeader)
          .send({
            targetType: 'team',
            targetId: sampleTeam.id,
            category: 'Spam',
            explanation: `Report number ${i}`,
          });
        expect(res.status).toBe(201);
        expect(res.body.data.rateLimit.remaining).toBe(5 - i);
      }

      // 6th report should trigger 429 RATE_LIMITED
      const rejectedRes = await request(app)
        .post('/api/reports')
        .set('Authorization', authHeader)
        .send({
          targetType: 'team',
          targetId: sampleTeam.id,
          category: 'Spam',
          explanation: 'Report number 6',
        });

      expect(rejectedRes.status).toBe(429);
      expect(rejectedRes.header['retry-after']).toBeDefined();
      expect(rejectedRes.body.code).toBe('RATE_LIMITED');
      expect(rejectedRes.body.error.message).toContain('Rate limit exceeded');
      expect(rejectedRes.body.submitted).toBeDefined();
    });
  });
});

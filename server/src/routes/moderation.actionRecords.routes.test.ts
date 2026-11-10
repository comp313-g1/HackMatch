import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { ModerationCase, Participant } from '../db/types.js';

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
const CASE_ID = '11111111-1111-4111-8111-111111111111';
const AUTH = 'Bearer valid-mfa-token';

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

const openCase: ModerationCase = {
  id: CASE_ID,
  target_type: 'team',
  target_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  reason: 'Spam',
  status: 'Open',
  created_by: adminParticipant.id,
  report_count: 0,
  flagged_url: null,
  created_at: '2026-10-18T10:00:00.000Z',
  updated_at: '2026-10-18T10:00:00.000Z',
};

const chatCase: ModerationCase = {
  ...openCase,
  target_type: 'chat_message',
  target_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  reason: '[Harassment] Participant report',
  report_count: 1,
};

describe('GET /api/admin/moderation/cases/:caseId/action-records (US-026 / #243)', () => {
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

  it('returns empty records for an open case with no decisions', async () => {
    vi.spyOn(moderationRepository, 'findById').mockResolvedValue(openCase);
    vi.spyOn(moderationRepository, 'listActionRecordsForCase').mockResolvedValue([]);

    const res = await request(app)
      .get(`/api/admin/moderation/cases/${CASE_ID}/action-records`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.records).toEqual([]);
  });

  it('returns sanitized action records without credential fields', async () => {
    vi.spyOn(moderationRepository, 'findById').mockResolvedValue(openCase);
    vi.spyOn(moderationRepository, 'listActionRecordsForCase').mockResolvedValue([
      {
        id: 'rec-1',
        actor_id: adminParticipant.id,
        target_type: 'moderation_team',
        target_id: openCase.target_id,
        action_type: 'moderation_hide',
        reason: 'Phishing listing',
        outcome: 'listing_hidden',
        safe_state_summary: {
          caseId: CASE_ID,
          email: 'should-not-leak@example.com',
          credentialsIncluded: false,
          privateContactsIncluded: false,
        },
        created_at: '2026-10-18T12:00:00.000Z',
      },
    ]);

    const res = await request(app)
      .get(`/api/admin/moderation/cases/${CASE_ID}/action-records`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(1);
    expect(res.body.records[0].reason).toBe('Phishing listing');
    expect(res.body.records[0].outcome).toBe('listing_hidden');
    expect(res.body.records[0].safeStateSummary.credentialsIncluded).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/should-not-leak@example\.com/);
  });

  it('returns 404 when the case does not exist', async () => {
    vi.spyOn(moderationRepository, 'findById').mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/admin/moderation/cases/${CASE_ID}/action-records`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CASE_NOT_FOUND');
  });

  it('returns chat dismissal audit metadata without sensitive evidence (#397)', async () => {
    vi.spyOn(moderationRepository, 'findById').mockResolvedValue(chatCase);
    vi.spyOn(moderationRepository, 'listActionRecordsForCase').mockResolvedValue([
      {
        id: 'rec-chat-dismiss',
        actor_id: adminParticipant.id,
        target_type: 'moderation_chat_message',
        target_id: chatCase.target_id,
        action_type: 'moderation_dismiss',
        reason: 'Reviewed; no actionable violation',
        outcome: 'case_dismissed',
        safe_state_summary: {
          caseId: chatCase.id,
          targetType: 'chat_message',
          targetId: chatCase.target_id,
          action: 'dismiss',
          email: 'must-not-leak@example.test',
          otp_hash: 'must-not-leak',
          refresh_token: 'must-not-leak',
          private_note: 'must-not-leak',
        },
        created_at: '2026-11-10T13:00:00.000Z',
      },
    ]);

    const res = await request(app)
      .get(`/api/admin/moderation/cases/${CASE_ID}/action-records`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.records).toEqual([
      expect.objectContaining({
        id: 'rec-chat-dismiss',
        actionType: 'moderation_dismiss',
        reason: 'Reviewed; no actionable violation',
        outcome: 'case_dismissed',
        targetType: 'moderation_chat_message',
        targetId: chatCase.target_id,
        createdAt: '2026-11-10T13:00:00.000Z',
        safeStateSummary: expect.objectContaining({
          caseId: chatCase.id,
          targetType: 'chat_message',
          targetId: chatCase.target_id,
          action: 'dismiss',
          credentialsIncluded: false,
          privateContactsIncluded: false,
          privateWorkspaceAccessGranted: false,
        }),
      }),
    ]);
    expect(new Date(res.body.records[0].createdAt).toISOString()).toBe(
      '2026-11-10T13:00:00.000Z'
    );
    expect(JSON.stringify(res.body)).not.toMatch(
      /must-not-leak|email|otp_hash|refresh_token|private_note|message.?body/i
    );
  });

  it('denies a visitor before loading chat action records (#397)', async () => {
    const caseLookup = vi.spyOn(moderationRepository, 'findById');
    const recordsLookup = vi.spyOn(moderationRepository, 'listActionRecordsForCase');

    const res = await request(app).get(
      `/api/admin/moderation/cases/${CASE_ID}/action-records`
    );

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(caseLookup).not.toHaveBeenCalled();
    expect(recordsLookup).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toMatch(/message.?body|handle|channel|thread/i);
  });

  it('denies a PART before loading chat action records (#397)', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'fb-part-1',
      email: 'part@example.com',
      role: 'PART',
      auth_time: AUTH_TIME,
      [MFA_CLAIM]: AUTH_TIME,
    } as unknown as DecodedIdToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
      ...adminParticipant,
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      firebase_uid: 'fb-part-1',
      email: 'part@example.com',
      role: 'PART',
    });
    const caseLookup = vi.spyOn(moderationRepository, 'findById');
    const recordsLookup = vi.spyOn(moderationRepository, 'listActionRecordsForCase');

    const res = await request(app)
      .get(`/api/admin/moderation/cases/${CASE_ID}/action-records`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_ROLE');
    expect(caseLookup).not.toHaveBeenCalled();
    expect(recordsLookup).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toMatch(/message.?body|handle|channel|thread/i);
  });
});

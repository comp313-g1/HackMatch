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
});

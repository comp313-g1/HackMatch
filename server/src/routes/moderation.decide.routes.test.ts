import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { getSupabaseClient } from '../db/client.js';
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

vi.mock('../db/client.js', () => ({
  getSupabaseClient: vi.fn(),
}));

const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;
const CASE_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
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
  target_id: TEAM_ID,
  reason: 'Spam',
  status: 'Open',
  created_by: adminParticipant.id,
  report_count: 0,
  flagged_url: null,
  created_at: '2026-10-18T10:00:00.000Z',
  updated_at: '2026-10-18T10:00:00.000Z',
};

const sampleTeam: Team = {
  id: TEAM_ID,
  event_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  owner_participant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'Phishy',
  pitch: 'Bad',
  goal: 'Learning',
  commitment_hours: 10,
  communication_link: 'https://evil.example/x',
  recruitment_status: 'Open',
  locked_at: null,
  disbanded_at: null,
  moderation_status: 'None',
  moderation_hidden_at: null,
  created_at: '2026-10-18T01:00:00.000Z',
  updated_at: '2026-10-18T01:00:00.000Z',
};

describe('POST /api/admin/moderation/cases/:caseId/decide (US-026 / #242)', () => {
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

    vi.mocked(getSupabaseClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'teams') {
          return {
            update: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: {}, error: null })),
            })),
          };
        }
        if (table === 'participant_notifications') {
          return { insert: vi.fn(async () => ({ data: {}, error: null })) };
        }
        if (table === 'events') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: null, error: null })),
              })),
            })),
          };
        }
        return {};
      }),
    } as never);
  });

  it('rejects missing reason and echoes submitted draft', async () => {
    const body = { action: 'hide', reason: '   ' };
    const res = await request(app)
      .post(`/api/admin/moderation/cases/${CASE_ID}/decide`)
      .set('Authorization', AUTH)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors.reason).toBeTruthy();
    expect(res.body.submitted).toEqual(body);
  });

  it('hides a team listing for ADMIN with reason', async () => {
    vi.spyOn(moderationRepository, 'findById').mockResolvedValue(openCase);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
    vi.spyOn(moderationRepository, 'insertActionRecord').mockResolvedValue({
      id: 'rec-1',
      actor_id: adminParticipant.id,
      target_type: 'moderation_team',
      target_id: TEAM_ID,
      action_type: 'moderation_hide',
      reason: 'Phishing listing',
      outcome: 'listing_hidden',
      safe_state_summary: {},
      created_at: '2026-10-18T12:00:00.000Z',
    });
    vi.spyOn(moderationRepository, 'resolveCase').mockResolvedValue({
      ...openCase,
      status: 'Resolved',
      last_action_type: 'hide',
      resolved_at: '2026-10-18T12:00:00.000Z',
    });

    const res = await request(app)
      .post(`/api/admin/moderation/cases/${CASE_ID}/decide`)
      .set('Authorization', AUTH)
      .send({ action: 'hide', reason: 'Phishing listing' });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('hide');
    expect(res.body.outcome).toBe('listing_hidden');
    expect(res.body.case.status).toBe('Resolved');
    expect(res.body.safeStateSummary.credentialsIncluded).toBe(false);
  });

  it('returns 403 for PART callers', async () => {
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

    const res = await request(app)
      .post(`/api/admin/moderation/cases/${CASE_ID}/decide`)
      .set('Authorization', AUTH)
      .send({ action: 'dismiss', reason: 'Nope' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_ROLE');
  });
});

/**
 * US-026 / #246 — Moderation actions and access integration suite
 *
 * Exercises the full Express pipeline (Firebase → MFA → active → ADMIN)
 * for queue, case open, decide actions, and action-record reads.
 *
 * Maps to acceptance tests:
 *   US-026-T1 newest-first queue with target/reason/time
 *   US-026-T2 hide with reason → listing_hidden + membershipsPreserved + audit record
 *   US-026-T3 disable_url → link removed + removal notice
 *   US-026-T4 decide without reason → 400 VALIDATION_ERROR (draft echoed)
 *   US-026-T5 PART / Visitor denied on every moderation endpoint
 *   US-026-T6 target detail omits credentials / private contacts
 *
 * Also covers invalid input, boundary reason length, CASE_CLOSED / CASE_NOT_FOUND,
 * and forged-role failure handling with repeatable evidence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { getSupabaseClient } from '../db/client.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import { MODERATION_REASON_MAX } from '../validators/moderation.validator.js';
import { filterOpenTeams } from '../services/openTeams.js';
import type { ModerationCase, Participant, Team } from '../db/types.js';
import type { OpenTeamRecord } from '../db/teams.repository.js';

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

const sampleTeam: Team = {
  id: TEAM_ID,
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
  moderation_status: 'None',
  moderation_hidden_at: null,
  link_removal_notice: null,
  created_at: '2026-10-18T01:00:00.000Z',
  updated_at: '2026-10-18T01:00:00.000Z',
};

const olderCase: ModerationCase = {
  id: CASE_ID,
  target_type: 'team',
  target_id: TEAM_ID,
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
  target_type: 'url',
  target_id: TEAM_ID,
  reason: 'Newer phishing URL',
  status: 'Open',
  created_by: adminParticipant.id,
  report_count: 1,
  flagged_url: 'https://evil.example/phish',
  created_at: '2026-10-18T12:00:00.000Z',
  updated_at: '2026-10-18T12:00:00.000Z',
};

const moderationEndpoints = [
  { method: 'get' as const, path: '/api/admin/moderation/cases', label: 'queue' },
  {
    method: 'get' as const,
    path: `/api/admin/moderation/cases/${CASE_ID}`,
    label: 'target-detail',
  },
  { method: 'post' as const, path: '/api/admin/moderation/cases', label: 'create' },
  {
    method: 'get' as const,
    path: `/api/admin/moderation/cases/${CASE_ID}/action-records`,
    label: 'action-records',
  },
  {
    method: 'post' as const,
    path: `/api/admin/moderation/cases/${CASE_ID}/decide`,
    label: 'decide',
  },
];

function adminToken(): DecodedIdToken {
  return {
    uid: 'fb-admin-1',
    email: 'admin@example.com',
    role: 'ADMIN',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;
}

function partToken(): DecodedIdToken {
  return {
    uid: 'fb-part-1',
    email: 'part@example.com',
    role: 'PART',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;
}

function mockSupabase(): void {
  vi.mocked(getSupabaseClient).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'teams' || table === 'participant_profiles') {
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
              maybeSingle: vi.fn(async () => ({
                data: {
                  id: sampleTeam.event_id,
                  is_link_disabled: false,
                  official_url: 'https://other.example',
                },
                error: null,
              })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: {}, error: null })),
          })),
        };
      }
      return {};
    }),
  } as never);
}

function mockDecideSuccess(action: string, outcome: string, caseRow: ModerationCase = olderCase): void {
  vi.spyOn(moderationRepository, 'findById').mockResolvedValue(caseRow);
  vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
  vi.spyOn(moderationRepository, 'insertActionRecord').mockResolvedValue({
    id: 'rec-1',
    actor_id: adminParticipant.id,
    target_type: `moderation_${caseRow.target_type}`,
    target_id: caseRow.target_id,
    action_type: `moderation_${action}`,
    reason: 'Evidence reason',
    outcome,
    safe_state_summary: {},
    created_at: '2026-10-18T12:30:00.000Z',
  });
  vi.spyOn(moderationRepository, 'resolveCase').mockResolvedValue({
    ...caseRow,
    status: action === 'dismiss' ? 'Dismissed' : 'Resolved',
    last_action_type: action as ModerationCase['last_action_type'],
    resolved_at: '2026-10-18T12:30:00.000Z',
  });
}

describe('Moderation actions and access integration (US-026 / #246)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(adminToken());
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(adminParticipant);
    vi.spyOn(participantsRepository, 'findById').mockImplementation(async (id) => {
      if (id === adminParticipant.id) return adminParticipant;
      if (id === partParticipant.id) return partParticipant;
      return null;
    });
    mockSupabase();
  });

  describe('US-026-T5 unauthorized access (Visitor / PART)', () => {
    it.each(moderationEndpoints)(
      'Visitor receives 401 UNAUTHORIZED on $label',
      async ({ method, path }) => {
        const req = request(app)[method](path);
        if (method === 'post') {
          req.send(
            path.endsWith('/decide')
              ? { action: 'hide', reason: 'Nope' }
              : {
                  targetType: 'team',
                  targetId: TEAM_ID,
                  reason: 'Nope',
                }
          );
        }
        const res = await req;
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('UNAUTHORIZED');
        expect(res.headers['cache-control']).toMatch(/no-store/i);
      }
    );

    it.each(moderationEndpoints)(
      'PART receives 403 FORBIDDEN_ROLE on $label',
      async ({ method, path }) => {
        mockVerifyIdToken.mockResolvedValue(partToken());
        vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(partParticipant);

        const req = request(app)[method](path).set('Authorization', AUTH);
        if (method === 'post') {
          req.send(
            path.endsWith('/decide')
              ? { action: 'hide', reason: 'Should not work' }
              : {
                  targetType: 'team',
                  targetId: TEAM_ID,
                  reason: 'Should not work',
                }
          );
        }
        const res = await req;
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN_ROLE');
      }
    );
  });

  describe('US-026-T1 happy path — newest-first queue', () => {
    it('returns cases newest first with target, reason, time, and reportCount', async () => {
      vi.spyOn(moderationRepository, 'listNewestFirst').mockResolvedValue([newerCase, olderCase]);

      const res = await request(app)
        .get('/api/admin/moderation/cases')
        .set('Authorization', AUTH);

      expect(res.status).toBe(200);
      expect(res.body.cases).toHaveLength(2);
      expect(res.body.cases[0].id).toBe(newerCase.id);
      expect(res.body.cases[0].reason).toBe(newerCase.reason);
      expect(res.body.cases[0].createdAt).toBe(newerCase.created_at);
      expect(res.body.cases[0].reportCount).toBe(1);
      expect(res.body.cases[1].id).toBe(olderCase.id);
    });
  });

  describe('US-026-T2 / T3 happy path — hide and disable_url with audit records', () => {
    it('hides a listing, records membershipsPreserved, and writes a safe action record', async () => {
      const insertSpy = vi.fn();
      mockDecideSuccess('hide', 'listing_hidden');
      vi.spyOn(moderationRepository, 'insertActionRecord').mockImplementation(async (row) => {
        insertSpy(row);
        return {
          id: 'rec-hide',
          ...row,
          created_at: '2026-10-18T12:30:00.000Z',
        };
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
      expect(res.body.safeStateSummary.privateContactsIncluded).toBe(false);
      expect(res.body.safeStateSummary.effects).toEqual(
        expect.objectContaining({ membershipsPreserved: true, moderationStatus: 'Hidden' })
      );
      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: 'moderation_hide',
          reason: 'Phishing listing',
          outcome: 'listing_hidden',
        })
      );

      // Discovery exclusion evidence (same rule used by open-teams boards).
      const hiddenRecord: OpenTeamRecord = {
        team: {
          ...sampleTeam,
          moderation_status: 'Hidden',
          moderation_hidden_at: '2026-10-18T12:30:00.000Z',
        },
        event: { status: 'Published', end_date: '2099-01-01T00:00:00.000Z' },
        openVacancies: [{ id: 'v1', role: 'Frontend', skills: ['React'] }],
        members: [
          {
            participant_id: partParticipant.id,
            role: 'Owner',
            full_name: 'Ada Lovelace',
            handle: 'ada',
          },
        ],
      };
      expect(
        filterOpenTeams([hiddenRecord], { skills: [], role: null, goal: null, minSlots: 1 })
      ).toHaveLength(0);
    });

    it('disables a malicious URL and returns link removal notice', async () => {
      mockDecideSuccess('disable_url', 'url_disabled', newerCase);

      const res = await request(app)
        .post(`/api/admin/moderation/cases/${newerCase.id}/decide`)
        .set('Authorization', AUTH)
        .send({ action: 'disable_url', reason: 'Confirmed phishing URL' });

      expect(res.status).toBe(200);
      expect(res.body.action).toBe('disable_url');
      expect(res.body.outcome).toBe('url_disabled');
      expect(res.body.safeStateSummary.effects).toEqual(
        expect.objectContaining({
          communicationLinkRemoved: true,
          membershipsPreserved: true,
          linkRemovalNotice: expect.stringMatching(/removed by platform moderation/i),
        })
      );
    });

    it('warns a team listing and records warning_recorded outcome', async () => {
      mockDecideSuccess('warn', 'warning_recorded');

      const res = await request(app)
        .post(`/api/admin/moderation/cases/${CASE_ID}/decide`)
        .set('Authorization', AUTH)
        .send({ action: 'warn', reason: 'Borderline pitch language' });

      expect(res.status).toBe(200);
      expect(res.body.action).toBe('warn');
      expect(res.body.outcome).toBe('warning_recorded');
      expect(res.body.safeStateSummary.effects).toEqual(
        expect.objectContaining({ moderationStatus: 'Warned', ownerNotified: true })
      );
    });
  });

  describe('US-026-T4 invalid input — mandatory reason', () => {
    it('rejects decide without reason and echoes the submitted draft', async () => {
      const body = { action: 'hide', reason: '   ' };
      const res = await request(app)
        .post(`/api/admin/moderation/cases/${CASE_ID}/decide`)
        .set('Authorization', AUTH)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.reason).toMatch(/required/i);
      expect(res.body.submitted).toEqual(body);
    });

    it('rejects unknown decide actions and preserves submitted fields', async () => {
      const body = { action: 'ban_forever', reason: 'Nope' };
      const res = await request(app)
        .post(`/api/admin/moderation/cases/${CASE_ID}/decide`)
        .set('Authorization', AUTH)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.action).toBeTruthy();
      expect(res.body.submitted).toEqual(body);
    });
  });

  describe('US-026-T6 private data boundaries on target detail', () => {
    it('returns sanitized team detail without credentials or private contacts', async () => {
      vi.spyOn(moderationRepository, 'findById').mockResolvedValue(olderCase);
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(partParticipant);
      vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
        participant_id: partParticipant.id,
        handle: 'ada',
        primary_role: 'Frontend',
        institution: 'UofT',
        shared_contact_handle: 'secret-discord#1234',
        created_at: '2026-10-18T00:00:00.000Z',
        updated_at: '2026-10-18T00:00:00.000Z',
      });

      const res = await request(app)
        .get(`/api/admin/moderation/cases/${CASE_ID}`)
        .set('Authorization', AUTH);

      expect(res.status).toBe(200);
      expect(res.body.target.type).toBe('team');
      expect(res.body.target.team.name).toBe(sampleTeam.name);
      const payload = JSON.stringify(res.body);
      expect(payload).not.toMatch(/secret-discord/);
      expect(payload).not.toMatch(/part@example\.com/);
      expect(payload).not.toMatch(/firebase_uid|fb-part-1/);
      expect(payload).not.toMatch(/otp|password|credential/i);
    });
  });

  describe('boundary conditions', () => {
    it(`rejects decide reason longer than ${MODERATION_REASON_MAX} characters`, async () => {
      const body = { action: 'dismiss', reason: 'x'.repeat(MODERATION_REASON_MAX + 1) };
      const res = await request(app)
        .post(`/api/admin/moderation/cases/${CASE_ID}/decide`)
        .set('Authorization', AUTH)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.errors.reason).toMatch(/at most/);
      expect(res.body.submitted.reason).toHaveLength(MODERATION_REASON_MAX + 1);
    });

    it('accepts reason at exact MODERATION_REASON_MAX length (boundary)', async () => {
      mockDecideSuccess('dismiss', 'case_dismissed');
      const reason = 'r'.repeat(MODERATION_REASON_MAX);

      const res = await request(app)
        .post(`/api/admin/moderation/cases/${CASE_ID}/decide`)
        .set('Authorization', AUTH)
        .send({ action: 'dismiss', reason });

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('case_dismissed');
    });

    it('rejects forged ADMIN claim when DB role is PART (ROLE_MISMATCH)', async () => {
      mockVerifyIdToken.mockResolvedValue({
        ...adminToken(),
        uid: 'fb-part-1',
        email: 'part@example.com',
      } as DecodedIdToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(partParticipant);

      const res = await request(app)
        .get('/api/admin/moderation/cases')
        .set('Authorization', AUTH);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ROLE_MISMATCH');
    });
  });

  describe('failure handling', () => {
    it('returns 404 CASE_NOT_FOUND for decide on a missing case', async () => {
      vi.spyOn(moderationRepository, 'findById').mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/admin/moderation/cases/${CASE_ID}/decide`)
        .set('Authorization', AUTH)
        .send({ action: 'dismiss', reason: 'Cleanup' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('CASE_NOT_FOUND');
    });

    it('returns 409 CASE_CLOSED when deciding an already resolved case', async () => {
      vi.spyOn(moderationRepository, 'findById').mockResolvedValue({
        ...olderCase,
        status: 'Resolved',
        last_action_type: 'hide',
        resolved_at: '2026-10-18T11:00:00.000Z',
      });

      const res = await request(app)
        .post(`/api/admin/moderation/cases/${CASE_ID}/decide`)
        .set('Authorization', AUTH)
        .send({ action: 'warn', reason: 'Too late' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CASE_CLOSED');
    });

    it('returns 404 TARGET_NOT_FOUND when hide target team is missing', async () => {
      vi.spyOn(moderationRepository, 'findById').mockResolvedValue(olderCase);
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/admin/moderation/cases/${CASE_ID}/decide`)
        .set('Authorization', AUTH)
        .send({ action: 'hide', reason: 'Missing team' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('TARGET_NOT_FOUND');
    });

    it('returns 403 MFA_REQUIRED when ADMIN lacks email OTP claim', async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: 'fb-admin-1',
        email: 'admin@example.com',
        role: 'ADMIN',
        auth_time: AUTH_TIME,
      } as unknown as DecodedIdToken);

      const res = await request(app)
        .post(`/api/admin/moderation/cases/${CASE_ID}/decide`)
        .set('Authorization', AUTH)
        .send({ action: 'hide', reason: 'Needs MFA' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
    });
  });
});

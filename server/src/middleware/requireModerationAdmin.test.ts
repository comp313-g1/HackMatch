import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import { requireFirebaseAuth } from './requireFirebaseAuth.js';
import { requireMfa } from './requireMfa.js';
import { requireActiveAccount } from './requireActiveAccount.js';
import { requireAdminRole } from './requireRole.js';
import { requireModerationAdmin } from './requireModerationAdmin.js';
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
  pitch: 'Join us',
  goal: 'Learning',
  commitment_hours: 10,
  communication_link: 'https://evil.example/phish',
  recruitment_status: 'Open',
  locked_at: null,
  disbanded_at: null,
  created_at: '2026-10-18T01:00:00.000Z',
  updated_at: '2026-10-18T01:00:00.000Z',
};

const openCase: ModerationCase = {
  id: CASE_ID,
  target_type: 'team',
  target_id: TEAM_ID,
  reason: 'Suspicious link',
  status: 'Open',
  created_by: adminParticipant.id,
  report_count: 0,
  flagged_url: null,
  created_at: '2026-10-18T10:00:00.000Z',
  updated_at: '2026-10-18T10:00:00.000Z',
};

function token(claims: Record<string, unknown>): DecodedIdToken {
  return {
    uid: String(claims.uid ?? 'fb-admin-1'),
    email: String(claims.email ?? 'admin@example.com'),
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
    ...claims,
  } as unknown as DecodedIdToken;
}

const moderationPaths = [
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

const createBody = {
  targetType: 'team',
  targetId: TEAM_ID,
  reason: 'Suspicious communication link',
};

describe('requireModerationAdmin composition (#240 / US-026 AC 5)', () => {
  it('exports Firebase → MFA → active account → ADMIN role in that order', () => {
    expect(requireModerationAdmin).toEqual([
      requireFirebaseAuth,
      requireMfa,
      requireActiveAccount,
      requireAdminRole,
    ]);
  });
});

describe('Protect moderation routes with ADMIN RBAC (US-026 / #240 / FR-082)', () => {
  let listSpy: ReturnType<typeof vi.spyOn>;
  let findCaseSpy: ReturnType<typeof vi.spyOn>;
  let createSpy: ReturnType<typeof vi.spyOn>;
  let findTeamSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(token({ role: 'ADMIN', uid: 'fb-admin-1' }));
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(adminParticipant);
    vi.spyOn(participantsRepository, 'findById').mockImplementation(async (id) => {
      if (id === adminParticipant.id) return adminParticipant;
      if (id === partParticipant.id) return partParticipant;
      return null;
    });
    listSpy = vi.spyOn(moderationRepository, 'listNewestFirst').mockResolvedValue([]);
    findCaseSpy = vi.spyOn(moderationRepository, 'findById').mockResolvedValue(openCase);
    createSpy = vi.spyOn(moderationRepository, 'createCase').mockResolvedValue(openCase);
    findTeamSpy = vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
      participant_id: partParticipant.id,
      handle: 'ada',
      primary_role: 'Backend',
      institution: 'UofT',
      shared_contact_handle: 'secret-discord',
      created_at: '2026-10-18T00:00:00.000Z',
      updated_at: '2026-10-18T00:00:00.000Z',
    });
  });

  const decideBody = { action: 'dismiss', reason: 'Not actionable' };

  function call(
    method: 'get' | 'post',
    path: string,
    opts?: { auth?: string; body?: unknown }
  ) {
    const req = request(app)[method](path);
    if (opts?.auth) req.set('Authorization', opts.auth);
    if (method === 'post') {
      const defaultBody = path.endsWith('/decide') ? decideBody : createBody;
      req.send(opts?.body ?? defaultBody);
    }
    return req;
  }

  function expectHandlersNotReached(): void {
    expect(listSpy).not.toHaveBeenCalled();
    expect(findCaseSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  }

  describe('Visitor (unauthenticated) is denied on every moderation endpoint', () => {
    it.each(moderationPaths)('returns 401 UNAUTHORIZED for $label', async ({ method, path }) => {
      const res = await call(method, path);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(res.headers['cache-control']).toMatch(/no-store/i);
      expectHandlersNotReached();
    });
  });

  describe('PART is denied on every moderation endpoint (US-026-T5)', () => {
    beforeEach(() => {
      mockVerifyIdToken.mockResolvedValue(
        token({ role: 'PART', uid: 'fb-part-1', email: 'part@example.com' })
      );
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(partParticipant);
    });

    it.each(moderationPaths)('returns 403 FORBIDDEN_ROLE for $label', async ({ method, path }) => {
      const res = await call(method, path, { auth: AUTH });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
      expect(res.body.error).toMatch(/permission/i);
      expect(res.headers['cache-control']).toMatch(/no-store/i);
      expectHandlersNotReached();
    });
  });

  describe('forged or demoted ADMIN claims cannot reach moderation handlers', () => {
    it('rejects demoted ADMIN token with 403 ROLE_MISMATCH and skips handlers', async () => {
      mockVerifyIdToken.mockResolvedValue(token({ role: 'ADMIN', uid: 'fb-part-1' }));
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(partParticipant);

      const res = await call('get', '/api/admin/moderation/cases', { auth: AUTH });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ROLE_MISMATCH');
      expectHandlersNotReached();
    });

    it('rejects invalid role claim with 403 INVALID_ROLE_CLAIM', async () => {
      mockVerifyIdToken.mockResolvedValue(token({ role: 'SUPERUSER' }));

      const res = await call('post', '/api/admin/moderation/cases', { auth: AUTH });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INVALID_ROLE_CLAIM');
      expectHandlersNotReached();
    });

    it('never upgrades a missing role claim to ADMIN for moderation access', async () => {
      mockVerifyIdToken.mockResolvedValue(token({ uid: 'fb-admin-1' })); // no role claim
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(adminParticipant);

      const res = await call('get', `/api/admin/moderation/cases/${CASE_ID}`, { auth: AUTH });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ROLE_NOT_ASSIGNED');
      expectHandlersNotReached();
    });
  });

  describe('MFA and suspension still block before ADMIN role succeeds', () => {
    it('returns 403 MFA_REQUIRED when email OTP claim is missing', async () => {
      mockVerifyIdToken.mockResolvedValue(
        token({ role: 'ADMIN', uid: 'fb-admin-1', [MFA_CLAIM]: undefined })
      );

      const res = await call('get', '/api/admin/moderation/cases', { auth: AUTH });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
      expectHandlersNotReached();
    });

    it('returns 403 ACCOUNT_SUSPENDED for a suspended ADMIN before handlers run', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        ...adminParticipant,
        is_suspended: true,
      });

      const res = await call('get', '/api/admin/moderation/cases', { auth: AUTH });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
      expectHandlersNotReached();
    });
  });

  describe('legitimate ADMIN succeeds after RBAC (user-visible success)', () => {
    it('allows ADMIN to read the empty moderation queue', async () => {
      const res = await call('get', '/api/admin/moderation/cases', { auth: AUTH });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ cases: [] });
      expect(listSpy).toHaveBeenCalled();
    });

    it('allows ADMIN to open a case after RBAC passes', async () => {
      const res = await call('post', '/api/admin/moderation/cases', {
        auth: AUTH,
        body: createBody,
      });

      expect(res.status).toBe(201);
      expect(res.body.case.id).toBe(CASE_ID);
      expect(createSpy).toHaveBeenCalled();
      expect(findTeamSpy).toHaveBeenCalledWith(TEAM_ID);
    });

    it('allows ADMIN to load target detail after RBAC passes', async () => {
      const res = await call('get', `/api/admin/moderation/cases/${CASE_ID}`, { auth: AUTH });

      expect(res.status).toBe(200);
      expect(res.body.case.id).toBe(CASE_ID);
      expect(findCaseSpy).toHaveBeenCalledWith(CASE_ID);
    });
  });
});

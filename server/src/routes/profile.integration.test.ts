/**
 * US-006 Profile Management Integration Test Suite.
 *
 * Verifies end-to-end profile lifecycle across full Express middleware pipeline:
 * - Token verification & MFA gate
 * - Role & account active status enforcement
 * - Profile validation & sanitization
 * - Persistence & retrieval in stateful database store
 * - Privacy projections (Visitor anonymization, PART user restrictions, Confirmed Teammate contact disclosure)
 * - Immediate contact revocation upon team removal/leave
 * - Cross-account privilege escalation defense
 *
 * Maps directly to acceptance tests US-006-T1 through US-006-T6, AC 1–5, and FR-013, FR-014, FR-082.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import {
  profileRepository,
  type FullParticipantProfileRecord,
  type UpsertFullProfileInput,
} from '../db/profile.repository.js';
import type {
  Participant,
  ParticipantProfile,
  ParticipantSkill,
  ParticipantPortfolio,
} from '../db/types.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';

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

describe('US-006 Profile Integration Suite (Full Middleware & Privacy Pipeline)', () => {
  const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;

  // In-Memory Stateful Database Store
  let profiles: Map<string, ParticipantProfile>;
  let skills: Map<string, ParticipantSkill[]>;
  let portfolios: Map<string, ParticipantPortfolio[]>;
  let teamMemberships: Array<{ participant_id: string; team_id: string; status: string }>;

  const participant1: Participant = {
    id: 'part-uuid-1',
    firebase_uid: 'fb-part-1',
    email: 'part1@example.com',
    full_name: 'Alice Developer',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    suspended_at: null,
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString(),
  };

  const participant2: Participant = {
    id: 'part-uuid-2',
    firebase_uid: 'fb-part-2',
    email: 'part2@example.com',
    full_name: 'Bob Teammate',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    suspended_at: null,
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString(),
  };

  const participant3: Participant = {
    id: 'part-uuid-3',
    firebase_uid: 'fb-part-3',
    email: 'part3@example.com',
    full_name: 'Charlie Stranger',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    suspended_at: null,
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString(),
  };

  const suspendedParticipant: Participant = {
    id: 'part-uuid-suspended',
    firebase_uid: 'fb-part-suspended',
    email: 'suspended@example.com',
    full_name: 'Suspended User',
    role: 'PART',
    is_verified: true,
    is_suspended: true,
    suspended_at: new Date('2026-02-01T00:00:00Z').toISOString(),
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-02-01T00:00:00Z').toISOString(),
  };

  const adminParticipant: Participant = {
    id: 'admin-uuid-1',
    firebase_uid: 'fb-admin-1',
    email: 'admin@example.com',
    full_name: 'Admin User',
    role: 'ADMIN',
    is_verified: true,
    is_suspended: false,
    suspended_at: null,
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString(),
  };

  const allParticipants = [
    participant1,
    participant2,
    participant3,
    suspendedParticipant,
    adminParticipant,
  ];

  const buildClaims = (p: Participant, overrides: Record<string, unknown> = {}) => ({
    uid: p.firebase_uid,
    email: p.email,
    email_verified: p.is_verified,
    role: p.role,
    auth_time: AUTH_TIME,
    iat: AUTH_TIME,
    exp: AUTH_TIME + 3600,
    firebase: { sign_in_provider: 'password', identities: {} },
    [MFA_CLAIM]: AUTH_TIME,
    ...overrides,
  });

  const authGet = (path: string, tokenUser: Participant, extraHeaders: Record<string, string> = {}) => {
    mockVerifyIdToken.mockImplementation(async (tok: string) => {
      if (tok === tokenUser.firebase_uid) return buildClaims(tokenUser);
      throw new Error('Invalid token');
    });
    return request(app)
      .get(path)
      .set('Authorization', `Bearer ${tokenUser.firebase_uid}`)
      .set(extraHeaders);
  };

  const authPut = (
    path: string,
    tokenUser: Participant,
    body: Record<string, unknown>,
    extraHeaders: Record<string, string> = {}
  ) => {
    mockVerifyIdToken.mockImplementation(async (tok: string) => {
      if (tok === tokenUser.firebase_uid) return buildClaims(tokenUser);
      throw new Error('Invalid token');
    });
    return request(app)
      .put(path)
      .set('Authorization', `Bearer ${tokenUser.firebase_uid}`)
      .set(extraHeaders)
      .send(body);
  };

  beforeEach(() => {
    vi.clearAllMocks();

    profiles = new Map();
    skills = new Map();
    portfolios = new Map();
    teamMemberships = [];

    // Pre-populate participant 2 initial profile
    profiles.set(participant2.id, {
      participant_id: participant2.id,
      handle: 'bob_builder',
      primary_role: 'Frontend',
      institution: 'University of Toronto',
      shared_contact_handle: '@bob_discord',
      created_at: new Date('2026-01-02T00:00:00Z').toISOString(),
      updated_at: new Date('2026-01-02T00:00:00Z').toISOString(),
    });
    skills.set(participant2.id, [
      {
        id: 'skill-b1',
        participant_id: participant2.id,
        skill_name: 'React',
        created_at: new Date('2026-01-02T00:00:00Z').toISOString(),
      },
      {
        id: 'skill-b2',
        participant_id: participant2.id,
        skill_name: 'TypeScript',
        created_at: new Date('2026-01-02T00:00:00Z').toISOString(),
      },
    ]);
    portfolios.set(participant2.id, [
      {
        id: 'port-b1',
        participant_id: participant2.id,
        url: 'https://github.com/bob-builder',
        label: 'GitHub',
        created_at: new Date('2026-01-02T00:00:00Z').toISOString(),
        updated_at: new Date('2026-01-02T00:00:00Z').toISOString(),
      },
    ]);

    // Mock participants repository with in-memory lookup
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockImplementation(async (uid) => {
      return allParticipants.find((p) => p.firebase_uid === uid) ?? null;
    });

    vi.spyOn(participantsRepository, 'findById').mockImplementation(async (id) => {
      return allParticipants.find((p) => p.id === id) ?? null;
    });

    // Mock profile repository with stateful in-memory implementation
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockImplementation(
      async (participantId) => profiles.get(participantId) ?? null
    );

    vi.spyOn(profileRepository, 'findByHandle').mockImplementation(async (handle) => {
      const lower = handle.trim().toLowerCase();
      for (const p of profiles.values()) {
        if (p.handle && p.handle.toLowerCase() === lower) {
          return p;
        }
      }
      return null;
    });

    vi.spyOn(profileRepository, 'findSkillsByParticipantId').mockImplementation(
      async (participantId) => skills.get(participantId) ?? []
    );

    vi.spyOn(profileRepository, 'findPortfoliosByParticipantId').mockImplementation(
      async (participantId) => portfolios.get(participantId) ?? []
    );

    vi.spyOn(profileRepository, 'getFullProfile').mockImplementation(
      async (participantId): Promise<FullParticipantProfileRecord> => ({
        profile: profiles.get(participantId) ?? null,
        skills: skills.get(participantId) ?? [],
        portfolios: portfolios.get(participantId) ?? [],
      })
    );

    vi.spyOn(profileRepository, 'upsertFullProfile').mockImplementation(
      async (input: UpsertFullProfileInput): Promise<FullParticipantProfileRecord> => {
        const now = new Date().toISOString();
        const existing = profiles.get(input.participantId);
        const savedProfile: ParticipantProfile = {
          participant_id: input.participantId,
          handle: input.handle,
          primary_role: input.primaryRole,
          institution: input.institution,
          shared_contact_handle: input.sharedContactHandle,
          created_at: existing?.created_at ?? now,
          updated_at: now,
        };
        profiles.set(input.participantId, savedProfile);

        const newSkills: ParticipantSkill[] = input.skills.map((s, idx) => ({
          id: `skill-${idx}-${Date.now()}`,
          participant_id: input.participantId,
          skill_name: s,
          created_at: now,
        }));
        skills.set(input.participantId, newSkills);

        const newPortfolios: ParticipantPortfolio[] = input.portfolioLinks.map((p, idx) => ({
          id: `port-${idx}-${Date.now()}`,
          participant_id: input.participantId,
          url: p.url,
          label: p.label ?? null,
          created_at: now,
          updated_at: now,
        }));
        portfolios.set(input.participantId, newPortfolios);

        return {
          profile: savedProfile,
          skills: newSkills,
          portfolios: newPortfolios,
        };
      }
    );

    vi.spyOn(profileRepository, 'areConfirmedTeammates').mockImplementation(
      async (viewerId, targetId) => {
        if (!viewerId || !targetId) return false;
        if (viewerId === targetId) return true;

        const viewerTeams = teamMemberships
          .filter((m) => m.participant_id === viewerId && m.status === 'Confirmed')
          .map((m) => m.team_id);

        if (viewerTeams.length === 0) return false;

        return teamMemberships.some(
          (m) =>
            m.participant_id === targetId &&
            m.status === 'Confirmed' &&
            viewerTeams.includes(m.team_id)
        );
      }
    );
  });

  describe('US-006-T1: Valid profile update persistence and retrieval', () => {
    it('persists valid role, skills, institution, and HTTPS portfolio URL; returns on subsequent view', async () => {
      const updatePayload = {
        handle: 'alice_dev',
        primaryRole: 'Backend',
        institution: 'Centennial College',
        skills: ['Node.js', 'PostgreSQL', 'Docker'],
        portfolioLinks: [
          { url: 'https://github.com/alice', label: 'GitHub Profile' },
          { url: 'https://alice.dev', label: 'Personal Portfolio' },
        ],
        sharedContactHandle: '@alice_chat',
      };

      // Update via PUT /api/profiles/me
      const putRes = await authPut('/api/profiles/me', participant1, updatePayload);
      expect(putRes.status).toBe(200);
      expect(putRes.body.message).toBe('Profile updated successfully.');
      expect(putRes.body.profile).toMatchObject({
        viewerCategory: 'OWNER',
        displayName: 'Alice Developer',
        handle: 'alice_dev',
        primaryRole: 'Backend',
        institution: 'Centennial College',
        skills: ['Node.js', 'PostgreSQL', 'Docker'],
        skillsSelfDeclared: true,
        sharedContactHandle: '@alice_chat',
      });
      expect(putRes.body.profile.portfolioLinks).toHaveLength(2);
      expect(putRes.body.profile.portfolioLinks[0]).toEqual({
        url: 'https://github.com/alice',
        label: 'GitHub Profile',
        isSelfDeclared: true,
      });

      // Verify immediate retrieval via GET /api/profiles/me
      const getMeRes = await authGet('/api/profiles/me', participant1);
      expect(getMeRes.status).toBe(200);
      expect(getMeRes.body.profile.handle).toBe('alice_dev');
      expect(getMeRes.body.profile.skills).toEqual(['Node.js', 'PostgreSQL', 'Docker']);
      expect(getMeRes.body.profile.sharedContactHandle).toBe('@alice_chat');
      expect(getMeRes.headers['cache-control']).toBe('no-store');

      // Verify in-memory stateful store was updated
      expect(profiles.get(participant1.id)?.handle).toBe('alice_dev');
      expect(skills.get(participant1.id)?.map((s) => s.skill_name)).toEqual([
        'Node.js',
        'PostgreSQL',
        'Docker',
      ]);
      expect(portfolios.get(participant1.id)).toHaveLength(2);
    });
  });

  describe('US-006-T2: Invalid role rejection', () => {
    it('returns 400 Bad Request with field error when role is invalid and leaves previous profile unchanged', async () => {
      const initialProfile = profiles.get(participant2.id);

      const invalidPayload = {
        primaryRole: 'Chief Technology Wizard', // Not in canonical allowed list
      };

      const res = await authPut('/api/profiles/me', participant2, invalidPayload);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.primaryRole).toMatch(/must be one of/i);

      // Verify previous profile in store is completely intact
      expect(profiles.get(participant2.id)).toEqual(initialProfile);
    });
  });

  describe('US-006-T3: Non-HTTPS portfolio URL rejection', () => {
    it('returns 400 Bad Request when portfolio URL is http:// or raw string and leaves data unchanged', async () => {
      const initialPortfolios = portfolios.get(participant2.id);

      // Attempt insecure http:// URL
      const httpPayload = {
        portfolioLinks: [{ url: 'http://insecure.example.com' }],
      };
      const httpRes = await authPut('/api/profiles/me', participant2, httpPayload);
      expect(httpRes.status).toBe(400);
      expect(httpRes.body.code).toBe('VALIDATION_ERROR');
      expect(httpRes.body.errors.portfolioLinks).toMatch(/valid https urls/i);

      // Attempt raw string without protocol
      const rawPayload = {
        portfolioLinks: [{ url: 'not-even-a-url' }],
      };
      const rawRes = await authPut('/api/profiles/me', participant2, rawPayload);
      expect(rawRes.status).toBe(400);
      expect(rawRes.body.errors.portfolioLinks).toMatch(/valid https urls/i);

      // Verify store unchanged
      expect(portfolios.get(participant2.id)).toEqual(initialPortfolios);
    });
  });

  describe('US-006-T4: Visitor profile access anonymization & privacy boundaries', () => {
    it('returns anonymized preview without member handle, displayName, portfolio links, or contact handle to unauthenticated visitor', async () => {
      const res = await request(app).get(`/api/profiles/${participant2.id}/preview`);

      expect(res.status).toBe(200);
      expect(res.body.preview).toEqual({
        viewerCategory: 'VISITOR',
        isAnonymized: true,
        displayLabel: 'Anonymous Participant',
        primaryRole: 'Frontend',
        skillCount: 2,
        notice: expect.stringContaining('Sign in with a verified Participant account'),
      });
      expect(res.body.preview.handle).toBeUndefined();
      expect(res.body.preview.displayName).toBeUndefined();
      expect(res.body.preview.portfolioLinks).toBeUndefined();
      expect(res.body.preview.sharedContactHandle).toBeUndefined();
      expect(res.body.preview.email).toBeUndefined();
    });

    it('rejects unauthenticated requests to full candidate profile endpoint with 401', async () => {
      const res = await request(app).get(`/api/profiles/${participant2.id}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('US-006-T5: Confirmed teammate contact visibility & immediate revocation upon team removal', () => {
    it('reveals shared contact to confirmed teammate; immediately revokes on removal', async () => {
      // Step 1: Establish confirmed team membership
      teamMemberships = [
        { participant_id: participant1.id, team_id: 'hack-team-101', status: 'Confirmed' },
        { participant_id: participant2.id, team_id: 'hack-team-101', status: 'Confirmed' },
      ];

      // Step 2: Teammate views profile -> sharedContactHandle is visible
      const teammateRes = await authGet(`/api/profiles/${participant2.id}`, participant1);
      expect(teammateRes.status).toBe(200);
      expect(teammateRes.body.profile.viewerCategory).toBe('CONFIRMED_TEAMMATE');
      expect(teammateRes.body.profile.handle).toBe('bob_builder');
      expect(teammateRes.body.profile.sharedContactHandle).toBe('@bob_discord');
      expect(teammateRes.body.profile.sharedContactAudienceNotice).toMatch(/confirmed teammates/i);
      expect(teammateRes.body.profile.email).toBeUndefined(); // Email is never exposed

      // Step 3: Non-teammate views profile -> sharedContactHandle is hidden
      const strangerRes = await authGet(`/api/profiles/${participant2.id}`, participant3);
      expect(strangerRes.status).toBe(200);
      expect(strangerRes.body.profile.viewerCategory).toBe('PART');
      expect(strangerRes.body.profile.handle).toBe('bob_builder');
      expect(strangerRes.body.profile.sharedContactHandle).toBeUndefined();

      // Step 4: Participant 1 is removed from team (status -> 'Removed')
      teamMemberships[0].status = 'Removed';

      // Step 5: Immediate next request from participant 1 has sharedContactHandle revoked
      const revokedRes = await authGet(`/api/profiles/${participant2.id}`, participant1);
      expect(revokedRes.status).toBe(200);
      expect(revokedRes.body.profile.viewerCategory).toBe('PART');
      expect(revokedRes.body.profile.handle).toBe('bob_builder');
      expect(revokedRes.body.profile.sharedContactHandle).toBeUndefined();
      expect(revokedRes.body.profile.sharedContactAudienceNotice).toBeUndefined();
      expect(revokedRes.headers['cache-control']).toBe('no-store');
    });
  });

  describe('US-006-T6: Cross-account update denial & privilege escalation defense', () => {
    it('denies attempt by participant 1 to update participant 2 profile via PUT /api/profiles/:id with 403', async () => {
      const initialProfile = profiles.get(participant2.id);

      const hostilePayload = {
        handle: 'hacked_handle',
        primaryRole: 'Pitch',
      };

      const res = await authPut(`/api/profiles/${participant2.id}`, participant1, hostilePayload);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_PROFILE_EDIT');

      // Verify participant 2 profile was NOT mutated
      expect(profiles.get(participant2.id)).toEqual(initialProfile);
    });

    it('denies attempt to inject mismatched participantId in request body with 403', async () => {
      const initialProfile = profiles.get(participant1.id);

      const hostilePayload = {
        participantId: participant2.id, // Mismatched ID
        handle: 'alice_hijack',
      };

      const res = await authPut('/api/profiles/me', participant1, hostilePayload);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_PROFILE_EDIT');
      expect(profiles.get(participant1.id)).toEqual(initialProfile);
    });

    it('denies role tampering in update body with 403', async () => {
      const hostilePayload = {
        role: 'ADMIN', // Privilege escalation attempt
        handle: 'alice_admin',
      };

      const res = await authPut('/api/profiles/me', participant1, hostilePayload);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE_CHANGE');
    });
  });

  describe('Security & Middleware Guardrails', () => {
    it('denies profile access when MFA claim is missing from ID token (403 MFA_REQUIRED)', async () => {
      mockVerifyIdToken.mockImplementation(async () =>
        buildClaims(participant1, { [MFA_CLAIM]: undefined })
      );

      const res = await request(app)
        .get('/api/profiles/me')
        .set('Authorization', 'Bearer token-without-mfa');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
    });

    it('denies profile access to suspended participants (403 ACCOUNT_SUSPENDED)', async () => {
      const res = await authGet('/api/profiles/me', suspendedParticipant);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('denies profile access to non-PART role (403 FORBIDDEN_ROLE)', async () => {
      const res = await authGet('/api/profiles/me', adminParticipant);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('returns 409 HANDLE_ALREADY_IN_USE when attempting to claim an existing handle', async () => {
      // participant 2 already owns 'bob_builder'
      const res = await authPut('/api/profiles/me', participant1, {
        handle: 'BOB_BUILDER', // Case-insensitive collision
      });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('HANDLE_ALREADY_IN_USE');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { teamWorkspaceRepository } from '../db/teamWorkspace.repository.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import {
  ownerParticipant,
  otherParticipant,
  adminParticipant,
  sampleTeamId,
  sampleTeam,
  sampleParts,
  validOwnerDecodedToken,
  validOtherDecodedToken,
  validAdminDecodedToken,
  validTokenHeader,
  otherTokenHeader,
  adminTokenHeader,
  AUTH_TIME,
} from './team.testUtils.js';
import type {
  Participant,
  ParticipantPortfolio,
  ParticipantProfile,
  ParticipantSkill,
} from '../db/types.js';

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

const workspacePath = `/api/teams/${sampleTeamId}/workspace`;

const lockedTeamViewParts = {
  ...sampleParts,
  team: {
    ...sampleTeam,
    recruitment_status: 'Locked' as const,
    locked_at: '2026-10-25T15:30:00.000Z',
  },
  event: {
    min_team_size: 2,
    max_team_size: 4,
    status: 'Published' as const,
    end_date: '2099-01-01T00:00:00.000Z',
  },
  members: [
    ...sampleParts.members,
    {
      participant_id: otherParticipant.id,
      role: 'Member' as const,
      joined_at: '2026-10-19T10:00:00.000Z',
      handle: 'mate',
      full_name: 'Confirmed Mate',
    },
  ],
};

const mockProfile: ParticipantProfile = {
  participant_id: ownerParticipant.id,
  handle: 'ownerhandle',
  primary_role: 'Backend',
  institution: 'Centennial College',
  shared_contact_handle: '@owner_discord',
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-20T00:00:00Z',
};

const mockSkills: ParticipantSkill[] = [
  {
    id: 'skill-1',
    participant_id: ownerParticipant.id,
    skill_name: 'Node.js',
    created_at: '2026-10-20T00:00:00Z',
  },
];

const mockPortfolios: ParticipantPortfolio[] = [
  {
    id: 'port-1',
    participant_id: ownerParticipant.id,
    url: 'https://github.com/owner',
    label: 'GitHub',
    created_at: '2026-10-20T00:00:00Z',
    updated_at: '2026-10-20T00:00:00Z',
  },
];

describe('GET /api/teams/:teamId/workspace (US-023 / #US-023-T2 / FR-068)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(participantsRepository, 'findById').mockImplementation(async (id: string) => {
      if (id === ownerParticipant.id) return ownerParticipant;
      if (id === otherParticipant.id) return otherParticipant;
      if (id === adminParticipant.id) return adminParticipant;
      return null;
    });
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(lockedTeamViewParts.team);
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue(lockedTeamViewParts);
    vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForTeam').mockResolvedValue([
      ownerParticipant.id,
      otherParticipant.id,
    ]);
    vi.spyOn(profileRepository, 'getFullProfile').mockResolvedValue({
      profile: mockProfile,
      skills: mockSkills,
      portfolios: mockPortfolios,
      history: [],
    });
    vi.spyOn(teamWorkspaceRepository, 'listLinksByTeamId').mockResolvedValue([]);
    vi.spyOn(teamWorkspaceRepository, 'getNoteByTeamId').mockResolvedValue(null);
    vi.spyOn(teamWorkspaceRepository, 'listRevisionsByTeamId').mockResolvedValue([]);
  });

  it('returns 401 when request is unauthenticated', async () => {
    const res = await request(app).get(workspacePath);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 when authenticated as ADMIN user (US-023 AC 1)', async () => {
    mockVerifyIdToken.mockResolvedValue(validAdminDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(adminParticipant);

    const res = await request(app)
      .get(workspacePath)
      .set('Authorization', adminTokenHeader);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_ROLE');
  });

  it('returns 400 when teamId is not a valid UUID', async () => {
    const res = await request(app)
      .get('/api/teams/not-a-uuid/workspace')
      .set('Authorization', validTokenHeader);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when team does not exist', async () => {
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockRejectedValue(new Error('Not found'));

    const res = await request(app)
      .get(workspacePath)
      .set('Authorization', validTokenHeader);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('TEAM_NOT_FOUND');
  });

  it('returns 403 WORKSPACE_TEAM_NOT_LOCKED when team roster is not locked (FR-068)', async () => {
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
      ...lockedTeamViewParts,
      team: {
        ...sampleTeam,
        recruitment_status: 'Open',
        locked_at: null,
      },
    });

    const res = await request(app)
      .get(workspacePath)
      .set('Authorization', validTokenHeader);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('WORKSPACE_TEAM_NOT_LOCKED');
    expect(res.body.details).toEqual({ recruitmentStatus: 'Open' });
  });

  it('returns 403 WORKSPACE_ACCESS_DENIED when actor is an unrelated PART user', async () => {
    const unrelatedParticipant: Participant = {
      id: '99999999-9999-4999-8999-999999999999',
      firebase_uid: 'fb-unrelated',
      email: 'unrelated@example.com',
      full_name: 'Unrelated User',
      role: 'PART',
      is_verified: true,
      is_suspended: false,
      is_deactivated: false,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    };

    mockVerifyIdToken.mockResolvedValue({
      uid: unrelatedParticipant.firebase_uid,
      email: unrelatedParticipant.email,
      role: 'PART',
      auth_time: AUTH_TIME,
      [MFA_CLAIM]: AUTH_TIME,
    });
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(unrelatedParticipant);
    vi.spyOn(participantsRepository, 'findById').mockImplementation(async (id: string) => {
      if (id === unrelatedParticipant.id) return unrelatedParticipant;
      return null;
    });

    const res = await request(app)
      .get(workspacePath)
      .set('Authorization', 'Bearer unrelated-token');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('WORKSPACE_ACCESS_DENIED');
  });

  it('returns 200 with workspace view and no-store cache when authenticated as team owner', async () => {
    const res = await request(app)
      .get(workspacePath)
      .set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.teamId).toBe(sampleTeamId);
    expect(res.body.recruitmentStatus).toBe('Locked');
    expect(res.body.viewerRole).toBe('Owner');
    expect(res.body.isOwner).toBe(true);
    expect(res.body.teammates).toHaveLength(2);
  });

  it('returns 200 with workspace view when authenticated as confirmed team member', async () => {
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);

    const res = await request(app)
      .get(workspacePath)
      .set('Authorization', otherTokenHeader);

    expect(res.status).toBe(200);
    expect(res.body.teamId).toBe(sampleTeamId);
    expect(res.body.viewerRole).toBe('Member');
    expect(res.body.isOwner).toBe(false);
  });
});

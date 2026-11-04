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

describe('PUT /api/teams/:teamId/workspace/links (US-023 / #US-023-T3 / FR-069)', () => {
  const linksPath = `/api/teams/${sampleTeamId}/workspace/links`;
  const validLinksPayload = {
    links: [
      { label: 'GitHub Repo', url: 'https://github.com/org/repo', display_order: 0 },
      { label: 'Figma Board', url: 'https://figma.com/file/123', display_order: 1 },
    ],
  };

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
    vi.spyOn(teamWorkspaceRepository, 'replaceLinksForTeam').mockImplementation(
      async (_teamId, _actorId, links) =>
        links.map((l, i) => ({
          id: `link-${i}`,
          team_id: sampleTeamId,
          label: l.label,
          url: l.url,
          display_order: l.display_order ?? i,
          updated_by: ownerParticipant.id,
          created_at: '2026-10-25T13:00:00Z',
          updated_at: '2026-10-25T13:00:00Z',
        }))
    );
  });

  it('returns 401 when request is unauthenticated', async () => {
    const res = await request(app)
      .put(linksPath)
      .send(validLinksPayload);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 when links payload fails validation (e.g. insecure HTTP scheme)', async () => {
    const invalidPayload = {
      links: [{ label: 'Insecure Link', url: 'http://insecure.example.com' }],
    };

    const res = await request(app)
      .put(linksPath)
      .set('Authorization', validTokenHeader)
      .send(invalidPayload);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toContain('Validation failed. Existing workspace links were not modified.');
    expect(res.body.errors['links[0].url']).toContain('valid HTTPS link');
    expect(teamWorkspaceRepository.replaceLinksForTeam).not.toHaveBeenCalled();
  });

  it('returns 400 when links payload contains duplicate URLs within same team', async () => {
    const duplicatePayload = {
      links: [
        { label: 'Repo 1', url: 'https://github.com/myteam/project' },
        { label: 'Repo 2', url: 'HTTPS://GITHUB.COM/myteam/project' },
      ],
    };

    const res = await request(app)
      .put(linksPath)
      .set('Authorization', validTokenHeader)
      .send(duplicatePayload);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors['links[1].url']).toContain('Duplicate link URL');
    expect(teamWorkspaceRepository.replaceLinksForTeam).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN_WORKSPACE_LINKS_OWNER_ONLY when non-owner confirmed member tries to update links (FR-069)', async () => {
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);

    const res = await request(app)
      .put(linksPath)
      .set('Authorization', otherTokenHeader)
      .send(validLinksPayload);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_WORKSPACE_LINKS_OWNER_ONLY');
    expect(teamWorkspaceRepository.replaceLinksForTeam).not.toHaveBeenCalled();
  });

  it('returns 200 with updated links and no-store cache when authenticated as team owner', async () => {
    const res = await request(app)
      .put(linksPath)
      .set('Authorization', validTokenHeader)
      .send(validLinksPayload);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.teamId).toBe(sampleTeamId);
    expect(res.body.links).toHaveLength(2);
    expect(res.body.links[0]?.label).toBe('GitHub Repo');
    expect(res.body.links[1]?.label).toBe('Figma Board');
    expect(teamWorkspaceRepository.replaceLinksForTeam).toHaveBeenCalledWith(
      sampleTeamId,
      ownerParticipant.id,
      [
        { label: 'GitHub Repo', url: 'https://github.com/org/repo', display_order: 0 },
        { label: 'Figma Board', url: 'https://figma.com/file/123', display_order: 1 },
      ]
    );
  });
});

describe('PUT /api/teams/:teamId/workspace/note (US-023 / #US-023-T4 / FR-070)', () => {
  const notePath = `/api/teams/${sampleTeamId}/workspace/note`;
  const validNotePayload = {
    content: '# Team Brainstorming\n\n- User stories\n- Wireframes',
    expectedVersion: 0,
  };

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
    vi.spyOn(teamWorkspaceRepository, 'saveNoteWithOptimisticLock').mockResolvedValue({
      note: {
        team_id: sampleTeamId,
        content: validNotePayload.content,
        version: 1,
        updated_by: ownerParticipant.id,
        author_display_name: 'ownerhandle',
        author_pseudonymized_at: null,
        created_at: '2026-10-25T14:00:00Z',
        updated_at: '2026-10-25T14:00:00Z',
      },
      revision: {
        id: 'rev-1',
        team_id: sampleTeamId,
        version: 1,
        content: validNotePayload.content,
        author_id: ownerParticipant.id,
        author_display_name: 'ownerhandle',
        author_pseudonymized_at: null,
        created_at: '2026-10-25T14:00:00Z',
      },
    });
    vi.spyOn(teamWorkspaceRepository, 'listRevisionsByTeamId').mockResolvedValue([
      {
        id: 'rev-1',
        team_id: sampleTeamId,
        version: 1,
        content: validNotePayload.content,
        author_id: ownerParticipant.id,
        author_display_name: 'ownerhandle',
        author_pseudonymized_at: null,
        created_at: '2026-10-25T14:00:00Z',
      },
    ]);
  });

  it('returns 401 when request is unauthenticated', async () => {
    const res = await request(app)
      .put(notePath)
      .send(validNotePayload);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 when note payload fails validation (e.g. negative expectedVersion)', async () => {
    const res = await request(app)
      .put(notePath)
      .set('Authorization', validTokenHeader)
      .send({ content: 'Test note', expectedVersion: -1 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toContain('Validation failed. Existing workspace note was not modified.');
    expect(res.body.errors.expectedVersion).toContain('must be a non-negative integer');
    expect(teamWorkspaceRepository.saveNoteWithOptimisticLock).not.toHaveBeenCalled();
  });

  it('returns 200 and saves note with optimistic lock when authenticated as team member', async () => {
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);

    const res = await request(app)
      .put(notePath)
      .set('Authorization', otherTokenHeader)
      .send(validNotePayload);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.teamId).toBe(sampleTeamId);
    expect(res.body.note.version).toBe(1);
    expect(res.body.revision.version).toBe(1);
    expect(res.body.revisions).toHaveLength(1);
    expect(teamWorkspaceRepository.saveNoteWithOptimisticLock).toHaveBeenCalledWith({
      teamId: sampleTeamId,
      actorId: otherParticipant.id,
      authorDisplayName: 'ownerhandle',
      content: validNotePayload.content,
      expectedVersion: 0,
    });
  });

  it('returns 409 WORKSPACE_NOTE_CONFLICT when expectedVersion does not match current version', async () => {
    const conflictError = {
      message: 'WORKSPACE_NOTE_CONFLICT',
      code: 'P0001',
      detail: JSON.stringify({
        currentVersion: 3,
        expectedVersion: 1,
        currentContent: '# Conflicting edit',
        authorDisplayName: 'Alice',
      }),
    };
    vi.spyOn(teamWorkspaceRepository, 'saveNoteWithOptimisticLock').mockRejectedValue(conflictError);

    const res = await request(app)
      .put(notePath)
      .set('Authorization', validTokenHeader)
      .send({ content: '# My edit', expectedVersion: 1 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WORKSPACE_NOTE_CONFLICT');
    expect(res.body.details).toEqual({
      currentVersion: 3,
      expectedVersion: 1,
      currentContent: '# Conflicting edit',
      authorDisplayName: 'Alice',
    });
  });
});

describe('GET /api/teams/:teamId/workspace/revisions (US-023 / #US-023-T4 / FR-070)', () => {
  const revisionsPath = `/api/teams/${sampleTeamId}/workspace/revisions`;

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
    vi.spyOn(teamWorkspaceRepository, 'getNoteByTeamId').mockResolvedValue({
      team_id: sampleTeamId,
      content: '# Current Note',
      version: 2,
      updated_by: ownerParticipant.id,
      author_display_name: 'ownerhandle',
      author_pseudonymized_at: null,
      created_at: '2026-10-25T14:00:00Z',
      updated_at: '2026-10-25T15:00:00Z',
    });
    vi.spyOn(teamWorkspaceRepository, 'listRevisionsByTeamId').mockResolvedValue([
      {
        id: 'rev-2',
        team_id: sampleTeamId,
        version: 2,
        content: '# Current Note',
        author_id: ownerParticipant.id,
        author_display_name: 'ownerhandle',
        author_pseudonymized_at: null,
        created_at: '2026-10-25T15:00:00Z',
      },
      {
        id: 'rev-1',
        team_id: sampleTeamId,
        version: 1,
        content: '# Initial Note',
        author_id: otherParticipant.id,
        author_display_name: 'mate',
        author_pseudonymized_at: null,
        created_at: '2026-10-25T14:00:00Z',
      },
    ]);
  });

  it('returns 401 when request is unauthenticated', async () => {
    const res = await request(app).get(revisionsPath);
    expect(res.status).toBe(401);
  });

  it('returns 200 with note and immutable revisions history for confirmed member', async () => {
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);

    const res = await request(app)
      .get(revisionsPath)
      .set('Authorization', otherTokenHeader);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.teamId).toBe(sampleTeamId);
    expect(res.body.note.version).toBe(2);
    expect(res.body.revisions).toHaveLength(2);
    expect(res.body.revisions[0]?.version).toBe(2);
    expect(res.body.revisions[1]?.version).toBe(1);
  });
});



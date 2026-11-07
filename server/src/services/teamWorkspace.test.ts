import { describe, it, expect, vi } from 'vitest';
import {
  authorizeLockedTeamWorkspaceMember,
  getPrivateTeamWorkspace,
  listWorkspaceNoteRevisions,
  saveWorkspaceSharedNote,
  updateWorkspaceExternalLinks,
  type TeamWorkspaceServiceDeps,
} from './teamWorkspace.js';
import { TeamServiceError } from './teamErrors.js';
import type {
  Participant,
  ParticipantPortfolio,
  ParticipantProfile,
  ParticipantSkill,
  Team,
  TeamWorkspaceLink,
  TeamWorkspaceNote,
  TeamWorkspaceNoteRevision,
  UpsertWorkspaceLinkInput,
} from '../db/types.js';
import type { FullParticipantProfileRecord } from '../db/profile.repository.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
const outsiderId = '33333333-3333-4333-8333-333333333333';
const adminId = '44444444-4444-4444-8444-444444444444';
const teamId = '55555555-5555-4555-8555-555555555555';

const ownerParticipant: Participant = {
  id: ownerId,
  firebase_uid: 'fb-owner',
  email: 'owner@example.com',
  full_name: 'Owner User',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

const memberParticipant: Participant = {
  id: memberId,
  firebase_uid: 'fb-member',
  email: 'member@example.com',
  full_name: 'Member User',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

const outsiderParticipant: Participant = {
  id: outsiderId,
  firebase_uid: 'fb-outsider',
  email: 'outsider@example.com',
  full_name: 'Outsider User',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

const adminParticipant: Participant = {
  id: adminId,
  firebase_uid: 'fb-admin',
  email: 'admin@example.com',
  full_name: 'Admin User',
  role: 'ADMIN',
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

const lockedTeam: Team = {
  id: teamId,
  event_id: 'event-uuid-1',
  name: 'Quantum Hackers',
  pitch: 'Building next-gen AI tools',
  goal: 'Project Completion',
  commitment_hours: 20,
  communication_link: 'https://discord.gg/team',
  recruitment_status: 'Locked',
  locked_at: '2026-10-25T12:00:00.000Z',
  owner_participant_id: ownerId,
  disbanded_at: null,
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-25T12:00:00Z',
};

const openTeam: Team = {
  ...lockedTeam,
  recruitment_status: 'Open',
  locked_at: null,
};

const sampleTeamParts = {
  team: lockedTeam,
  event: {
    min_team_size: 2,
    max_team_size: 4,
    status: 'Published' as const,
  },
  members: [
    {
      participant_id: ownerId,
      role: 'Owner' as const,
      joined_at: '2026-10-20T00:00:00Z',
      handle: 'ownerhandle',
      full_name: 'Owner User',
    },
    {
      participant_id: memberId,
      role: 'Member' as const,
      joined_at: '2026-10-21T00:00:00Z',
      handle: 'memberhandle',
      full_name: 'Member User',
    },
  ],
  vacancies: [],
};

const mockProfile: ParticipantProfile = {
  participant_id: memberId,
  handle: 'memberhandle',
  primary_role: 'Frontend',
  institution: 'Centennial College',
  shared_contact_handle: '@member_discord',
  created_at: '2026-10-21T00:00:00Z',
  updated_at: '2026-10-21T00:00:00Z',
};

const mockSkills: ParticipantSkill[] = [
  {
    id: 'skill-1',
    participant_id: memberId,
    skill_name: 'React',
    created_at: '2026-10-21T00:00:00Z',
  },
  {
    id: 'skill-2',
    participant_id: memberId,
    skill_name: 'TypeScript',
    created_at: '2026-10-21T00:00:00Z',
  },
];

const mockPortfolios: ParticipantPortfolio[] = [
  {
    id: 'port-1',
    participant_id: memberId,
    url: 'https://portfolio.example.com',
    label: 'Portfolio',
    created_at: '2026-10-21T00:00:00Z',
    updated_at: '2026-10-21T00:00:00Z',
  },
];

const sampleFullProfile: FullParticipantProfileRecord = {
  profile: mockProfile,
  skills: mockSkills,
  portfolios: mockPortfolios,
  history: [],
};

function createMockDeps(overrides: Partial<TeamWorkspaceServiceDeps> = {}): TeamWorkspaceServiceDeps {
  const participantsMap = new Map<string, Participant>([
    [ownerId, ownerParticipant],
    [memberId, memberParticipant],
    [outsiderId, outsiderParticipant],
    [adminId, adminParticipant],
  ]);

  return {
    participantsRepo: {
      findById: vi.fn(async (id: string) => participantsMap.get(id) ?? null),
    },
    teamsRepo: {
      getTeamViewParts: vi.fn(async () => sampleTeamParts),
      listConfirmedParticipantIdsForTeam: vi.fn(async () => [ownerId, memberId]),
    },
    profileRepo: {
      getFullProfile: vi.fn(async () => sampleFullProfile),
    },
    workspaceRepo: {
      listLinksByTeamId: vi.fn(async () => []),
      getNoteByTeamId: vi.fn(async () => null),
      listRevisionsByTeamId: vi.fn(async () => []),
      replaceLinksForTeam: vi.fn(
        async (
          _teamId: string,
          _actorId: string,
          links: UpsertWorkspaceLinkInput[]
        ) =>
          links.map((l: UpsertWorkspaceLinkInput, i: number) => ({
            id: `link-${i}`,
            team_id: teamId,
            label: l.label,
            url: l.url,
            display_order: l.display_order ?? i,
            updated_by: ownerId,
            created_at: '2026-10-25T13:00:00Z',
            updated_at: '2026-10-25T13:00:00Z',
          }))
      ),
      saveNoteWithOptimisticLock: vi.fn(async (input) => ({
        note: {
          team_id: input.teamId,
          content: input.content,
          version: input.expectedVersion + 1,
          updated_by: input.actorId,
          author_display_name: input.authorDisplayName,
          author_pseudonymized_at: null,
          created_at: '2026-10-25T14:00:00Z',
          updated_at: '2026-10-25T14:00:00Z',
        },
        revision: {
          id: 'new-rev-1',
          team_id: input.teamId,
          version: input.expectedVersion + 1,
          content: input.content,
          author_id: input.actorId,
          author_display_name: input.authorDisplayName,
          author_pseudonymized_at: null,
          created_at: '2026-10-25T14:00:00Z',
        },
      })),
    },
    ...overrides,
  };
}

describe('teamWorkspace service (US-023 / #US-023-T2)', () => {
  describe('authorizeLockedTeamWorkspaceMember', () => {
    it('throws WORKSPACE_ACCESS_DENIED when participant does not exist', async () => {
      const deps = createMockDeps();
      await expect(
        authorizeLockedTeamWorkspaceMember('non-existent-id', teamId, deps)
      ).rejects.toThrow(new TeamServiceError('WORKSPACE_ACCESS_DENIED'));
    });

    it('throws WORKSPACE_ACCESS_DENIED when user is ADMIN (US-023 AC 1: ADMIN without membership denied)', async () => {
      const deps = createMockDeps();
      await expect(
        authorizeLockedTeamWorkspaceMember(adminId, teamId, deps)
      ).rejects.toThrow(new TeamServiceError('WORKSPACE_ACCESS_DENIED'));
    });

    it('throws WORKSPACE_ACCESS_DENIED when participant is unverified, suspended, or deactivated', async () => {
      const unverifiedDeps = createMockDeps({
        participantsRepo: {
          findById: vi.fn(async () => ({ ...memberParticipant, is_verified: false })),
        },
      });
      await expect(
        authorizeLockedTeamWorkspaceMember(memberId, teamId, unverifiedDeps)
      ).rejects.toThrow(new TeamServiceError('WORKSPACE_ACCESS_DENIED'));

      const suspendedDeps = createMockDeps({
        participantsRepo: {
          findById: vi.fn(async () => ({ ...memberParticipant, is_suspended: true })),
        },
      });
      await expect(
        authorizeLockedTeamWorkspaceMember(memberId, teamId, suspendedDeps)
      ).rejects.toThrow(new TeamServiceError('WORKSPACE_ACCESS_DENIED'));

      const deactivatedDeps = createMockDeps({
        participantsRepo: {
          findById: vi.fn(async () => ({ ...memberParticipant, is_deactivated: true })),
        },
      });
      await expect(
        authorizeLockedTeamWorkspaceMember(memberId, teamId, deactivatedDeps)
      ).rejects.toThrow(new TeamServiceError('WORKSPACE_ACCESS_DENIED'));
    });

    it('throws TEAM_NOT_FOUND when team does not exist', async () => {
      const deps = createMockDeps({
        teamsRepo: {
          getTeamViewParts: vi.fn(async () => {
            throw new Error('Not found');
          }),
          listConfirmedParticipantIdsForTeam: vi.fn(async () => []),
        },
      });
      await expect(
        authorizeLockedTeamWorkspaceMember(ownerId, 'non-existent-team', deps)
      ).rejects.toThrow(new TeamServiceError('TEAM_NOT_FOUND'));
    });

    it('throws WORKSPACE_TEAM_NOT_LOCKED with status details when team is not locked (FR-068)', async () => {
      const deps = createMockDeps({
        teamsRepo: {
          getTeamViewParts: vi.fn(async () => ({
            ...sampleTeamParts,
            team: openTeam,
          })),
          listConfirmedParticipantIdsForTeam: vi.fn(async () => [ownerId, memberId]),
        },
      });

      try {
        await authorizeLockedTeamWorkspaceMember(ownerId, teamId, deps);
        expect.unreachable('Should have thrown WORKSPACE_TEAM_NOT_LOCKED');
      } catch (err) {
        expect(err).toBeInstanceOf(TeamServiceError);
        const serviceErr = err as TeamServiceError;
        expect(serviceErr.code).toBe('WORKSPACE_TEAM_NOT_LOCKED');
        expect(serviceErr.status).toBe(403);
        expect(serviceErr.details).toEqual({ recruitmentStatus: 'Open' });
      }
    });

    it('throws WORKSPACE_ACCESS_DENIED when actor is an unrelated PART user (US-023 AC 1)', async () => {
      const deps = createMockDeps();
      await expect(
        authorizeLockedTeamWorkspaceMember(outsiderId, teamId, deps)
      ).rejects.toThrow(new TeamServiceError('WORKSPACE_ACCESS_DENIED'));
    });

    it('succeeds for team owner with viewerRole: Owner and isOwner: true', async () => {
      const deps = createMockDeps();
      const result = await authorizeLockedTeamWorkspaceMember(ownerId, teamId, deps);
      expect(result.viewerRole).toBe('Owner');
      expect(result.isOwner).toBe(true);
      expect(result.viewParts.team.name).toBe('Quantum Hackers');
    });

    it('succeeds for confirmed team member with viewerRole: Member and isOwner: false', async () => {
      const deps = createMockDeps();
      const result = await authorizeLockedTeamWorkspaceMember(memberId, teamId, deps);
      expect(result.viewerRole).toBe('Member');
      expect(result.isOwner).toBe(false);
    });
  });

  describe('getPrivateTeamWorkspace', () => {
    it('returns workspace with privacy-scrubbed teammate contacts (US-023 AC 2)', async () => {
      const deps = createMockDeps();
      const workspace = await getPrivateTeamWorkspace(memberId, teamId, deps);

      expect(workspace.teamId).toBe(teamId);
      expect(workspace.teamName).toBe('Quantum Hackers');
      expect(workspace.recruitmentStatus).toBe('Locked');
      expect(workspace.lockedAt).toBe('2026-10-25T12:00:00.000Z');
      expect(workspace.viewerRole).toBe('Member');
      expect(workspace.isOwner).toBe(false);
      expect(workspace.teammates).toHaveLength(2);

      const mateCard = workspace.teammates.find((t) => t.participantId === memberId);
      expect(mateCard).toBeDefined();
      expect(mateCard?.displayName).toBe('Member User');
      expect(mateCard?.handle).toBe('memberhandle');
      expect(mateCard?.primaryRole).toBe('Frontend');
      expect(mateCard?.institution).toBe('Centennial College');
      expect(mateCard?.skills).toEqual(['React', 'TypeScript']);
      expect(mateCard?.skillsSelfDeclared).toBe(true);
      expect(mateCard?.sharedContactHandle).toBe('@member_discord');
      expect(mateCard?.sharedContactAudienceNotice).toContain('visible only to confirmed teammates');
      expect(mateCard?.portfolioLinks).toHaveLength(1);

      // CRITICAL AC 2 verification: strictly never expose email or authentication credentials
      for (const card of workspace.teammates) {
        expect((card as unknown as Record<string, unknown>).email).toBeUndefined();
        expect((card as unknown as Record<string, unknown>).firebase_uid).toBeUndefined();
        expect((card as unknown as Record<string, unknown>).password).toBeUndefined();
      }
    });

    it('returns links, note, and revisions when repository has entries', async () => {
      const sampleLink: TeamWorkspaceLink = {
        id: 'link-1',
        team_id: teamId,
        label: 'Figma Design',
        url: 'https://figma.com/file/123',
        display_order: 0,
        updated_by: ownerId,
        created_at: '2026-10-25T13:00:00Z',
        updated_at: '2026-10-25T13:00:00Z',
      };

      const sampleNote: TeamWorkspaceNote = {
        team_id: teamId,
        content: '# Project Concept\n\nShared roadmap.',
        version: 1,
        updated_by: ownerId,
        author_display_name: 'Owner User',
        author_pseudonymized_at: null,
        created_at: '2026-10-25T14:00:00Z',
        updated_at: '2026-10-25T14:00:00Z',
      };

      const sampleRevision: TeamWorkspaceNoteRevision = {
        id: 'rev-1',
        team_id: teamId,
        version: 1,
        content: '# Project Concept\n\nShared roadmap.',
        author_id: ownerId,
        author_display_name: 'Owner User',
        author_pseudonymized_at: null,
        created_at: '2026-10-25T14:00:00Z',
      };

      const deps = createMockDeps({
        workspaceRepo: {
          ...createMockDeps().workspaceRepo!,
          listLinksByTeamId: vi.fn(async () => [sampleLink]),
          getNoteByTeamId: vi.fn(async () => sampleNote),
          listRevisionsByTeamId: vi.fn(async () => [sampleRevision]),
        },
      });

      const workspace = await getPrivateTeamWorkspace(ownerId, teamId, deps);
      expect(workspace.links).toEqual([sampleLink]);
      expect(workspace.note).toEqual(sampleNote);
      expect(workspace.revisions).toEqual([sampleRevision]);
    });

    it('scrubs private auth and PII keys and returns privacy flags (US-023 AC 2 / NR-004)', async () => {
      const deps = createMockDeps();
      const workspace = await getPrivateTeamWorkspace(ownerId, teamId, deps);

      expect(workspace.privacy).toBeDefined();
      expect(workspace.privacy?.emailsScrubbed).toBe(true);
      expect(workspace.privacy?.authUidsScrubbed).toBe(true);
      expect(workspace).not.toHaveProperty('email');
      expect(workspace).not.toHaveProperty('firebase_uid');
      expect(workspace.teammates[0]).not.toHaveProperty('email');
      expect(workspace.teammates[0]).not.toHaveProperty('firebase_uid');
    });

    it('pseudonymizes deleted/deactivated teammates in locked workspace (NR-023)', async () => {
      const deactivatedMember: Participant = {
        ...memberParticipant,
        is_deactivated: true,
        deactivated_at: '2026-10-26T12:00:00Z',
        firebase_uid: `deleted:${memberParticipant.id}`,
      };

      const deps = createMockDeps({
        participantsRepo: {
          findById: vi.fn(async (id: string) => {
            if (id === ownerId) return ownerParticipant;
            if (id === memberId) return deactivatedMember;
            return null;
          }),
        },
      });

      const workspace = await getPrivateTeamWorkspace(ownerId, teamId, deps);
      const memberContact = workspace.teammates.find(
        (t) => t.participantId === memberId
      );

      expect(memberContact).toBeDefined();
      expect(memberContact?.displayName).toMatch(/^Former Member [0-9a-f]{8}$/);
      expect(memberContact?.handle).toBeNull();
      expect(memberContact?.sharedContactHandle).toBeNull();
      expect(memberContact?.portfolioLinks).toEqual([]);
      expect(memberContact?.isPseudonymized).toBe(true);
    });
  });

  describe('updateWorkspaceExternalLinks (US-023 / #US-023-T3 / FR-069)', () => {
    it('throws FORBIDDEN_WORKSPACE_LINKS_OWNER_ONLY when non-owner confirmed member tries to update links', async () => {
      const deps = createMockDeps();
      await expect(
        updateWorkspaceExternalLinks(
          {
            actorId: memberId,
            teamId,
            links: [{ label: 'Docs', url: 'https://docs.google.com' }],
          },
          deps
        )
      ).rejects.toThrow(new TeamServiceError('FORBIDDEN_WORKSPACE_LINKS_OWNER_ONLY'));
    });

    it('throws WORKSPACE_ACCESS_DENIED when unrelated user tries to update links', async () => {
      const deps = createMockDeps();
      await expect(
        updateWorkspaceExternalLinks(
          {
            actorId: outsiderId,
            teamId,
            links: [{ label: 'Docs', url: 'https://docs.google.com' }],
          },
          deps
        )
      ).rejects.toThrow(new TeamServiceError('WORKSPACE_ACCESS_DENIED'));
    });

    it('throws WORKSPACE_TEAM_NOT_LOCKED when team is not locked', async () => {
      const deps = createMockDeps({
        teamsRepo: {
          getTeamViewParts: vi.fn(async () => ({
            ...sampleTeamParts,
            team: openTeam,
          })),
          listConfirmedParticipantIdsForTeam: vi.fn(async () => [ownerId, memberId]),
        },
      });

      await expect(
        updateWorkspaceExternalLinks(
          {
            actorId: ownerId,
            teamId,
            links: [{ label: 'Docs', url: 'https://docs.google.com' }],
          },
          deps
        )
      ).rejects.toThrow(
        new TeamServiceError('WORKSPACE_TEAM_NOT_LOCKED', {
          recruitmentStatus: 'Open',
        })
      );
    });

    it('succeeds for team owner, calling replaceLinksForTeam and returning updated links', async () => {
      const deps = createMockDeps();
      const inputLinks = [
        { label: 'Repo', url: 'https://github.com/org/repo', display_order: 0 },
        { label: 'Figma', url: 'https://figma.com/file/123', display_order: 1 },
      ];

      const result = await updateWorkspaceExternalLinks(
        { actorId: ownerId, teamId, links: inputLinks },
        deps
      );

      expect(result.teamId).toBe(teamId);
      expect(result.links).toHaveLength(2);
      expect(result.links[0]?.label).toBe('Repo');
      expect(result.links[1]?.label).toBe('Figma');
      expect(typeof result.updatedAt).toBe('string');
      expect(deps.workspaceRepo?.replaceLinksForTeam).toHaveBeenCalledWith(
        teamId,
        ownerId,
        inputLinks
      );
    });
  });

  describe('saveWorkspaceSharedNote (US-023 / #US-023-T4 / FR-070)', () => {
    it('throws WORKSPACE_ACCESS_DENIED when actor is not a confirmed member of the locked team', async () => {
      const deps = createMockDeps();
      await expect(
        saveWorkspaceSharedNote(
          {
            actorId: outsiderId,
            teamId,
            content: '# New Concept',
            expectedVersion: 0,
          },
          deps
        )
      ).rejects.toThrow(new TeamServiceError('WORKSPACE_ACCESS_DENIED'));
    });

    it('throws WORKSPACE_TEAM_NOT_LOCKED when team is not locked', async () => {
      const deps = createMockDeps({
        teamsRepo: {
          getTeamViewParts: vi.fn(async () => ({
            ...sampleTeamParts,
            team: openTeam,
          })),
          listConfirmedParticipantIdsForTeam: vi.fn(async () => [ownerId, memberId]),
        },
      });

      await expect(
        saveWorkspaceSharedNote(
          {
            actorId: memberId,
            teamId,
            content: '# Concept',
            expectedVersion: 0,
          },
          deps
        )
      ).rejects.toThrow(
        new TeamServiceError('WORKSPACE_TEAM_NOT_LOCKED', {
          recruitmentStatus: 'Open',
        })
      );
    });

    it('succeeds for confirmed member, calling saveNoteWithOptimisticLock with authorDisplayName', async () => {
      const deps = createMockDeps();
      const result = await saveWorkspaceSharedNote(
        {
          actorId: memberId,
          teamId,
          content: '# Shared Architecture\n\n- Backend Express',
          expectedVersion: 0,
        },
        deps
      );

      expect(result.teamId).toBe(teamId);
      expect(result.note.content).toBe('# Shared Architecture\n\n- Backend Express');
      expect(result.note.version).toBe(1);
      expect(result.revision.version).toBe(1);
      expect(result.revision.author_display_name).toBe('memberhandle');
      expect(deps.workspaceRepo?.saveNoteWithOptimisticLock).toHaveBeenCalledWith({
        teamId,
        actorId: memberId,
        authorDisplayName: 'memberhandle',
        content: '# Shared Architecture\n\n- Backend Express',
        expectedVersion: 0,
      });
    });

    it('falls back to full_name if profile handle is not found', async () => {
      const deps = createMockDeps({
        profileRepo: {
          getFullProfile: vi.fn(async () => ({
            profile: null,
            skills: [],
            portfolios: [],
            history: [],
          })),
        },
      });

      const result = await saveWorkspaceSharedNote(
        {
          actorId: memberId,
          teamId,
          content: '# Fallback Author',
          expectedVersion: 0,
        },
        deps
      );

      expect(result.revision.author_display_name).toBe('Member User');
    });

    it('sanitizes dangerous markdown before saving to repository (NR-009)', async () => {
      const deps = createMockDeps();
      const dangerousMarkdown =
        '# Valid Title\n<script>alert("hack")</script>[Attack](javascript:steal()) and [Repo](https://github.com/org/repo)';

      await saveWorkspaceSharedNote(
        {
          actorId: memberId,
          teamId,
          content: dangerousMarkdown,
          expectedVersion: 0,
        },
        deps
      );

      expect(deps.workspaceRepo?.saveNoteWithOptimisticLock).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.not.stringContaining('<script'),
        })
      );
      expect(deps.workspaceRepo?.saveNoteWithOptimisticLock).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Attack [unsafe link removed]'),
        })
      );
    });

    it('throws WORKSPACE_NOTE_CONFLICT with enriched details when expectedVersion !== currentVersion (FR-070 / US-023-T5)', async () => {
      const latestNote: TeamWorkspaceNote = {
        team_id: teamId,
        content: '# Concept Updated by Teammate',
        version: 2,
        updated_by: ownerId,
        author_display_name: 'Owner User',
        author_pseudonymized_at: null,
        created_at: '2026-10-25T14:00:00Z',
        updated_at: '2026-10-25T14:10:00Z',
      };
      const latestRevision: TeamWorkspaceNoteRevision = {
        id: 'rev-2',
        team_id: teamId,
        version: 2,
        content: '# Concept Updated by Teammate',
        author_id: ownerId,
        author_display_name: 'Owner User',
        author_pseudonymized_at: null,
        created_at: '2026-10-25T14:10:00Z',
      };

      const deps = createMockDeps({
        workspaceRepo: {
          ...createMockDeps().workspaceRepo!,
          saveNoteWithOptimisticLock: vi.fn(async () => {
            throw new TeamServiceError('WORKSPACE_NOTE_CONFLICT', {
              expectedVersion: 1,
              currentVersion: 2,
            });
          }),
          getNoteByTeamId: vi.fn(async () => latestNote),
          listRevisionsByTeamId: vi.fn(async () => [latestRevision]),
        },
      });

      let caughtErr: unknown = null;
      try {
        await saveWorkspaceSharedNote(
          {
            actorId: memberId,
            teamId,
            content: '# Stale Save Attempt',
            expectedVersion: 1,
          },
          deps
        );
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(TeamServiceError);
      const serviceErr = caughtErr as TeamServiceError;
      expect(serviceErr.code).toBe('WORKSPACE_NOTE_CONFLICT');
      expect(serviceErr.status).toBe(409);
      expect(serviceErr.details).toMatchObject({
        expectedVersion: 1,
        currentVersion: 2,
        latestNote,
        revisions: [latestRevision],
      });
    });
  });

  describe('listWorkspaceNoteRevisions (US-023 / #US-023-T4 / FR-070)', () => {
    it('throws WORKSPACE_ACCESS_DENIED when actor is not a confirmed member of the team', async () => {
      const deps = createMockDeps();
      await expect(
        listWorkspaceNoteRevisions(outsiderId, teamId, deps)
      ).rejects.toThrow(new TeamServiceError('WORKSPACE_ACCESS_DENIED'));
    });

    it('returns current note and revision list for confirmed member', async () => {
      const sampleRevision: TeamWorkspaceNoteRevision = {
        id: 'rev-1',
        team_id: teamId,
        version: 1,
        content: '# Concept v1',
        author_id: ownerId,
        author_display_name: 'Owner User',
        author_pseudonymized_at: null,
        created_at: '2026-10-25T14:00:00Z',
      };

      const deps = createMockDeps({
        workspaceRepo: {
          ...createMockDeps().workspaceRepo!,
          getNoteByTeamId: vi.fn(async () => ({
            team_id: teamId,
            content: '# Concept v1',
            version: 1,
            updated_by: ownerId,
            author_display_name: 'Owner User',
            author_pseudonymized_at: null,
            created_at: '2026-10-25T14:00:00Z',
            updated_at: '2026-10-25T14:00:00Z',
          })),
          listRevisionsByTeamId: vi.fn(async () => [sampleRevision]),
        },
      });

      const result = await listWorkspaceNoteRevisions(memberId, teamId, deps);
      expect(result.teamId).toBe(teamId);
      expect(result.note?.version).toBe(1);
      expect(result.revisions).toHaveLength(1);
      expect(result.revisions[0]?.content).toBe('# Concept v1');
    });
  });
});


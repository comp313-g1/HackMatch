import { describe, it, expect, vi } from 'vitest';
import {
  queryCandidateDirectoryForTeamOwner,
  filterDirectoryCandidates,
  type CandidateDirectoryDeps,
  type DirectoryCandidateCard,
} from './candidateDirectory.js';
import type { Team, Participant, TeamVacancy } from '../db/types.js';
import type { FullParticipantProfileRecord } from '../db/profile.repository.js';
import type { AvailableCandidateCard } from './availability.service.js';

describe('Candidate Directory Service (US-014 / FR-040)', () => {
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const otherId = '22222222-2222-4222-8222-222222222222';
  const teamId = '33333333-3333-4333-8333-333333333333';
  const eventId = '44444444-4444-4444-8444-444444444444';

  const activeTeam: Team = {
    id: teamId,
    event_id: eventId,
    owner_participant_id: ownerId,
    name: 'HackMatch Team',
    pitch: 'Building together',
    goal: 'Project Completion',
    commitment_hours: 20,
    communication_link: null,
    recruitment_status: 'Open',
    locked_at: null,
    disbanded_at: null,
    created_at: '2026-10-18T10:00:00.000Z',
    updated_at: '2026-10-18T10:00:00.000Z',
  };

  const sampleVacancy: TeamVacancy = {
    id: '55555555-5555-4555-8555-555555555555',
    team_id: teamId,
    role: 'Frontend',
    skills: ['React'],
    status: 'Open',
    removed_at: null,
    created_at: '2026-10-18T10:05:00.000Z',
    updated_at: '2026-10-18T10:05:00.000Z',
  };

  const viewParts = {
    team: activeTeam,
    event: {
      status: 'Published' as const,
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      max_team_size: 4,
    },
    members: [
      {
        participant_id: ownerId,
        role: 'Owner' as const,
        joined_at: '2026-10-18T10:00:00.000Z',
        handle: 'owner_lead',
        full_name: 'Owner Lead',
      },
    ],
    vacancies: [sampleVacancy],
  };

  const candidateParticipant: Participant = {
    id: 'c1111111-1111-4111-8111-111111111111',
    firebase_uid: 'fb-candidate-1',
    email: 'candidate1@example.com',
    full_name: 'Candidate One',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };

  const candidateProfile: FullParticipantProfileRecord = {
    profile: {
      participant_id: candidateParticipant.id,
      handle: 'cand_one',
      institution: 'Centennial College',
      primary_role: 'Frontend',
      shared_contact_handle: '@secret_discord',
      moderation_status: 'None',
      created_at: '2026-10-18T00:00:00.000Z',
      updated_at: '2026-10-18T00:00:00.000Z',
    },
    skills: [
      { id: '1', participant_id: candidateParticipant.id, skill_name: 'React', created_at: '' },
      { id: '2', participant_id: candidateParticipant.id, skill_name: 'TypeScript', created_at: '' },
    ],
    portfolios: [{ id: '1', participant_id: candidateParticipant.id, url: 'https://github.com/one', label: 'GitHub', created_at: '', updated_at: '' }],
    history: [
      {
        id: 'h1',
        participant_id: candidateParticipant.id,
        event_name: 'HackFest 2025',
        event_date: '2025-05-01',
        team_role: 'Frontend',
        project_title: 'Demo App',
        project_url: 'https://github.com/one/demo',
        created_at: '',
        updated_at: '',
      },
    ],
  };

  const candidateCard: AvailableCandidateCard = {
    participantId: candidateParticipant.id,
    displayName: candidateParticipant.full_name,
    handle: 'cand_one',
    institution: 'Centennial College',
    primaryRole: 'Frontend',
    desiredRole: 'Frontend',
    commitmentHours: 25,
    goal: 'Project Completion',
    skills: ['React', 'TypeScript'],
    portfolioLinks: [{ url: 'https://github.com/one', label: 'GitHub', isSelfDeclared: true }],
    updatedAt: '2026-10-18T00:00:00.000Z',
  };

  function createMockDeps(overrides: Partial<CandidateDirectoryDeps> = {}): CandidateDirectoryDeps {
    return {
      teamsRepo: {
        getTeamViewParts: vi.fn().mockResolvedValue(viewParts),
        listConfirmedParticipantIdsForTeam: vi.fn().mockResolvedValue([ownerId]),
        listConfirmedParticipantIdsForEvent: vi.fn().mockResolvedValue([ownerId]),
      },
      participantsRepo: {
        findById: vi.fn().mockResolvedValue(candidateParticipant),
      },
      profileRepo: {
        getFullProfile: vi.fn().mockResolvedValue(candidateProfile),
      },
      availabilityRepo: {
        findAllActiveLooking: vi.fn().mockResolvedValue([]),
      },
      listAvailableCandidates: vi.fn().mockResolvedValue([candidateCard]),
      now: () => new Date(),
      ...overrides,
    };
  }

  describe('Active Team Owner Access Gate (FR-040)', () => {
    it('throws FORBIDDEN_NOT_TEAM_OWNER when caller is not the owner', async () => {
      const deps = createMockDeps();
      await expect(
        queryCandidateDirectoryForTeamOwner(
          { actorParticipantId: otherId, teamId },
          deps
        )
      ).rejects.toMatchObject({ code: 'FORBIDDEN_NOT_TEAM_OWNER' });
    });

    it('throws TEAM_NOT_FOUND when team view parts are null', async () => {
      const deps = createMockDeps({
        teamsRepo: {
          getTeamViewParts: vi.fn().mockResolvedValue(null),
          listConfirmedParticipantIdsForTeam: vi.fn().mockResolvedValue([]),
        },
      });
      await expect(
        queryCandidateDirectoryForTeamOwner(
          { actorParticipantId: ownerId, teamId },
          deps
        )
      ).rejects.toMatchObject({ code: 'TEAM_NOT_FOUND' });
    });

    it('throws TEAM_NOT_MUTABLE when team is locked', async () => {
      const lockedParts = {
        ...viewParts,
        team: { ...activeTeam, recruitment_status: 'Locked' as const },
      };
      const deps = createMockDeps({
        teamsRepo: {
          getTeamViewParts: vi.fn().mockResolvedValue(lockedParts),
          listConfirmedParticipantIdsForTeam: vi.fn().mockResolvedValue([]),
        },
      });
      await expect(
        queryCandidateDirectoryForTeamOwner(
          { actorParticipantId: ownerId, teamId },
          deps
        )
      ).rejects.toMatchObject({ code: 'TEAM_NOT_MUTABLE' });
    });

    it('throws EVENT_NOT_RECRUITING when event is concluded', async () => {
      const expiredParts = {
        ...viewParts,
        event: {
          status: 'Published' as const,
          end_date: new Date(Date.now() - 1000).toISOString(),
          max_team_size: 4,
        },
      };
      const deps = createMockDeps({
        teamsRepo: {
          getTeamViewParts: vi.fn().mockResolvedValue(expiredParts),
          listConfirmedParticipantIdsForTeam: vi.fn().mockResolvedValue([]),
        },
      });
      await expect(
        queryCandidateDirectoryForTeamOwner(
          { actorParticipantId: ownerId, teamId },
          deps
        )
      ).rejects.toMatchObject({ code: 'EVENT_NOT_RECRUITING' });
    });
  });

  describe('Candidate Exclusion and Projection (US-014 AC 1, AC 3, FR-040)', () => {
    it('excludes confirmed participants across event teams and the owner', async () => {
      const confirmedOtherId = 'c2222222-2222-4222-8222-222222222222';
      const deps = createMockDeps({
        teamsRepo: {
          getTeamViewParts: vi.fn().mockResolvedValue(viewParts),
          listConfirmedParticipantIdsForTeam: vi.fn().mockResolvedValue([ownerId]),
          listConfirmedParticipantIdsForEvent: vi.fn().mockResolvedValue([ownerId, confirmedOtherId]),
        },
        listAvailableCandidates: vi.fn().mockResolvedValue([
          candidateCard,
          { ...candidateCard, participantId: ownerId },
          { ...candidateCard, participantId: confirmedOtherId },
        ]),
      });

      const res = await queryCandidateDirectoryForTeamOwner(
        { actorParticipantId: ownerId, teamId },
        deps
      );

      expect(res.totalEligible).toBe(1);
      expect(res.candidates).toHaveLength(1);
      expect(res.candidates[0].participantId).toBe(candidateParticipant.id);
      expect(res.exclusions.owner).toBe(1);
      expect(res.exclusions.confirmed).toBe(1);
    });

    it('enforces US-006 privacy: never exposes sharedContactHandle or email in directory cards', async () => {
      const deps = createMockDeps();
      const res = await queryCandidateDirectoryForTeamOwner(
        { actorParticipantId: ownerId, teamId },
        deps
      );

      expect(res.candidates).toHaveLength(1);
      const card = res.candidates[0] as unknown as Record<string, unknown>;
      expect(card.sharedContactHandle).toBeUndefined();
      expect(card.email).toBeUndefined();
      expect(card.firebase_uid).toBeUndefined();
      expect(card.handle).toBe('cand_one');
      expect(card.experienceBadge).toBe('Competitor');
      expect(card.hackathonCount).toBe(1);
      expect(card.hackathonHistory).toHaveLength(1);
    });
  });

  describe('filterDirectoryCandidates (US-014 AC 2, FR-040, FR-041)', () => {
    const cardA: DirectoryCandidateCard = {
      participantId: 'p1',
      displayName: 'Alice Coder',
      handle: 'alice',
      institution: 'Centennial',
      primaryRole: 'Frontend',
      desiredRole: 'Frontend',
      commitmentHours: 20,
      goal: 'Project Completion',
      skills: ['React', 'TypeScript', 'Tailwind'],
      matchedSkills: [],
      skillsSelfDeclared: true,
      portfolioLinks: [],
      selfDeclaredNotice: '',
      hackathonCount: 0,
      experienceBadge: 'Beginner',
      experienceBadgeSelfReported: true,
      selfReportedNotice: '',
      hackathonHistory: [],
      updatedAt: null,
    };

    const cardB: DirectoryCandidateCard = {
      ...cardA,
      participantId: 'p2',
      displayName: 'Bob Builder',
      handle: 'bob',
      primaryRole: 'Backend',
      desiredRole: 'Backend',
      commitmentHours: 35,
      goal: 'Competitive',
      skills: ['Node.js', 'PostgreSQL', 'TypeScript'],
      hackathonCount: 5,
      experienceBadge: 'Veteran',
    };

    it('filters skills with AND mode (requires all requested skills)', () => {
      const res = filterDirectoryCandidates([cardA, cardB], {
        skills: ['React', 'TypeScript'],
        skillMatchMode: 'AND',
        role: null,
        desiredRole: null,
        minHours: null,
        maxHours: null,
        badge: null,
        goal: null,
        search: null,
      });

      expect(res).toHaveLength(1);
      expect(res[0].handle).toBe('alice');
      expect(res[0].matchedSkills).toEqual(['React', 'TypeScript']);
    });

    it('filters skills with OR mode and sorts by matchedSkills count descending', () => {
      const res = filterDirectoryCandidates([cardA, cardB], {
        skills: ['React', 'PostgreSQL', 'TypeScript'],
        skillMatchMode: 'OR',
        role: null,
        desiredRole: null,
        minHours: null,
        maxHours: null,
        badge: null,
        goal: null,
        search: null,
      });

      expect(res).toHaveLength(2);
      expect(res[0].matchedSkills).toHaveLength(2); // cardA has 2 (React, TypeScript), cardB has 2 (PostgreSQL, TypeScript)
    });

    it('filters by numeric hours range [minHours, maxHours]', () => {
      const res = filterDirectoryCandidates([cardA, cardB], {
        skills: [],
        skillMatchMode: 'AND',
        role: null,
        desiredRole: null,
        minHours: 30,
        maxHours: 40,
        badge: null,
        goal: null,
        search: null,
      });

      expect(res).toHaveLength(1);
      expect(res[0].handle).toBe('bob');
    });

    it('filters by self-reported experience badge', () => {
      const res = filterDirectoryCandidates([cardA, cardB], {
        skills: [],
        skillMatchMode: 'AND',
        role: null,
        desiredRole: null,
        minHours: null,
        maxHours: null,
        badge: 'Veteran',
        goal: null,
        search: null,
      });

      expect(res).toHaveLength(1);
      expect(res[0].handle).toBe('bob');
    });

    it('filters by search term matching handle or displayName case-insensitively', () => {
      const res = filterDirectoryCandidates([cardA, cardB], {
        skills: [],
        skillMatchMode: 'AND',
        role: null,
        desiredRole: null,
        minHours: null,
        maxHours: null,
        badge: null,
        goal: null,
        search: 'ALICE',
      });

      expect(res).toHaveLength(1);
      expect(res[0].handle).toBe('alice');
    });
  });
});

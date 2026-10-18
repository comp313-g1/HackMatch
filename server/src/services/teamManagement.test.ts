import { describe, it, expect, vi } from 'vitest';
import {
  getOwnerTeamView,
  getMyTeamView,
  updateListing,
  addVacancy,
  updateVacancy,
} from './teamManagement.js';
import { TeamServiceError } from './teamErrors.js';
import type { ITeamsRepository } from '../db/teams.repository.js';
import type { Team, TeamVacancy } from '../db/types.js';

describe('teamManagement service unit tests (US-012 / #120)', () => {
  const actorId = 'p1000000-0000-4000-8000-000000000001';
  const otherActorId = 'p9999999-0000-4000-8000-000000000001';
  const teamId = 't1000000-0000-4000-8000-000000000001';
  const eventId = 'e1000000-0000-4000-8000-000000000001';
  const vacancyId = 'v1000000-0000-4000-8000-000000000001';

  const mockTeam: Team = {
    id: teamId,
    event_id: eventId,
    owner_participant_id: actorId,
    name: 'ByteCrafters',
    pitch: 'Building educational AI tools',
    goal: 'Project Completion',
    commitment_hours: 15.0,
    communication_link: 'https://discord.gg/example',
    recruitment_status: 'Open',
    disbanded_at: null,
    created_at: '2026-10-18T10:00:00.000Z',
    updated_at: '2026-10-18T10:00:00.000Z',
  };

  const mockVacancy: TeamVacancy = {
    id: vacancyId,
    team_id: teamId,
    role: 'Frontend',
    skills: ['React'],
    status: 'Open',
    removed_at: null,
    created_at: '2026-10-18T10:05:00.000Z',
    updated_at: '2026-10-18T10:05:00.000Z',
  };

  const mockParts = {
    team: mockTeam,
    event: { max_team_size: 4 },
    members: [
      {
        participant_id: actorId,
        role: 'Owner' as const,
        joined_at: '2026-10-18T10:00:00.000Z',
        handle: 'owner_lead',
        full_name: 'Lead Owner',
      },
    ],
    vacancies: [mockVacancy],
  };

  describe('getOwnerTeamView', () => {
    it('throws 404 TEAM_NOT_FOUND when team does not exist', async () => {
      const mockRepo = {
        findTeamById: vi.fn().mockResolvedValue(null),
        getTeamViewParts: vi.fn(),
      } as unknown as ITeamsRepository;

      await expect(getOwnerTeamView(actorId, teamId, { repo: mockRepo })).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(TeamServiceError);
        expect((err as TeamServiceError).code).toBe('TEAM_NOT_FOUND');
        expect((err as TeamServiceError).status).toBe(404);
        return true;
      });
    });

    it('throws 403 FORBIDDEN_NOT_TEAM_OWNER when actor is not the owner', async () => {
      const mockRepo = {
        findTeamById: vi.fn().mockResolvedValue(mockTeam),
        getTeamViewParts: vi.fn(),
      } as unknown as ITeamsRepository;

      await expect(getOwnerTeamView(otherActorId, teamId, { repo: mockRepo })).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(TeamServiceError);
        expect((err as TeamServiceError).code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
        expect((err as TeamServiceError).status).toBe(403);
        return true;
      });
    });

    it('returns TeamView when actor is the verified owner', async () => {
      const mockRepo = {
        findTeamById: vi.fn().mockResolvedValue(mockTeam),
        getTeamViewParts: vi.fn().mockResolvedValue(mockParts),
      } as unknown as ITeamsRepository;

      const view = await getOwnerTeamView(actorId, teamId, { repo: mockRepo });
      expect(view.id).toBe(teamId);
      expect(view.name).toBe('ByteCrafters');
      expect(view.members).toHaveLength(1);
    });
  });

  describe('getMyTeamView', () => {
    it('returns null when participant has no confirmed team membership in the event', async () => {
      const mockRepo = {
        findConfirmedTeamIdForParticipant: vi.fn().mockResolvedValue(null),
      } as unknown as ITeamsRepository;

      const view = await getMyTeamView(actorId, eventId, { repo: mockRepo });
      expect(view).toBeNull();
    });

    it('returns TeamView when participant has a confirmed team membership in the event', async () => {
      const mockRepo = {
        findConfirmedTeamIdForParticipant: vi.fn().mockResolvedValue(teamId),
        getTeamViewParts: vi.fn().mockResolvedValue(mockParts),
      } as unknown as ITeamsRepository;

      const view = await getMyTeamView(actorId, eventId, { repo: mockRepo });
      expect(view).not.toBeNull();
      expect(view?.id).toBe(teamId);
    });
  });

  describe('updateListing', () => {
    it('calls repo.updateTeamListing with actorId and patch, then returns updated TeamView', async () => {
      const patch = { pitch: 'Updated pitch for the team' };
      const updatedTeam = { ...mockTeam, pitch: patch.pitch };
      const mockRepo = {
        updateTeamListing: vi.fn().mockResolvedValue(updatedTeam),
        getTeamViewParts: vi.fn().mockResolvedValue({
          ...mockParts,
          team: updatedTeam,
        }),
      } as unknown as ITeamsRepository;

      const view = await updateListing(actorId, teamId, patch, { repo: mockRepo });
      expect(mockRepo.updateTeamListing).toHaveBeenCalledWith(actorId, teamId, patch);
      expect(view.pitch).toBe(patch.pitch);
    });
  });

  describe('addVacancy', () => {
    it('calls repo.addTeamVacancy with actorId, teamId, role, and skills, returning updated TeamView', async () => {
      const newVacInput = { role: 'AI/ML' as const, skills: ['Python', 'PyTorch'] };
      const mockRepo = {
        addTeamVacancy: vi.fn().mockResolvedValue({
          id: 'v2',
          team_id: teamId,
          role: newVacInput.role,
          skills: newVacInput.skills,
          status: 'Open',
        }),
        getTeamViewParts: vi.fn().mockResolvedValue(mockParts),
      } as unknown as ITeamsRepository;

      const view = await addVacancy(actorId, teamId, newVacInput, { repo: mockRepo });
      expect(mockRepo.addTeamVacancy).toHaveBeenCalledWith(actorId, teamId, newVacInput.role, newVacInput.skills);
      expect(view.id).toBe(teamId);
    });

    it('maps CAPACITY_EXCEEDED error from repository RPC to TeamServiceError', async () => {
      const mockRepo = {
        addTeamVacancy: vi.fn().mockRejectedValue({
          message: 'CAPACITY_EXCEEDED',
          code: 'P0001',
          detail: JSON.stringify({ max: 4, confirmed: 3, open: 1 }),
        }),
      } as unknown as ITeamsRepository;

      await expect(
        addVacancy(actorId, teamId, { role: 'Backend', skills: [] }, { repo: mockRepo })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(TeamServiceError);
        const serviceErr = err as TeamServiceError;
        expect(serviceErr.code).toBe('CAPACITY_EXCEEDED');
        expect(serviceErr.status).toBe(409);
        expect(serviceErr.details).toEqual({ max: 4, confirmed: 3, open: 1 });
        return true;
      });
    });
  });

  describe('updateVacancy', () => {
    it('calls repo.updateTeamVacancy with actorId, teamId, vacancyId, role, and skills', async () => {
      const updateInput = { role: 'UI/UX' as const, skills: ['Figma'] };
      const mockRepo = {
        updateTeamVacancy: vi.fn().mockResolvedValue({
          ...mockVacancy,
          role: updateInput.role,
          skills: updateInput.skills,
        }),
        getTeamViewParts: vi.fn().mockResolvedValue(mockParts),
      } as unknown as ITeamsRepository;

      const view = await updateVacancy(actorId, teamId, vacancyId, updateInput, { repo: mockRepo });
      expect(mockRepo.updateTeamVacancy).toHaveBeenCalledWith(
        actorId,
        teamId,
        vacancyId,
        updateInput.role,
        updateInput.skills
      );
      expect(view.id).toBe(teamId);
    });
  });
});

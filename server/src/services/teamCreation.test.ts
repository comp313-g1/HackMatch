import { describe, it, expect, vi } from 'vitest';
import { createTeam } from './teamCreation.js';
import { TeamServiceError, type TeamErrorCode } from './teamErrors.js';
import type { ITeamsRepository, CreateTeamWithOwnerInput } from '../db/teams.repository.js';
import type { Team, TeamMembership } from '../db/types.js';

describe('teamCreation service unit tests (US-012 / #119)', () => {
  const sampleInput: CreateTeamWithOwnerInput = {
    ownerParticipantId: 'p1000000-0000-4000-8000-000000000001',
    eventId: 'e1000000-0000-4000-8000-000000000001',
    name: 'Hackers United',
    pitch: 'Building an innovative AI tool',
    goal: 'Project Completion',
    commitmentHours: 20.0,
    communicationLink: 'https://discord.gg/example',
  };

  const sampleTeam: Team = {
    id: 't1000000-0000-4000-8000-000000000001',
    event_id: sampleInput.eventId,
    owner_participant_id: sampleInput.ownerParticipantId,
    name: sampleInput.name,
    pitch: sampleInput.pitch,
    goal: sampleInput.goal,
    commitment_hours: sampleInput.commitmentHours,
    communication_link: sampleInput.communicationLink,
    recruitment_status: 'Open',
    disbanded_at: null,
    created_at: '2026-10-18T10:00:00.000Z',
    updated_at: '2026-10-18T10:00:00.000Z',
  };

  const sampleMembership: TeamMembership = {
    id: 'm1000000-0000-4000-8000-000000000001',
    team_id: sampleTeam.id,
    event_id: sampleInput.eventId,
    participant_id: sampleInput.ownerParticipantId,
    role: 'Owner',
    status: 'Confirmed',
    removal_reason: null,
    joined_at: '2026-10-18T10:00:00.000Z',
    ended_at: null,
    created_at: '2026-10-18T10:00:00.000Z',
    updated_at: '2026-10-18T10:00:00.000Z',
  };

  it('passes through successful team creation', async () => {
    const mockRepo: ITeamsRepository = {
      createTeamWithOwner: vi.fn().mockResolvedValue({
        team: sampleTeam,
        membership: sampleMembership,
      }),
    };

    const result = await createTeam(sampleInput, { repo: mockRepo });
    expect(result).toEqual({ team: sampleTeam, membership: sampleMembership });
    expect(mockRepo.createTeamWithOwner).toHaveBeenCalledWith(sampleInput);
  });

  const catalogTestCases: Array<{ message: TeamErrorCode; expectedStatus: number }> = [
    { message: 'EVENT_NOT_FOUND', expectedStatus: 404 },
    { message: 'EVENT_NOT_RECRUITING', expectedStatus: 409 },
    { message: 'ALREADY_CONFIRMED_MEMBER', expectedStatus: 409 },
    { message: 'PARTICIPANT_NOT_ELIGIBLE', expectedStatus: 403 },
    { message: 'VALIDATION_ERROR', expectedStatus: 400 },
  ];

  for (const { message, expectedStatus } of catalogTestCases) {
    it(`maps database error with message "${message}" to TeamServiceError with status ${expectedStatus}`, async () => {
      const mockRepo: ITeamsRepository = {
        createTeamWithOwner: vi.fn().mockRejectedValue({
          message,
          code: 'P0001',
        }),
      };

      await expect(createTeam(sampleInput, { repo: mockRepo })).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(TeamServiceError);
        const serviceErr = err as TeamServiceError;
        expect(serviceErr.code).toBe(message);
        expect(serviceErr.status).toBe(expectedStatus);
        return true;
      });
    });
  }

  it('maps PostgreSQL 23505 unique violation on uq_team_memberships_confirmed_per_event to ALREADY_CONFIRMED_MEMBER', async () => {
    const mockRepo: ITeamsRepository = {
      createTeamWithOwner: vi.fn().mockRejectedValue({
        code: '23505',
        message: 'duplicate key value violates unique constraint "uq_team_memberships_confirmed_per_event"',
        details: 'Key (event_id, participant_id)=(...) already exists.',
      }),
    };

    await expect(createTeam(sampleInput, { repo: mockRepo })).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(TeamServiceError);
      const serviceErr = err as TeamServiceError;
      expect(serviceErr.code).toBe('ALREADY_CONFIRMED_MEMBER');
      expect(serviceErr.status).toBe(409);
      return true;
    });
  });

  const postgresValidationCodes = ['23514', '22001', '22003', '22P02'];
  for (const code of postgresValidationCodes) {
    it(`maps PostgreSQL error code ${code} to VALIDATION_ERROR with status 400`, async () => {
      const mockRepo: ITeamsRepository = {
        createTeamWithOwner: vi.fn().mockRejectedValue({
          code,
          message: 'constraint or value length error',
        }),
      };

      await expect(createTeam(sampleInput, { repo: mockRepo })).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(TeamServiceError);
        const serviceErr = err as TeamServiceError;
        expect(serviceErr.code).toBe('VALIDATION_ERROR');
        expect(serviceErr.status).toBe(400);
        return true;
      });
    });
  }

  it('re-throws unmapped errors like ECONNRESET or unknown database errors directly without mapping', async () => {
    const unknownErr = new Error('ECONNRESET');
    const mockRepo: ITeamsRepository = {
      createTeamWithOwner: vi.fn().mockRejectedValue(unknownErr),
    };

    await expect(createTeam(sampleInput, { repo: mockRepo })).rejects.toBe(unknownErr);
  });
});

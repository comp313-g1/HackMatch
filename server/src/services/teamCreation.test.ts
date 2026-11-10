import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTeam } from './teamCreation.js';
import { TeamServiceError, type TeamErrorCode } from './teamErrors.js';
import { teamsRepository, type ITeamsRepository, type CreateTeamWithOwnerInput } from '../db/teams.repository.js';
import { chatRepository } from '../db/chat.repository.js';
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
    locked_at: null,
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
    const mockRepo = {
      createTeamWithOwner: vi.fn().mockResolvedValue({
        team: sampleTeam,
        membership: sampleMembership,
      }),
    } as unknown as ITeamsRepository;

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
      const mockRepo = {
        createTeamWithOwner: vi.fn().mockRejectedValue({
          message,
          code: 'P0001',
        }),
      } as unknown as ITeamsRepository;

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
    const mockRepo = {
      createTeamWithOwner: vi.fn().mockRejectedValue({
        code: '23505',
        message: 'duplicate key value violates unique constraint "uq_team_memberships_confirmed_per_event"',
        details: 'Key (event_id, participant_id)=(...) already exists.',
      }),
    } as unknown as ITeamsRepository;

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
      const mockRepo = {
        createTeamWithOwner: vi.fn().mockRejectedValue({
          code,
          message: 'constraint or value length error',
        }),
      } as unknown as ITeamsRepository;

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
    const mockRepo = {
      createTeamWithOwner: vi.fn().mockRejectedValue(unknownErr),
    } as unknown as ITeamsRepository;

    await expect(createTeam(sampleInput, { repo: mockRepo })).rejects.toBe(unknownErr);
  });

  describe('private chat channel provisioning (#431)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const repoThatCreates = () =>
      ({
        createTeamWithOwner: vi.fn().mockResolvedValue({ team: sampleTeam, membership: sampleMembership }),
      }) as unknown as ITeamsRepository;

    it('creates the team chat channel right after the team exists', async () => {
      const provisionTeamChannel = vi.fn().mockResolvedValue({ created: true });
      const result = await createTeam(sampleInput, { repo: repoThatCreates(), provisionTeamChannel });
      expect(provisionTeamChannel).toHaveBeenCalledTimes(1);
      expect(provisionTeamChannel).toHaveBeenCalledWith(sampleTeam.id);
      expect(result.team.id).toBe(sampleTeam.id);
    });

    it('still returns the new team when the channel could not be created (it is created on first open)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const provisionTeamChannel = vi.fn().mockRejectedValue(new Error('chat database unavailable'));

      const result = await createTeam(sampleInput, { repo: repoThatCreates(), provisionTeamChannel });

      expect(result.team.id).toBe(sampleTeam.id);
      expect(result.membership.role).toBe('Owner');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(sampleTeam.id));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('chat database unavailable'));
      warn.mockRestore();
    });

    it('does not create a channel when the team itself could not be created', async () => {
      const provisionTeamChannel = vi.fn();
      const failing = {
        createTeamWithOwner: vi.fn().mockRejectedValue(new Error('ECONNRESET')),
      } as unknown as ITeamsRepository;

      await expect(createTeam(sampleInput, { repo: failing, provisionTeamChannel })).rejects.toThrow('ECONNRESET');
      expect(provisionTeamChannel).not.toHaveBeenCalled();
    });

    it('creates the channel after the owner availability is cleared, and not before the team exists', async () => {
      const order: string[] = [];
      const repo = {
        createTeamWithOwner: vi.fn().mockImplementation(async () => {
          order.push('team');
          return { team: sampleTeam, membership: sampleMembership };
        }),
      } as unknown as ITeamsRepository;
      await createTeam(sampleInput, {
        repo,
        availabilityRepo: {
          clearLookingForTeamStatus: vi.fn().mockImplementation(async () => {
            order.push('availability');
            return true;
          }),
        },
        provisionTeamChannel: vi.fn().mockImplementation(async () => {
          order.push('channel');
        }),
      });
      expect(order).toEqual(['team', 'availability', 'channel']);
    });

    it('the production default (no dependencies passed, as the create-team endpoint does) creates the channel', async () => {
      vi.spyOn(teamsRepository, 'createTeamWithOwner').mockResolvedValue({ team: sampleTeam, membership: sampleMembership });
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
      vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(null);
      const provision = vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel').mockResolvedValue({
        channel: { id: 'c1', title: 'Team: Hackers United', description: 'd', created_by: sampleTeam.owner_participant_id, channel_type: 'team', team_id: sampleTeam.id, created_at: 'x', updated_at: 'x' },
        created: true,
      });

      await createTeam(sampleInput);

      expect(provision).toHaveBeenCalledTimes(1);
      expect(provision).toHaveBeenCalledWith(
        expect.objectContaining({ team_id: sampleTeam.id, created_by: sampleTeam.owner_participant_id })
      );
    });

    it('callers that pass no provisioning dependency (older tests, scripts) skip the step', async () => {
      await expect(createTeam(sampleInput, { repo: repoThatCreates() })).resolves.toMatchObject({
        team: { id: sampleTeam.id },
      });
    });
  });
});

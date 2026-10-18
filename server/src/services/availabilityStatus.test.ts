import { describe, it, expect, vi } from 'vitest';
import {
  deactivateParticipantAvailability,
  confirmMembershipAndClearAvailability,
} from './availabilityStatus.js';
import { createTeam } from './teamCreation.js';
import type { ITeamsRepository } from '../db/teams.repository.js';
import type { Team, TeamMembership } from '../db/types.js';

describe('Availability Status & Automatic Deactivation (US-011-T2 / AC 4)', () => {
  const sampleParticipantId = '11111111-1111-4111-8111-111111111111';

  describe('deactivateParticipantAvailability', () => {
    it('calls repository to clear looking status and returns true when row was updated', async () => {
      const mockRepo = {
        clearLookingForTeamStatus: vi.fn().mockResolvedValue(true),
        findByParticipantId: vi.fn(),
        upsertByParticipantId: vi.fn(),
      };

      const result = await deactivateParticipantAvailability(sampleParticipantId, {
        availabilityRepo: mockRepo,
      });

      expect(mockRepo.clearLookingForTeamStatus).toHaveBeenCalledWith(sampleParticipantId);
      expect(result).toEqual({
        participantId: sampleParticipantId,
        deactivated: true,
      });
    });

    it('returns false when participant had no active looking row to deactivate', async () => {
      const mockRepo = {
        clearLookingForTeamStatus: vi.fn().mockResolvedValue(false),
        findByParticipantId: vi.fn(),
        upsertByParticipantId: vi.fn(),
      };

      const result = await deactivateParticipantAvailability(sampleParticipantId, {
        availabilityRepo: mockRepo,
      });

      expect(result).toEqual({
        participantId: sampleParticipantId,
        deactivated: false,
      });
    });
  });

  describe('confirmMembershipAndClearAvailability', () => {
    it('executes membership action and then automatically deactivates availability', async () => {
      const mockMembership = {
        id: 'mem-123',
        status: 'Confirmed',
        participant_id: sampleParticipantId,
      };

      const mockAction = vi.fn().mockResolvedValue(mockMembership);
      const mockRepo = {
        clearLookingForTeamStatus: vi.fn().mockResolvedValue(true),
        findByParticipantId: vi.fn(),
        upsertByParticipantId: vi.fn(),
      };

      const result = await confirmMembershipAndClearAvailability(
        sampleParticipantId,
        mockAction,
        { availabilityRepo: mockRepo }
      );

      expect(mockAction).toHaveBeenCalledTimes(1);
      expect(mockRepo.clearLookingForTeamStatus).toHaveBeenCalledWith(sampleParticipantId);
      expect(result).toEqual({
        membership: mockMembership,
        availabilityDeactivated: true,
      });
    });
  });

  describe('createTeam integration with availabilityRepo', () => {
    it('clears owner Looking-for-Team status when availabilityRepo is provided to createTeam', async () => {
      const sampleTeam: Team = {
        id: 'team-1',
        event_id: 'event-1',
        owner_participant_id: sampleParticipantId,
        name: 'Alpha Team',
        pitch: 'AI for good',
        goal: 'Competitive',
        commitment_hours: 20,
        communication_link: null,
        recruitment_status: 'Open',
        disbanded_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const sampleMembership: TeamMembership = {
        id: 'mem-1',
        team_id: 'team-1',
        event_id: 'event-1',
        participant_id: sampleParticipantId,
        role: 'Owner',
        status: 'Confirmed',
        removal_reason: null,
        joined_at: new Date().toISOString(),
        ended_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockTeamsRepo = {
        createTeamWithOwner: vi.fn().mockResolvedValue({
          team: sampleTeam,
          membership: sampleMembership,
        }),
      } as unknown as ITeamsRepository;

      const mockAvailabilityRepo = {
        clearLookingForTeamStatus: vi.fn().mockResolvedValue(true),
      };

      const result = await createTeam(
        {
          ownerParticipantId: sampleParticipantId,
          eventId: 'event-1',
          name: 'Alpha Team',
          pitch: 'AI for good',
          goal: 'Competitive',
          commitmentHours: 20,
          communicationLink: null,
        },
        {
          repo: mockTeamsRepo,
          availabilityRepo: mockAvailabilityRepo,
        }
      );

      expect(result.team.id).toBe('team-1');
      expect(mockTeamsRepo.createTeamWithOwner).toHaveBeenCalled();
      expect(mockAvailabilityRepo.clearLookingForTeamStatus).toHaveBeenCalledWith(
        sampleParticipantId
      );
    });
  });
});

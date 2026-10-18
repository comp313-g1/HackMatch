import { getSupabaseClient } from './client.js';
import type { Team, TeamMembership, TeamGoal } from './types.js';

export interface CreateTeamWithOwnerInput {
  ownerParticipantId: string;
  eventId: string;
  name: string;
  pitch: string;
  goal: TeamGoal;
  commitmentHours: number;
  communicationLink: string | null;
}

export interface ITeamsRepository {
  createTeamWithOwner(input: CreateTeamWithOwnerInput): Promise<{ team: Team; membership: TeamMembership }>;
}

export const teamsRepository: ITeamsRepository = {
  async createTeamWithOwner(input: CreateTeamWithOwnerInput): Promise<{ team: Team; membership: TeamMembership }> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('create_team_with_owner', {
      p_owner_id: input.ownerParticipantId,
      p_event_id: input.eventId,
      p_name: input.name,
      p_pitch: input.pitch,
      p_goal: input.goal,
      p_commitment_hours: input.commitmentHours,
      p_communication_link: input.communicationLink,
    });

    if (error) {
      throw error;
    }

    return data as { team: Team; membership: TeamMembership };
  },
};

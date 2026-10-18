import { teamsRepository, type ITeamsRepository, type CreateTeamWithOwnerInput } from '../db/teams.repository.js';
import { toTeamServiceError } from './teamErrors.js';
import type { Team, TeamMembership } from '../db/types.js';

export interface CreateTeamServiceInput {
  ownerParticipantId: string;
  eventId?: string;
  name: string;
  pitch: string;
  goal: CreateTeamWithOwnerInput['goal'];
  commitmentHours: number;
  communicationLink: string | null;
  maxTeamSize?: number;
}

export async function createTeam(
  input: CreateTeamServiceInput,
  deps: { repo: ITeamsRepository } = { repo: teamsRepository }
): Promise<{ team: Team; membership: TeamMembership }> {
  try {
    let effectiveEventId = input.eventId;
    if (!effectiveEventId || effectiveEventId.trim() === '') {
      effectiveEventId = await deps.repo.createShadowEvent(input.name, input.maxTeamSize);
    }

    return await deps.repo.createTeamWithOwner({
      ...input,
      eventId: effectiveEventId,
    });
  } catch (err: unknown) {
    const serviceError = toTeamServiceError(err);
    if (serviceError) {
      throw serviceError;
    }
    throw err;
  }
}

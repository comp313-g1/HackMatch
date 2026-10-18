import { teamsRepository, type ITeamsRepository, type CreateTeamWithOwnerInput } from '../db/teams.repository.js';
import { toTeamServiceError } from './teamErrors.js';
import type { Team, TeamMembership } from '../db/types.js';

export async function createTeam(
  input: CreateTeamWithOwnerInput,
  deps: { repo: ITeamsRepository } = { repo: teamsRepository }
): Promise<{ team: Team; membership: TeamMembership }> {
  try {
    return await deps.repo.createTeamWithOwner(input);
  } catch (err: unknown) {
    const serviceError = toTeamServiceError(err);
    if (serviceError) {
      throw serviceError;
    }
    throw err;
  }
}

import { teamsRepository, type ITeamsRepository, type CreateTeamWithOwnerInput } from '../db/teams.repository.js';
import { toTeamServiceError } from './teamErrors.js';
import type { Team, TeamMembership } from '../db/types.js';
import { provisionOrLinkTeamChannel } from './chat.js';

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

export interface TeamCreationDeps {
  repo: ITeamsRepository;
  availabilityRepo?: { clearLookingForTeamStatus(participantId: string): Promise<boolean> };
  /**
   * #431: creates the team's private chat channel right after the team exists. Failure is logged and
   * never fails team creation; the channel is then created the first time a member opens the chat.
   */
  provisionTeamChannel?: (teamId: string) => Promise<unknown>;
}

const defaultDeps: TeamCreationDeps = {
  repo: teamsRepository,
  provisionTeamChannel: (teamId) => provisionOrLinkTeamChannel({ teamId }),
};

export async function createTeam(
  input: CreateTeamServiceInput,
  deps: TeamCreationDeps = defaultDeps
): Promise<{ team: Team; membership: TeamMembership }> {
  try {
    let effectiveEventId = input.eventId;
    if (!effectiveEventId || effectiveEventId.trim() === '') {
      effectiveEventId = await deps.repo.createShadowEvent(input.name, input.maxTeamSize);
    }

    const result = await deps.repo.createTeamWithOwner({
      ...input,
      eventId: effectiveEventId,
    });

    if (deps.availabilityRepo) {
      await deps.availabilityRepo.clearLookingForTeamStatus(input.ownerParticipantId);
    }

    if (deps.provisionTeamChannel) {
      try {
        await deps.provisionTeamChannel(result.team.id);
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[TEAMS] Team ${result.team.id} was created but its chat channel was not: ${reason}`);
      }
    }

    return result;
  } catch (err: unknown) {
    const serviceError = toTeamServiceError(err);
    if (serviceError) {
      throw serviceError;
    }
    throw err;
  }
}

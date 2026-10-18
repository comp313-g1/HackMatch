import { teamsRepository, type ITeamsRepository, type TeamListingPatch } from '../db/teams.repository.js';
import { toTeamServiceError, TeamServiceError } from './teamErrors.js';
import { toTeamView, type TeamView } from './teamView.js';
import type { ParticipantPrimaryRole } from '../db/types.js';

export async function getOwnerTeamView(
  actorId: string,
  teamId: string,
  deps: { repo: ITeamsRepository } = { repo: teamsRepository }
): Promise<TeamView> {
  try {
    const team = await deps.repo.findTeamById(teamId);
    if (!team) {
      throw new TeamServiceError('TEAM_NOT_FOUND');
    }
    if (team.owner_participant_id !== actorId) {
      throw new TeamServiceError('FORBIDDEN_NOT_TEAM_OWNER');
    }
    const parts = await deps.repo.getTeamViewParts(teamId);
    return toTeamView(parts);
  } catch (err: unknown) {
    const serviceError = toTeamServiceError(err);
    if (serviceError) throw serviceError;
    throw err;
  }
}

export async function getMyTeamView(
  actorId: string,
  eventId: string,
  deps: { repo: ITeamsRepository } = { repo: teamsRepository }
): Promise<TeamView | null> {
  try {
    const teamId = await deps.repo.findConfirmedTeamIdForParticipant(actorId, eventId);
    if (!teamId) {
      return null;
    }
    const parts = await deps.repo.getTeamViewParts(teamId);
    return toTeamView(parts);
  } catch (err: unknown) {
    const serviceError = toTeamServiceError(err);
    if (serviceError) throw serviceError;
    throw err;
  }
}

export async function updateListing(
  actorId: string,
  teamId: string,
  patch: TeamListingPatch,
  deps: { repo: ITeamsRepository } = { repo: teamsRepository }
): Promise<TeamView> {
  try {
    await deps.repo.updateTeamListing(actorId, teamId, patch);
    const parts = await deps.repo.getTeamViewParts(teamId);
    return toTeamView(parts);
  } catch (err: unknown) {
    const serviceError = toTeamServiceError(err);
    if (serviceError) throw serviceError;
    throw err;
  }
}

export async function addVacancy(
  actorId: string,
  teamId: string,
  v: { role: ParticipantPrimaryRole; skills: string[] },
  deps: { repo: ITeamsRepository } = { repo: teamsRepository }
): Promise<TeamView> {
  try {
    await deps.repo.addTeamVacancy(actorId, teamId, v.role, v.skills);
    const parts = await deps.repo.getTeamViewParts(teamId);
    return toTeamView(parts);
  } catch (err: unknown) {
    const serviceError = toTeamServiceError(err);
    if (serviceError) throw serviceError;
    throw err;
  }
}

export async function updateVacancy(
  actorId: string,
  teamId: string,
  vacancyId: string,
  v: { role: ParticipantPrimaryRole; skills: string[] },
  deps: { repo: ITeamsRepository } = { repo: teamsRepository }
): Promise<TeamView> {
  try {
    await deps.repo.updateTeamVacancy(actorId, teamId, vacancyId, v.role, v.skills);
    const parts = await deps.repo.getTeamViewParts(teamId);
    return toTeamView(parts);
  } catch (err: unknown) {
    const serviceError = toTeamServiceError(err);
    if (serviceError) throw serviceError;
    throw err;
  }
}

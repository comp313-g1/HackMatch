import type {
  ApplicationDeclineEffects,
  ApplicationStatusAlertRecord,
  ITeamsRepository,
} from '../db/teams.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { TeamServiceError, toTeamServiceError } from './teamErrors.js';

export interface DeclineApplicationInput {
  actorParticipantId: string;
  applicationId: string;
}

export interface ApplicationDeclineDeps {
  teamsRepo: Pick<
    ITeamsRepository,
    'findApplicationById' | 'findTeamById' | 'declineTeamApplication'
  >;
}

export interface ApplicationDeclineResult {
  decision: 'decline';
  application: {
    id: string;
    teamId: string;
    eventId: string;
    vacancyId: string | null;
    applicantParticipantId: string;
    status: string;
    statusLabel: string;
    requestType: 'Application';
    message: string | null;
    resolvedAt: string | null;
    cancelReason: string | null;
    teamName: string;
    vacancyRole: string | null;
  };
  changed: boolean;
  idempotent: boolean;
  alerts: ApplicationStatusAlertRecord[];
  effects: ApplicationDeclineEffects;
  notice: string;
}

/**
 * Owner-authorized adapter for FR-062. PostgreSQL locks and rechecks the row;
 * this preflight provides a clear 403 without invoking the mutation RPC.
 */
export async function declineApplication(
  input: DeclineApplicationInput,
  deps: ApplicationDeclineDeps = { teamsRepo: teamsRepository }
): Promise<ApplicationDeclineResult> {
  const application = await deps.teamsRepo.findApplicationById(input.applicationId);
  if (!application) throw new TeamServiceError('APPLICATION_NOT_FOUND');

  const team = await deps.teamsRepo.findTeamById(application.team_id);
  if (!team) throw new TeamServiceError('TEAM_NOT_FOUND');
  if (team.owner_participant_id !== input.actorParticipantId) {
    throw new TeamServiceError('FORBIDDEN_NOT_TEAM_OWNER');
  }

  try {
    const result = await deps.teamsRepo.declineTeamApplication(
      input.actorParticipantId,
      input.applicationId
    );
    const declined = result.application;
    return {
      decision: 'decline',
      application: {
        id: declined.id,
        teamId: declined.team_id,
        eventId: declined.event_id,
        vacancyId: declined.vacancy_id,
        applicantParticipantId: declined.participant_id,
        status: declined.status,
        statusLabel: declined.status,
        requestType: 'Application',
        message: declined.message,
        resolvedAt: declined.resolved_at,
        cancelReason: declined.cancel_reason,
        teamName: result.teamName,
        vacancyRole: result.vacancyRole,
      },
      changed: result.changed,
      idempotent: result.idempotent,
      alerts: result.alerts,
      effects: result.effects,
      notice: result.notice,
    };
  } catch (err: unknown) {
    const mapped = toTeamServiceError(err);
    if (mapped) throw mapped;
    throw err;
  }
}

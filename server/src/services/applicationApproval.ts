import type { ITeamsRepository } from '../db/teams.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { TeamServiceError, toTeamServiceError } from './teamErrors.js';

export interface ApproveApplicationInput {
  actorParticipantId: string;
  applicationId: string;
}

export interface ApplicationApprovalDeps {
  teamsRepo: Pick<
    ITeamsRepository,
    'findApplicationById' | 'findTeamById' | 'approveTeamApplication'
  >;
}

export interface ApplicationApprovalResult {
  approved: true;
  application: {
    id: string;
    teamId: string;
    eventId: string;
    vacancyId: string | null;
    applicantParticipantId: string;
    status: string;
    statusLabel: string;
    requestType: 'Application';
    resolvedAt: string | null;
    teamName: string;
    vacancyRole: string;
  };
  membership: {
    id: string;
    teamId: string;
    eventId: string;
    participantId: string;
    role: string;
    status: string;
    joinedAt: string;
  };
  vacancy: { id: string; role: string; status: string };
  memberCount: number;
  maxTeamSize: number;
  availabilityCleared: boolean;
  membershipCommitted: boolean;
  cascade: {
    winningRequestId?: string;
    eventInvitationsCanceled: number;
    eventApplicationsWithdrawn: number;
    slotRequestsCanceled: number;
    teamRequestsCanceled: number;
    teamNowFull: boolean;
  };
  notice: string;
}

/**
 * Owner-authorized adapter for the authoritative PostgreSQL approval transaction.
 * Ownership is checked before the RPC for a clear 403 and rechecked inside SQL.
 */
export async function approveApplication(
  input: ApproveApplicationInput,
  deps: ApplicationApprovalDeps = { teamsRepo: teamsRepository }
): Promise<ApplicationApprovalResult> {
  const application = await deps.teamsRepo.findApplicationById(input.applicationId);
  if (!application) throw new TeamServiceError('APPLICATION_NOT_FOUND');

  const team = await deps.teamsRepo.findTeamById(application.team_id);
  if (!team) throw new TeamServiceError('TEAM_NOT_FOUND');
  if (team.owner_participant_id !== input.actorParticipantId) {
    throw new TeamServiceError('FORBIDDEN_NOT_TEAM_OWNER');
  }

  try {
    const result = await deps.teamsRepo.approveTeamApplication(
      input.actorParticipantId,
      input.applicationId
    );
    return {
      approved: true,
      application: {
        id: result.application.id,
        teamId: result.application.team_id,
        eventId: result.application.event_id,
        vacancyId: result.application.vacancy_id,
        applicantParticipantId: result.application.participant_id,
        status: result.application.status,
        statusLabel: result.application.status,
        requestType: 'Application',
        resolvedAt: result.application.resolved_at,
        teamName: result.teamName,
        vacancyRole: result.vacancyRole,
      },
      membership: {
        id: result.membership.id,
        teamId: result.membership.team_id,
        eventId: result.membership.event_id,
        participantId: result.membership.participant_id,
        role: result.membership.role,
        status: result.membership.status,
        joinedAt: result.membership.joined_at,
      },
      vacancy: {
        id: result.vacancy.id,
        role: result.vacancy.role,
        status: result.vacancy.status,
      },
      memberCount: result.memberCount,
      maxTeamSize: result.maxTeamSize,
      availabilityCleared: result.availabilityCleared,
      membershipCommitted: result.membershipCommitted,
      cascade: result.cascade,
      notice: result.notice,
    };
  } catch (err: unknown) {
    const mapped = toTeamServiceError(err);
    if (mapped) throw mapped;

    if (typeof err === 'object' && err !== null) {
      const databaseCode = (err as { code?: unknown }).code;
      if (
        typeof databaseCode === 'string' &&
        ['40P01', '40001', '55P03'].includes(databaseCode)
      ) {
        throw new TeamServiceError('APPLICATION_APPROVAL_CONFLICT', {
          applicationId: input.applicationId,
          reason: 'DATABASE_CONCURRENCY_RETRY',
          retryable: true,
        });
      }
    }
    throw err;
  }
}


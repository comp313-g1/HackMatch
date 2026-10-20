/**
 * US-018 / #172 team application submission.
 * Atomic pending-count and duplicate checks live in submit_team_application (FR-054 / FR-053).
 */
import { teamsRepository } from '../db/teams.repository.js';
import type { TeamRequest } from '../db/types.js';
import { TeamServiceError, toTeamServiceError } from './teamErrors.js';

export interface SubmitApplicationInput {
  actorParticipantId: string;
  teamId: string;
  vacancyId: string;
  message: string | null;
}

export interface SubmittedApplicationView {
  id: string;
  teamId: string;
  eventId: string;
  vacancyId: string | null;
  applicantParticipantId: string;
  status: TeamRequest['status'];
  requestType: 'Application';
  message: string | null;
  createdAt: string;
  teamName: string;
  vacancyRole: string;
  pendingCountForEvent: number;
  notice: string;
}

function toView(
  application: TeamRequest,
  meta: {
    vacancyRole: string;
    teamName: string;
    pendingCountForEvent: number;
    notice: string;
  }
): SubmittedApplicationView {
  return {
    id: application.id,
    teamId: application.team_id,
    eventId: application.event_id,
    vacancyId: application.vacancy_id,
    applicantParticipantId: application.participant_id,
    status: application.status,
    requestType: 'Application',
    message: application.message ?? null,
    createdAt: application.created_at,
    teamName: meta.teamName,
    vacancyRole: meta.vacancyRole,
    pendingCountForEvent: meta.pendingCountForEvent,
    notice: meta.notice,
  };
}

/**
 * Verified PART applies to an open vacancy (FR-053).
 * Postgres RPC enforces atomic 3-pending-per-event and duplicate-team checks (FR-054).
 */
export async function submitApplication(
  input: SubmitApplicationInput
): Promise<SubmittedApplicationView> {
  try {
    const result = await teamsRepository.submitTeamApplication(
      input.actorParticipantId,
      input.teamId,
      input.vacancyId,
      input.message
    );
    return toView(result.application, {
      vacancyRole: result.vacancyRole,
      teamName: result.teamName,
      pendingCountForEvent: result.pendingCountForEvent,
      notice: result.notice,
    });
  } catch (err: unknown) {
    const mapped = toTeamServiceError(err);
    if (mapped) throw mapped;
    throw err;
  }
}

/** Re-export for tests that assert catalog mapping. */
export { TeamServiceError };

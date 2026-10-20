/**
 * US-018 / #172–#174 team application submission.
 * Express preflight (#173) enforces verified PART, unlocked team, open slot, one-team;
 * Express quota preflight (#174) enforces 3 Pending per PART/event;
 * atomic pending-count / duplicate checks live in submit_team_application (FR-054 / FR-053).
 */
import { teamsRepository } from '../db/teams.repository.js';
import type { TeamRequest } from '../db/types.js';
import {
  assertApplicationSubmissionContext,
  type ApplicationEligibilityDeps,
} from './applicationEligibility.js';
import {
  assertApplicationQuotas,
  type ApplicationQuotaDeps,
} from './applicationQuota.js';
import { TeamServiceError, toTeamServiceError } from './teamErrors.js';

export interface SubmitApplicationInput {
  actorParticipantId: string;
  teamId: string;
  vacancyId: string;
  message: string | null;
}

export interface SubmitApplicationDeps {
  eligibility?: Partial<ApplicationEligibilityDeps>;
  quotas?: Partial<ApplicationQuotaDeps>;
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
 * Verified PART applies to an open vacancy (FR-053 / #173 / #174).
 * Express preflight validates eligibility and 3-pending-per-event quota;
 * Postgres RPC re-checks atomically (FR-054).
 */
export async function submitApplication(
  input: SubmitApplicationInput,
  deps?: SubmitApplicationDeps
): Promise<SubmittedApplicationView> {
  await assertApplicationSubmissionContext(
    {
      actorParticipantId: input.actorParticipantId,
      teamId: input.teamId,
      vacancyId: input.vacancyId,
    },
    deps?.eligibility
  );

  await assertApplicationQuotas(
    {
      actorParticipantId: input.actorParticipantId,
      teamId: input.teamId,
    },
    deps?.quotas
  );

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

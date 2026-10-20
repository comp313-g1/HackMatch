/**
 * US-018 / #172–#176 team applications.
 * Express preflight (#173) enforces verified PART, unlocked team, open slot, one-team;
 * Express limits preflight (#174 / #176) prioritizes duplicate-team errors and
 * enforces 3 Pending per PART/event;
 * atomic pending-count / duplicate checks live in submit_team_application (FR-054 / FR-053);
 * list + withdraw (#175 / FR-055) release quota and emit basic owner/applicant alerts.
 */
import { isApplicationWithdrawable } from '../db/applicationModel.js';
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
 * Verified PART applies to an open vacancy (FR-053 / #173 / #174 / #176).
 * Express preflight validates eligibility, duplicate-team state, and quota;
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

/** UI label for Pending Application rows (FR-053 / FR-055 status inspect). */
export function applicationStatusLabel(status: string): string {
  if (status === 'Pending') return 'Pending Review';
  return status;
}

export interface MyApplicationListItem {
  id: string;
  teamId: string;
  eventId: string;
  vacancyId: string | null;
  applicantParticipantId: string;
  status: TeamRequest['status'];
  /** Human-readable status for ordinary views (Pending → Pending Review). */
  statusLabel: string;
  requestType: 'Application';
  message: string | null;
  createdAt: string;
  resolvedAt: string | null;
  cancelReason: string | null;
  teamName: string;
  vacancyRole: string | null;
  /** True while FR-055 still allows self-withdraw. */
  withdrawable: boolean;
}

export interface MyApplicationsListResult {
  applications: MyApplicationListItem[];
  empty: boolean;
  message: string | null;
}

/**
 * Applicant inspects their application statuses (US-018 / #175 / AC4).
 */
export async function listMyApplications(
  actorParticipantId: string
): Promise<MyApplicationsListResult> {
  const rows = await teamsRepository.listMyApplications(actorParticipantId);
  const applications: MyApplicationListItem[] = rows.map((row) => ({
    id: row.application.id,
    teamId: row.application.team_id,
    eventId: row.application.event_id,
    vacancyId: row.application.vacancy_id,
    applicantParticipantId: row.application.participant_id,
    status: row.application.status,
    statusLabel: applicationStatusLabel(row.application.status),
    requestType: 'Application',
    message: row.application.message ?? null,
    createdAt: row.application.created_at,
    resolvedAt: row.application.resolved_at,
    cancelReason: row.application.cancel_reason,
    teamName: row.teamName,
    vacancyRole: row.vacancyRole,
    withdrawable: isApplicationWithdrawable(row.application.status),
  }));

  return {
    applications,
    empty: applications.length === 0,
    message:
      applications.length === 0
        ? 'No applications yet. Browse open teams and apply to an open slot.'
        : null,
  };
}

export interface ApplicationStatusAlert {
  audience: 'applicant' | 'owner' | string;
  type: string;
  message: string;
}

export interface WithdrawnApplicationResult {
  application: {
    id: string;
    teamId: string;
    eventId: string;
    vacancyId: string | null;
    applicantParticipantId: string;
    status: TeamRequest['status'];
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
  alerts: ApplicationStatusAlert[];
  notice: string;
}

/**
 * Applicant withdraws a Pending Review application (US-018 / #175 / FR-055).
 * Releases pending quota; writes basic status alerts for applicant and owner.
 * Repeated withdraw of an already-Withdrawn application is idempotent.
 */
export async function withdrawApplication(
  actorParticipantId: string,
  applicationId: string
): Promise<WithdrawnApplicationResult> {
  try {
    const result = await teamsRepository.withdrawTeamApplication(
      actorParticipantId,
      applicationId
    );
    const app = result.application;
    return {
      application: {
        id: app.id,
        teamId: app.team_id,
        eventId: app.event_id,
        vacancyId: app.vacancy_id,
        applicantParticipantId: app.participant_id,
        status: app.status,
        statusLabel: applicationStatusLabel(app.status),
        requestType: 'Application',
        message: app.message ?? null,
        resolvedAt: app.resolved_at,
        cancelReason: app.cancel_reason,
        teamName: result.teamName,
        vacancyRole: result.vacancyRole,
      },
      changed: result.changed,
      idempotent: result.idempotent,
      alerts: result.alerts,
      notice: result.notice,
    };
  } catch (err: unknown) {
    const mapped = toTeamServiceError(err);
    if (mapped) throw mapped;
    throw err;
  }
}

/** Re-export for tests that assert catalog mapping. */
export { TeamServiceError };

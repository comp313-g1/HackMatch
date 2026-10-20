/**
 * US-018 / #174 / FR-054 — application pending quotas:
 * at most 3 Pending Review applications per PART per event.
 * Duplicate pending per team is checked before the per-event quota so callers
 * receive the most specific error. The unique index + RPC remain the atomic
 * concurrency backstop (FR-053).
 *
 * Express preflight throws TeamServiceError; submit_team_application re-enforces
 * the same COUNT atomically under concurrency.
 */

import { MAX_PENDING_APPLICATIONS_PER_EVENT } from '../db/applicationModel.js';
import type { ITeamsRepository } from '../db/teams.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { TeamServiceError } from './teamErrors.js';

export type ApplicationQuotaFailure =
  | 'DUPLICATE_PENDING_APPLICATION'
  | 'APPLICATION_PENDING_LIMIT';

export interface ApplicationQuotaDecision {
  ok: boolean;
  code: ApplicationQuotaFailure | null;
  pendingCount: number;
  limit: number;
}

/** True while pendingCount is strictly below the FR-054 limit (3). */
export function evaluatePendingApplicationsPerEventQuota(
  pendingCount: number,
  limit: number = MAX_PENDING_APPLICATIONS_PER_EVENT
): ApplicationQuotaDecision {
  if (pendingCount >= limit) {
    return {
      ok: false,
      code: 'APPLICATION_PENDING_LIMIT',
      pendingCount,
      limit,
    };
  }
  return { ok: true, code: null, pendingCount, limit };
}

export interface ApplicationQuotaInput {
  actorParticipantId: string;
  /** Event that owns the target team (quota is per PART per event). */
  eventId: string;
}

export interface ApplicationQuotaDeps {
  teamsRepo: Pick<
    ITeamsRepository,
    | 'countPendingApplicationsForEvent'
    | 'findPendingApplicationForTeam'
    | 'findTeamById'
  >;
}

function resolveDeps(partial?: Partial<ApplicationQuotaDeps>): ApplicationQuotaDeps {
  return {
    teamsRepo: partial?.teamsRepo ?? teamsRepository,
  };
}

/**
 * Express-layer quota preflight before submit_team_application (US-018 / #174).
 * Resolves eventId from teamId when only teamId is known.
 */
export async function assertApplicationQuotas(
  input: { actorParticipantId: string; teamId: string },
  partialDeps?: Partial<ApplicationQuotaDeps>
): Promise<void> {
  const deps = resolveDeps(partialDeps);
  const team = await deps.teamsRepo.findTeamById(input.teamId);
  if (!team) {
    throw new TeamServiceError('TEAM_NOT_FOUND');
  }

  const duplicate = await deps.teamsRepo.findPendingApplicationForTeam(
    input.actorParticipantId,
    input.teamId
  );
  if (duplicate) {
    throw new TeamServiceError('DUPLICATE_PENDING_APPLICATION', {
      teamId: input.teamId,
      existingApplicationId: duplicate.id,
    });
  }

  const pendingCount = await deps.teamsRepo.countPendingApplicationsForEvent(
    input.actorParticipantId,
    team.event_id
  );

  const decision = evaluatePendingApplicationsPerEventQuota(pendingCount);
  if (!decision.ok && decision.code) {
    throw new TeamServiceError(decision.code, {
      limit: decision.limit,
      pendingCount: decision.pendingCount,
      eventId: team.event_id,
    });
  }
}

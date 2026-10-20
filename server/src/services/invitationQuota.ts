/**
 * US-017 / #164 / FR-050 — invitation pending quotas:
 * at most one Pending invitation per open vacancy slot,
 * and at most one Pending invitation per invitee per team.
 *
 * Express preflight throws TeamServiceError; Postgres unique indexes + RPC
 * re-enforce the same rules atomically under concurrency.
 */

import type { ITeamsRepository } from '../db/teams.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import type { TeamRequest } from '../db/types.js';
import { TeamServiceError } from './teamErrors.js';

export type InvitationQuotaFailure =
  | 'DUPLICATE_PENDING_INVITATION'
  | 'SLOT_PENDING_INVITATION_EXISTS';

export interface InvitationQuotaDecision {
  ok: boolean;
  code: InvitationQuotaFailure | null;
}

/** One Pending invitation per invitee on a given team. */
export function evaluateInviteeTeamQuota(
  existingForInvitee: TeamRequest | null | undefined
): InvitationQuotaDecision {
  if (existingForInvitee) {
    return { ok: false, code: 'DUPLICATE_PENDING_INVITATION' };
  }
  return { ok: true, code: null };
}

/** One Pending invitation per vacancy slot. */
export function evaluateSlotQuota(
  existingForSlot: TeamRequest | null | undefined
): InvitationQuotaDecision {
  if (existingForSlot) {
    return { ok: false, code: 'SLOT_PENDING_INVITATION_EXISTS' };
  }
  return { ok: true, code: null };
}

export interface InvitationQuotaInput {
  teamId: string;
  vacancyId: string;
  inviteeParticipantId: string;
}

export interface InvitationQuotaDeps {
  teamsRepo: Pick<ITeamsRepository, 'findPendingInvitationConflicts'>;
}

function resolveDeps(partial?: Partial<InvitationQuotaDeps>): InvitationQuotaDeps {
  return {
    teamsRepo: partial?.teamsRepo ?? teamsRepository,
  };
}

/**
 * Express-layer quota preflight before issue_team_invitation (US-017 / #164).
 */
export async function assertInvitationQuotas(
  input: InvitationQuotaInput,
  partialDeps?: Partial<InvitationQuotaDeps>
): Promise<void> {
  const deps = resolveDeps(partialDeps);
  const conflicts = await deps.teamsRepo.findPendingInvitationConflicts(
    input.teamId,
    input.vacancyId,
    input.inviteeParticipantId
  );

  const inviteeDecision = evaluateInviteeTeamQuota(conflicts.byInvitee);
  if (!inviteeDecision.ok && inviteeDecision.code) {
    throw new TeamServiceError(inviteeDecision.code, {
      existingInvitationId: conflicts.byInvitee?.id ?? null,
    });
  }

  const slotDecision = evaluateSlotQuota(conflicts.bySlot);
  if (!slotDecision.ok && slotDecision.code) {
    throw new TeamServiceError(slotDecision.code, {
      existingInvitationId: conflicts.bySlot?.id ?? null,
      vacancyId: input.vacancyId,
    });
  }
}

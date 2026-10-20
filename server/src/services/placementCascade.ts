/**
 * US-019 / #181 / FR-056 / FR-057 — competing-request cascade after placement.
 *
 * Pure decision helpers document which Pending rows are cleared when a join
 * succeeds; the Postgres function cancel_competing_requests_on_placement applies
 * the same rules atomically under FOR UPDATE.
 */

export const PLACEMENT_CANCEL_REASONS = {
  EVENT_MEMBERSHIP_CONFIRMED: 'EVENT_MEMBERSHIP_CONFIRMED',
  SLOT_FILLED: 'SLOT_FILLED',
  TEAM_FULL: 'TEAM_FULL',
} as const;

export type PlacementCancelReason =
  (typeof PLACEMENT_CANCEL_REASONS)[keyof typeof PLACEMENT_CANCEL_REASONS];

export interface CompetingRequestRow {
  id: string;
  participantId: string;
  eventId?: string;
  teamId: string;
  vacancyId: string | null;
  slotId?: string | null;
  requestType: 'Invitation' | 'Application';
  status: string;
}

export interface PlacementCascadePlan {
  /** Other invitations for the same PART/event → Canceled. */
  eventInvitationIds: string[];
  sameTeamInvitationIds?: string[];
  /** Other applications for the same PART/event → Withdrawn. */
  eventApplicationIds: string[];
  sameTeamApplicationIds?: string[];
  /** Other Pending rows on the filled vacancy → Canceled. */
  slotRequestIds: string[];
  /** When team is full: remaining Pending on the team → Canceled. */
  teamRequestIds: string[];
}

/**
 * Decide which Pending requests must be cleared after a winning placement (FR-056/057).
 * Options allow strictly team-scoped cancellation under event-free multi-team rules.
 */
export function planCompetingRequestCancellation(
  winning: CompetingRequestRow,
  pending: CompetingRequestRow[],
  teamNowFull: boolean,
  options?: { scopeToTeamOnly?: boolean }
): PlacementCascadePlan {
  const plan: PlacementCascadePlan = {
    eventInvitationIds: [],
    eventApplicationIds: [],
    slotRequestIds: [],
    teamRequestIds: [],
  };

  const winningSlotId = winning.vacancyId ?? winning.slotId ?? null;
  const scopeToTeamOnly = options?.scopeToTeamOnly ?? true;

  for (const row of pending) {
    if (row.id === winning.id) continue;
    if (row.status !== 'Pending') continue;

    const rowSlotId = row.vacancyId ?? row.slotId ?? null;

    // Same participant: in team-scoped mode, only cancel on the same team.
    // In legacy event-mode, cancel across same event if eventId matches.
    const isSameParticipant = row.participantId === winning.participantId;
    const isSameTeam = row.teamId === winning.teamId;
    const isSameEvent = Boolean(winning.eventId && row.eventId && row.eventId === winning.eventId);

    if (isSameParticipant && (scopeToTeamOnly ? isSameTeam : isSameTeam || isSameEvent)) {
      if (row.requestType === 'Invitation') {
        plan.eventInvitationIds.push(row.id);
      } else {
        plan.eventApplicationIds.push(row.id);
      }
    }

    // FR-057 — filled slot (any participant)
    if (
      winningSlotId &&
      rowSlotId === winningSlotId
    ) {
      plan.slotRequestIds.push(row.id);
    }

    // FR-057 — team full (any remaining Pending on team)
    if (teamNowFull && row.teamId === winning.teamId) {
      plan.teamRequestIds.push(row.id);
    }
  }

  // Deduplicate ids that match multiple rules (SQL updates are idempotent by status)
  plan.eventInvitationIds = [...new Set(plan.eventInvitationIds)];
  plan.eventApplicationIds = [...new Set(plan.eventApplicationIds)];
  plan.slotRequestIds = [...new Set(plan.slotRequestIds)];
  plan.teamRequestIds = [...new Set(plan.teamRequestIds)];
  plan.sameTeamInvitationIds = plan.eventInvitationIds;
  plan.sameTeamApplicationIds = plan.eventApplicationIds;

  return plan;
}

/** True when confirmed members after placement reach or exceed event max. */
export function isTeamFullAfterPlacement(
  confirmedCountAfterPlacement: number,
  maxTeamSize: number
): boolean {
  return confirmedCountAfterPlacement >= maxTeamSize;
}

export interface PlacementCascadeResult {
  winningRequestId: string;
  eventInvitationsCanceled: number;
  eventApplicationsWithdrawn: number;
  slotRequestsCanceled: number;
  teamRequestsCanceled: number;
  teamNowFull: boolean;
}

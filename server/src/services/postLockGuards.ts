/**
 * US-022 / #210 / FR-067 — post-lock mutation freeze contract.
 *
 * PostgreSQL enforces rejection via leave_team (recruitment_status <> 'Open') and
 * lock_team_for_owner_mutation (same Open check) for owner roster/vacancy/disband
 * writes. Express maps TEAM_NOT_MUTABLE + reason Locked to a roster-lock message;
 * React disables leave / remove / slot / disband controls when lifecycle is Locked.
 */

export const POST_LOCK_FROZEN_MUTATIONS = [
  'leave',
  'removeMember',
  'addVacancy',
  'updateVacancy',
  'removeVacancy',
  'disband',
] as const;

export type PostLockFrozenMutation = (typeof POST_LOCK_FROZEN_MUTATIONS)[number];

/** Catalog default for non-Locked TEAM_NOT_MUTABLE reasons (Disbanded / EventNotRecruiting). */
export const TEAM_NOT_MUTABLE_DEFAULT_MESSAGE =
  'Team recruitment is not open or event is concluded.';

/** Owner/member-facing copy when details.reason is Locked (#210). */
export const POST_LOCK_REJECT_MESSAGE =
  'This roster is locked. Leaving, member removals, slot edits, and disbanding are not allowed.';

export function isPostLockFrozenMutation(kind: string): kind is PostLockFrozenMutation {
  return (POST_LOCK_FROZEN_MUTATIONS as readonly string[]).includes(kind);
}

/**
 * Public error text for TEAM_NOT_MUTABLE. Locked gets an explicit freeze message;
 * other lifecycle reasons keep the shared catalog wording.
 */
export function teamNotMutablePublicMessage(
  details?: Record<string, unknown> | null
): string {
  if (details && details.reason === 'Locked') {
    return POST_LOCK_REJECT_MESSAGE;
  }
  return TEAM_NOT_MUTABLE_DEFAULT_MESSAGE;
}

/**
 * Pure evidence helper: after lock, frozen mutations must not change membership /
 * vacancy / recruitment snapshots (happy / boundary / failure contract).
 */
export function summarizePostLockGuardOutcome(input: {
  recruitmentStatus: string;
  leaveRejected: boolean;
  removeRejected: boolean;
  slotEditRejected: boolean;
  disbandRejected: boolean;
  membershipCountBefore: number;
  membershipCountAfter: number;
  vacancyCountBefore: number;
  vacancyCountAfter: number;
}): {
  frozen: boolean;
  allMutationsRejected: boolean;
  rosterUntouched: boolean;
  vacanciesUntouched: boolean;
} {
  const frozen = input.recruitmentStatus === 'Locked';
  return {
    frozen,
    allMutationsRejected:
      input.leaveRejected &&
      input.removeRejected &&
      input.slotEditRejected &&
      input.disbandRejected,
    rosterUntouched: input.membershipCountBefore === input.membershipCountAfter,
    vacanciesUntouched: input.vacancyCountBefore === input.vacancyCountAfter,
  };
}

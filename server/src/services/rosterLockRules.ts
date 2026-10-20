/**
 * US-022 / #212 / FR-066 — lock minimum, maximum, and concurrency rule helpers.
 *
 * Atomic enforcement lives in lock_team (0036). These pure helpers document the
 * accepted outcome shapes for Vitest + integration evidence:
 * - BELOW_MIN_MEMBERS / ABOVE_MAX_MEMBERS boundaries
 * - lock vs leave/join serialization via shared team advisory lock
 */

import {
  DEFAULT_LOCK_MAX_MEMBERS,
  DEFAULT_LOCK_MIN_MEMBERS,
  resolveLockMemberBounds,
} from './rosterLockValidation.js';

export { DEFAULT_LOCK_MAX_MEMBERS, DEFAULT_LOCK_MIN_MEMBERS, resolveLockMemberBounds };

export type LockMemberBoundDecision =
  | { ok: true; memberCount: number; minRequired: number; maxAllowed: number }
  | {
      ok: false;
      code: 'BELOW_MIN_MEMBERS' | 'ABOVE_MAX_MEMBERS';
      memberCount: number;
      minRequired: number;
      maxAllowed: number;
    };

/** Apply official event bounds (platform floor 2) to a confirmed member count. */
export function evaluateLockMemberCount(
  memberCount: number,
  event: { min_team_size: number | null; max_team_size: number | null }
): LockMemberBoundDecision {
  const { minRequired, maxAllowed } = resolveLockMemberBounds(event);
  if (memberCount < minRequired) {
    return { ok: false, code: 'BELOW_MIN_MEMBERS', memberCount, minRequired, maxAllowed };
  }
  if (memberCount > maxAllowed) {
    return { ok: false, code: 'ABOVE_MAX_MEMBERS', memberCount, minRequired, maxAllowed };
  }
  return { ok: true, memberCount, minRequired, maxAllowed };
}

export type LockLeaveRaceWinner = 'lock' | 'leave' | 'neither';

/**
 * Models the two serial outcomes when lock_team and leave_team share
 * hackmatch:accept:team:{id}. Exactly one writers' world commits; the loser
 * sees the post-winner state (no partial Locked+underfilled roster).
 */
export function summarizeLockLeaveConcurrency(input: {
  membersBefore: number;
  lockSucceeded: boolean;
  leaveSucceeded: boolean;
  recruitmentStatusAfter: 'Open' | 'Locked' | 'Disbanded';
  membersAfter: number;
  lockErrorCode?: string | null;
  leaveErrorCode?: string | null;
}): {
  winner: LockLeaveRaceWinner;
  consistent: boolean;
  partialForbidden: boolean;
} {
  const bothSucceeded = input.lockSucceeded && input.leaveSucceeded;
  let winner: LockLeaveRaceWinner = 'neither';
  if (input.lockSucceeded && !input.leaveSucceeded) winner = 'lock';
  else if (input.leaveSucceeded && !input.lockSucceeded) winner = 'leave';

  // Locked roster must never drop below the count that was validated at lock time
  // without also failing leave (leave after lock must reject).
  const lockedUnderfilled =
    input.recruitmentStatusAfter === 'Locked' &&
    input.membersAfter < 2 &&
    input.lockSucceeded;

  const leaveAfterLockAccepted =
    input.recruitmentStatusAfter === 'Locked' && input.leaveSucceeded;

  const consistent =
    !bothSucceeded &&
    !lockedUnderfilled &&
    !leaveAfterLockAccepted &&
    (winner !== 'lock' ||
      (input.recruitmentStatusAfter === 'Locked' &&
        input.membersAfter === input.membersBefore &&
        (input.leaveErrorCode === 'TEAM_NOT_MUTABLE' ||
          input.leaveErrorCode === 'MEMBER_NOT_FOUND' ||
          input.leaveErrorCode == null))) &&
    (winner !== 'leave' ||
      (input.recruitmentStatusAfter === 'Open' &&
        input.membersAfter === input.membersBefore - 1 &&
        (input.lockErrorCode === 'BELOW_MIN_MEMBERS' ||
          input.lockErrorCode === 'TEAM_NOT_MUTABLE' ||
          input.lockErrorCode == null)));

  return {
    winner,
    consistent,
    partialForbidden: lockedUnderfilled || leaveAfterLockAccepted || bothSucceeded,
  };
}

/** Shared advisory key fragment used by lock_team, leave_team, accept, approve. */
export const TEAM_ADVISORY_LOCK_PREFIX = 'hackmatch:accept:team:';

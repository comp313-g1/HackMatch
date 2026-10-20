/**
 * US-022 / #207 / FR-066 — owner-only, non-mutating roster lock validation.
 *
 * Returns canLock + structured reasons without writing Locked / locked_at.
 * The atomic lock RPC (later US-022 task) must re-check these rules before commit.
 */

import type { ITeamsRepository } from '../db/teams.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import type { Team, TeamMembershipRole, TeamRecruitmentStatus } from '../db/types.js';
import { deriveTeamLifecycle } from './teamLifecycle.js';
import { TeamServiceError } from './teamErrors.js';

/** Platform floor for locking when an event omits min_team_size (US-022). */
export const DEFAULT_LOCK_MIN_MEMBERS = 2;
/** Platform ceiling when an event omits max_team_size. */
export const DEFAULT_LOCK_MAX_MEMBERS = 4;

export type RosterLockValidationReasonCode =
  | 'BELOW_MIN_MEMBERS'
  | 'ABOVE_MAX_MEMBERS'
  | 'TEAM_NOT_MUTABLE'
  | 'ALREADY_LOCKED'
  | 'EVENT_NOT_RECRUITING'
  | 'MEMBER_CONFIRMED_ELSEWHERE'
  | 'FORBIDDEN_NOT_TEAM_OWNER';

export interface RosterLockValidationReason {
  code: RosterLockValidationReasonCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface RosterLockValidationMember {
  participantId: string;
  displayName: string;
  role: TeamMembershipRole;
}

export interface RosterLockValidationResult {
  canLock: boolean;
  reasons: RosterLockValidationReason[];
  memberCount: number;
  minRequired: number;
  maxAllowed: number;
  recruitmentStatus: TeamRecruitmentStatus;
  lockedAt: string | null;
  openSlots: number;
  members: RosterLockValidationMember[];
}

export function resolveLockMemberBounds(event: {
  min_team_size?: number | null;
  max_team_size?: number | null;
}): { minRequired: number; maxAllowed: number } {
  const rawMin =
    typeof event.min_team_size === 'number' && Number.isFinite(event.min_team_size)
      ? event.min_team_size
      : DEFAULT_LOCK_MIN_MEMBERS;
  const rawMax =
    typeof event.max_team_size === 'number' && Number.isFinite(event.max_team_size)
      ? event.max_team_size
      : DEFAULT_LOCK_MAX_MEMBERS;

  // Locking always requires at least 2 confirmed members (US-022 / story default).
  const minRequired = Math.max(DEFAULT_LOCK_MIN_MEMBERS, Math.trunc(rawMin));
  const maxAllowed = Math.max(minRequired, Math.trunc(rawMax));
  return { minRequired, maxAllowed };
}

/**
 * Pure eligibility evaluation (unit-tested). Does not throw for size/status issues —
 * those become reasons with canLock=false so the UI can show a validation state.
 */
export function evaluateRosterLockEligibility(input: {
  actorParticipantId: string;
  team: Pick<Team, 'id' | 'owner_participant_id' | 'recruitment_status' | 'locked_at'>;
  event: {
    min_team_size?: number | null;
    max_team_size?: number | null;
    status: 'Published' | 'Archived' | 'Disabled';
    end_date: string;
  };
  members: Array<{
    participant_id: string;
    role: TeamMembershipRole;
    handle: string | null;
    full_name: string;
  }>;
  openSlots: number;
  /** Participant ids confirmed on this team whose event membership is elsewhere. */
  membersConfirmedElsewhere?: string[];
  now?: Date;
}): RosterLockValidationResult {
  const { minRequired, maxAllowed } = resolveLockMemberBounds(input.event);
  const memberCount = input.members.length;
  const reasons: RosterLockValidationReason[] = [];

  if (input.team.owner_participant_id !== input.actorParticipantId) {
    reasons.push({
      code: 'FORBIDDEN_NOT_TEAM_OWNER',
      message: 'Only the team owner can validate or lock this roster.',
    });
  }

  if (input.team.recruitment_status === 'Locked') {
    reasons.push({
      code: 'ALREADY_LOCKED',
      message: 'This roster is already locked.',
      details: { lockedAt: input.team.locked_at },
    });
  } else if (input.team.recruitment_status !== 'Open') {
    reasons.push({
      code: 'TEAM_NOT_MUTABLE',
      message: 'Team recruitment is not open, so the roster cannot be locked.',
      details: { recruitmentStatus: input.team.recruitment_status },
    });
  } else {
    const lifecycle = deriveTeamLifecycle(
      { recruitment_status: input.team.recruitment_status },
      { status: input.event.status, end_date: input.event.end_date },
      input.now ?? new Date()
    );
    if (!lifecycle.mutable && lifecycle.reason === 'EventNotRecruiting') {
      reasons.push({
        code: 'EVENT_NOT_RECRUITING',
        message: 'The event is not actively recruiting, so the roster cannot be locked.',
      });
    }
  }

  if (memberCount < minRequired) {
    reasons.push({
      code: 'BELOW_MIN_MEMBERS',
      message: `Locking requires at least ${minRequired} confirmed members (currently ${memberCount}).`,
      details: { memberCount, minRequired, maxAllowed },
    });
  }

  if (memberCount > maxAllowed) {
    reasons.push({
      code: 'ABOVE_MAX_MEMBERS',
      message: `Locking allows at most ${maxAllowed} confirmed members (currently ${memberCount}).`,
      details: { memberCount, minRequired, maxAllowed },
    });
  }

  const elsewhere = input.membersConfirmedElsewhere ?? [];
  if (elsewhere.length > 0) {
    reasons.push({
      code: 'MEMBER_CONFIRMED_ELSEWHERE',
      message:
        'One or more confirmed members already have a confirmed membership on another team for this event.',
      details: { participantIds: elsewhere },
    });
  }

  const members: RosterLockValidationMember[] = input.members.map((m) => {
    const handle = m.handle?.trim();
    const displayName = handle && handle.length > 0 ? handle : m.full_name;
    return {
      participantId: m.participant_id,
      displayName,
      role: m.role,
    };
  });

  return {
    canLock: reasons.length === 0,
    reasons,
    memberCount,
    minRequired,
    maxAllowed,
    recruitmentStatus: input.team.recruitment_status,
    lockedAt: input.team.locked_at ?? null,
    openSlots: input.openSlots,
    members,
  };
}

export interface RosterLockValidationDeps {
  repo: Pick<
    ITeamsRepository,
    'getTeamViewParts' | 'findConfirmedTeamIdForParticipant'
  >;
}

/**
 * Owner-facing lock preflight. Throws only for missing team; ownership is also
 * enforced by requireTeamOwner middleware. Soft failures are canLock=false reasons.
 */
export async function validateRosterLockForOwner(
  actorParticipantId: string,
  teamId: string,
  deps: RosterLockValidationDeps = { repo: teamsRepository },
  now: Date = new Date()
): Promise<RosterLockValidationResult> {
  let parts: Awaited<ReturnType<ITeamsRepository['getTeamViewParts']>>;
  try {
    parts = await deps.repo.getTeamViewParts(teamId);
  } catch {
    throw new TeamServiceError('TEAM_NOT_FOUND');
  }

  if (!parts?.team) {
    throw new TeamServiceError('TEAM_NOT_FOUND');
  }

  // Soft ownership failure for service-level callers (middleware already hard-gates HTTP).
  if (parts.team.owner_participant_id !== actorParticipantId) {
    return evaluateRosterLockEligibility({
      actorParticipantId,
      team: parts.team,
      event: {
        min_team_size: parts.event.min_team_size ?? null,
        max_team_size: parts.event.max_team_size ?? null,
        status: parts.event.status ?? 'Published',
        end_date: parts.event.end_date ?? '2099-01-01T00:00:00.000Z',
      },
      members: parts.members,
      openSlots: parts.vacancies.filter((v) => v.status === 'Open').length,
      now,
    });
  }

  const membersConfirmedElsewhere: string[] = [];
  for (const member of parts.members) {
    const confirmedTeamId = await deps.repo.findConfirmedTeamIdForParticipant(
      member.participant_id,
      parts.team.event_id
    );
    if (confirmedTeamId && confirmedTeamId !== parts.team.id) {
      membersConfirmedElsewhere.push(member.participant_id);
    }
  }

  return evaluateRosterLockEligibility({
    actorParticipantId,
    team: parts.team,
    event: {
      min_team_size: parts.event.min_team_size ?? null,
      max_team_size: parts.event.max_team_size ?? null,
      status: parts.event.status ?? 'Published',
      end_date: parts.event.end_date ?? '2099-01-01T00:00:00.000Z',
    },
    members: parts.members,
    openSlots: parts.vacancies.filter((v) => v.status === 'Open').length,
    membersConfirmedElsewhere,
    now,
  });
}

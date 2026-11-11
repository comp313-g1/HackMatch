/**
 * US-016 / #153 — reverse matching inputs and team eligibility rules.
 *
 * "Reverse" matching is the mirror of US-015: instead of ranking candidates for an owner's open
 * slot, it finds open team vacancies that suit ONE participant. This module only DEFINES what goes
 * in and which teams may be recommended. It does no scoring (match percentage and matched skills
 * are a later task) and makes no database calls, so every rule is testable and deterministic.
 *
 * A recommendation is a pair (team, open vacancy). It is offered only when BOTH hold:
 *
 *  1. The participant may receive recommendations (`buildReverseMatchInputs`):
 *       - an active, verified PART account (not suspended or deactivated);
 *       - a profile that is not hidden by moderation;
 *       - Looking for Team is on (proactive suggestions only for people who asked to be found);
 *       - at least one skill, because matching compares the participant's skills to the vacancy's.
 *  2. The team and vacancy are suitable for that participant (`evaluateTeamVacancyEligibility`):
 *       - the participant is not the owner and not a confirmed member of the team;
 *       - the team is not hidden by moderation;
 *       - the team is still recruiting (Open: not Locked, not Disbanded);
 *       - the vacancy belongs to the team, is Open and has not been removed;
 *       - the participant has no pending invitation or application for that team already.
 *
 * Deliberately NOT exclusions: the participant's own pending-application count (the 3-application
 * limit in FR-054 is enforced when applying, and a recommendation can still be shown), and role or
 * goal differences (those only affect how a team is ranked, not whether it may appear).
 * Recommendations are platform-wide: no event is involved.
 */

import type {
  Participant,
  ParticipantPrimaryRole,
  ParticipantProfile,
  Team,
  TeamGoal,
  TeamVacancy,
} from '../db/types.js';
import type { PlatformAvailabilityRecord } from '../repositories/availability.repository.js';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** What the matcher knows about the participant. Built only by `buildReverseMatchInputs`. */
export interface ReverseMatchInputs {
  participantId: string;
  /** Primary role from the profile, if set. */
  primaryRole: ParticipantPrimaryRole | null;
  /** Role the participant is looking for, from their Looking-for-Team preferences. */
  desiredRole: ParticipantPrimaryRole | null;
  goal: TeamGoal | null;
  /** Weekly hours the participant can commit, or null when not stated. */
  commitmentHours: number | null;
  /** Skills as the participant wrote them: trimmed, no duplicates (case-insensitive), at least one. */
  skills: string[];
  /** The same skills in comparison form (see `skillKey`), in the same order. */
  skillKeys: string[];
}

/** Raw material for `buildReverseMatchInputs`; every part may be missing. */
export interface ReverseMatchSource {
  participant: Participant | null | undefined;
  profile: Pick<ParticipantProfile, 'primary_role' | 'moderation_status'> | null | undefined;
  skills: readonly string[] | null | undefined;
  availability:
    | Pick<PlatformAvailabilityRecord, 'isLooking' | 'desiredRole' | 'commitmentHours' | 'goal'>
    | null
    | undefined;
}

export type ParticipantExclusionReason =
  | 'participant_missing'
  | 'participant_not_part'
  | 'participant_unverified'
  | 'participant_suspended'
  | 'participant_deactivated'
  | 'participant_profile_hidden'
  | 'participant_not_looking'
  | 'participant_no_skills';

export type ReverseMatchInputsResult =
  | { ok: true; inputs: ReverseMatchInputs }
  | { ok: false; reason: ParticipantExclusionReason };

/** Weekly commitment limit used everywhere else in the product (0 to 168 hours). */
const MAX_COMMITMENT_HOURS = 168;

/** The form a skill takes when two skills are compared: trimmed, single spaces, lower case. */
export function skillKey(skill: string): string {
  return skill.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Cleans a skill list: drops blanks and non-text values, trims, and removes duplicates that differ
 * only by case or spacing (the first spelling wins). Order is preserved.
 */
export function normalizeSkillTags(skills: readonly unknown[] | null | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of skills ?? []) {
    if (typeof raw !== 'string') continue;
    const display = raw.trim().replace(/\s+/g, ' ');
    const key = skillKey(display);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(display);
  }
  return result;
}

function validHours(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value >= 0 && value <= MAX_COMMITMENT_HOURS ? value : null;
}

/**
 * Checks that a participant may receive team recommendations and, if so, returns the matching
 * inputs. The first failing rule is reported, in a fixed order, so the answer is deterministic.
 */
export function buildReverseMatchInputs(source: ReverseMatchSource): ReverseMatchInputsResult {
  const { participant, profile, availability } = source;

  if (!participant) return { ok: false, reason: 'participant_missing' };
  if (participant.role !== 'PART') return { ok: false, reason: 'participant_not_part' };
  if (!participant.is_verified) return { ok: false, reason: 'participant_unverified' };
  if (participant.is_deactivated) return { ok: false, reason: 'participant_deactivated' };
  if (participant.is_suspended) return { ok: false, reason: 'participant_suspended' };
  if (profile?.moderation_status === 'Hidden') return { ok: false, reason: 'participant_profile_hidden' };
  if (!availability?.isLooking) return { ok: false, reason: 'participant_not_looking' };

  const skills = normalizeSkillTags(source.skills);
  if (skills.length === 0) return { ok: false, reason: 'participant_no_skills' };

  return {
    ok: true,
    inputs: {
      participantId: participant.id.toLowerCase(),
      primaryRole: profile?.primary_role ?? null,
      desiredRole: availability.desiredRole ?? null,
      goal: availability.goal ?? null,
      commitmentHours: validHours(availability.commitmentHours),
      skills,
      skillKeys: skills.map(skillKey),
    },
  };
}

// ---------------------------------------------------------------------------
// Team and vacancy eligibility
// ---------------------------------------------------------------------------

export type TeamExclusionReason =
  | 'already_team_member'
  | 'team_hidden'
  | 'team_not_recruiting'
  | 'vacancy_team_mismatch'
  | 'vacancy_not_open'
  | 'pending_request_exists';

export interface TeamVacancyDecision {
  eligible: boolean;
  reason: TeamExclusionReason | null;
}

/** One open slot and the facts about its team that the rules need. */
export interface TeamVacancyCandidate {
  team: Pick<
    Team,
    'id' | 'owner_participant_id' | 'recruitment_status' | 'locked_at' | 'disbanded_at' | 'moderation_hidden_at' | 'moderation_status'
  >;
  vacancy: Pick<TeamVacancy, 'id' | 'team_id' | 'status' | 'removed_at'>;
  /** Participants with a Confirmed membership of the team (the owner may or may not be listed). */
  confirmedMemberIds: ReadonlySet<string>;
}

/** What else is known about the participant's dealings with teams. */
export interface ReverseMatchContext {
  /** Teams (ids) where the participant already has a Pending invitation or application. */
  pendingRequestTeamIds: ReadonlySet<string>;
}

function sameId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Whether one open vacancy may be recommended to this participant. Checks run in a fixed order,
 * and the first failure is the reason: member, hidden, not recruiting, vacancy, pending request.
 */
export function evaluateTeamVacancyEligibility(
  candidate: TeamVacancyCandidate,
  inputs: Pick<ReverseMatchInputs, 'participantId'>,
  context: ReverseMatchContext
): TeamVacancyDecision {
  const { team, vacancy } = candidate;
  const me = inputs.participantId;

  const isMember =
    sameId(team.owner_participant_id, me) ||
    [...candidate.confirmedMemberIds].some((memberId) => sameId(memberId, me));
  if (isMember) return { eligible: false, reason: 'already_team_member' };

  if (team.moderation_hidden_at || team.moderation_status === 'Hidden') {
    return { eligible: false, reason: 'team_hidden' };
  }

  if (team.recruitment_status !== 'Open' || team.locked_at || team.disbanded_at) {
    return { eligible: false, reason: 'team_not_recruiting' };
  }

  if (!sameId(vacancy.team_id, team.id)) return { eligible: false, reason: 'vacancy_team_mismatch' };
  if (vacancy.status !== 'Open' || vacancy.removed_at) return { eligible: false, reason: 'vacancy_not_open' };

  if ([...context.pendingRequestTeamIds].some((teamId) => sameId(teamId, team.id))) {
    return { eligible: false, reason: 'pending_request_exists' };
  }

  return { eligible: true, reason: null };
}

export interface TeamExclusionSummary {
  considered: number;
  eligible: number;
  alreadyMember: number;
  hidden: number;
  notRecruiting: number;
  vacancyUnavailable: number;
  pendingRequest: number;
  totalExcluded: number;
}

export interface PartitionedTeamVacancies<
  TCandidate extends TeamVacancyCandidate = TeamVacancyCandidate,
> {
  eligible: TCandidate[];
  excluded: Array<{ teamId: string; vacancyId: string; reason: TeamExclusionReason }>;
  summary: TeamExclusionSummary;
}

/** Message for the "no recommendations" state, which explains what is left out. */
export const NO_TEAM_RECOMMENDATIONS_HINT =
  'Teams you already belong to, teams that are full, locked, hidden or closed, and teams you already applied to or were invited by are not suggested.';

/**
 * Splits a pool of open slots into the ones that may be recommended and the ones that may not,
 * with a count per reason. It only filters the pool it is given and never invents teams.
 */
export function partitionTeamVacancies<TCandidate extends TeamVacancyCandidate>(
  candidates: readonly TCandidate[],
  inputs: Pick<ReverseMatchInputs, 'participantId'>,
  context: ReverseMatchContext
): PartitionedTeamVacancies<TCandidate> {
  const eligible: TCandidate[] = [];
  const excluded: PartitionedTeamVacancies['excluded'] = [];
  const summary: TeamExclusionSummary = {
    considered: candidates.length,
    eligible: 0,
    alreadyMember: 0,
    hidden: 0,
    notRecruiting: 0,
    vacancyUnavailable: 0,
    pendingRequest: 0,
    totalExcluded: 0,
  };

  for (const candidate of candidates) {
    const decision = evaluateTeamVacancyEligibility(candidate, inputs, context);
    if (decision.eligible) {
      eligible.push(candidate);
      summary.eligible += 1;
      continue;
    }
    const reason = decision.reason!;
    excluded.push({ teamId: candidate.team.id, vacancyId: candidate.vacancy.id, reason });
    summary.totalExcluded += 1;
    switch (reason) {
      case 'already_team_member':
        summary.alreadyMember += 1;
        break;
      case 'team_hidden':
        summary.hidden += 1;
        break;
      case 'team_not_recruiting':
        summary.notRecruiting += 1;
        break;
      case 'vacancy_team_mismatch':
      case 'vacancy_not_open':
        summary.vacancyUnavailable += 1;
        break;
      case 'pending_request_exists':
        summary.pendingRequest += 1;
        break;
    }
  }

  return { eligible, excluded, summary };
}

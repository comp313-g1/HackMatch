/**
 * Deterministic candidate compatibility scoring (US-015 / FR-043–045 / R-04).
 *
 * score = 100 * (S + G + H) / 3  with each component in [0, 1].
 * Display one decimal; rank by unrounded score, then display handle, then internal id.
 * Missing component inputs are never invented — they score 0.
 *
 * This module is the scoring policy only (S1-P task: define rules + missing-input handling).
 * Recommendation fetch/authorization is a separate US-015 task.
 */

import type { ParticipantPrimaryRole, TeamGoal } from '../db/types.js';
import { ALLOWED_PRIMARY_ROLES } from '../validators/profile.validator.js';
import { TEAM_GOALS, TEAM_MAX_COMMITMENT_HOURS } from '../validators/team.validator.js';

export const ROLE_MATCH_MULTIPLIER = 1.2;
export const SCORE_COMPONENT_WEIGHT = 1 / 3;

/** FR-043: composite scores are bounded to this closed interval. */
export const COMPATIBILITY_SCORE_MIN = 0;
export const COMPATIBILITY_SCORE_MAX = 100;

/** Goals that are adjacent (G = 0.5) under FR-045. */
const GOAL_ADJACENCY: ReadonlyArray<readonly [TeamGoal, TeamGoal]> = [
  ['Learning', 'Project Completion'],
  ['Project Completion', 'Competitive'],
];

export interface SlotScoringInput {
  /** Vacancy slot role (compared to candidate primary/desired role). */
  role: string | null | undefined;
  /** Required skill tags for the slot. Empty list → S = 1 before role multiplier (FR-044). */
  requiredSkills: readonly string[] | null | undefined;
  /** Team commitment hours requested for the listing/slot context. */
  requestedHours: number | null | undefined;
  /** Team goal for goal-alignment component G. */
  goal: string | null | undefined;
}

export interface CandidateScoringInput {
  /** Declared primary or desired role. */
  primaryRole: string | null | undefined;
  /** Candidate skill tags. */
  skills: readonly string[] | null | undefined;
  /** Candidate commitment hours. */
  commitmentHours: number | null | undefined;
  /** Candidate availability goal. */
  goal: string | null | undefined;
  /** Display handle for tie-breaking (FR-043). Not shown as an internal id. */
  displayHandle?: string | null;
  /** Internal identifier for final tie-break only (never displayed). */
  internalId?: string | null;
}

export interface CompatibilityComponents {
  /** Skill coverage S ∈ [0, 1] (FR-044). */
  skill: number;
  /** Goal alignment G ∈ [0, 1] (FR-045). */
  goal: number;
  /** Hours commitment H ∈ [0, 1] (FR-045). */
  hours: number;
}

export interface CompatibilityScoreResult {
  /** Unrounded score in [0, 100] used for ranking (FR-043). */
  score: number;
  /** One-decimal display string (e.g. "70.0"). */
  displayScore: string;
  components: CompatibilityComponents;
  /** Matched required tags (normalized) contributing to S. */
  matchedSkills: string[];
  /** Whether primary role matched the slot (1.2× applied before cap). */
  roleMatched: boolean;
  /** True when any component used the missing-input → 0 rule. */
  hadMissingInput: boolean;
  /** Human-readable contribution notes (no internal ids). */
  contributions: {
    skill: string;
    goal: string;
    hours: string;
  };
}

export interface CompatibilityScoreFieldErrors {
  role?: string;
  requiredSkills?: string;
  requestedHours?: string;
  goal?: string;
  primaryRole?: string;
  skills?: string;
  commitmentHours?: string;
  candidateGoal?: string;
  body?: string;
}

export interface RankableCompatibilityResult extends CompatibilityScoreResult {
  displayHandle: string;
  internalId: string;
}

/** Ranked row with 1-based position after FR-043 tie-breaking (internalId never for display). */
export interface RankedCompatibilityResult extends RankableCompatibilityResult {
  rank: number;
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function normalizeRole(raw: string | null | undefined): ParticipantPrimaryRole | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  for (const role of ALLOWED_PRIMARY_ROLES) {
    if (role.toLowerCase() === trimmed) return role;
  }
  return null;
}

function normalizeGoal(raw: string | null | undefined): TeamGoal | null {
  if (typeof raw !== 'string') return null;
  const collapsed = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!collapsed) return null;
  for (const goal of TEAM_GOALS) {
    if (goal.toLowerCase() === collapsed) return goal;
  }
  return null;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * FR-044: required-skill coverage with optional 1.2× role multiplier, capped at 1.
 * Empty required tags → S = 1 before the cap. Missing candidate skills when tags are
 * required → matched count 0 (not invented).
 */
export function computeSkillCoverage(
  requiredSkills: readonly string[] | null | undefined,
  candidateSkills: readonly string[] | null | undefined,
  slotRole: string | null | undefined,
  candidateRole: string | null | undefined
): { s: number; matchedSkills: string[]; roleMatched: boolean; missingSkillsInput: boolean } {
  const required = (requiredSkills ?? [])
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map(normalizeTag);
  const uniqueRequired = [...new Set(required)];

  const candidateSet = new Set(
    (candidateSkills ?? [])
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .map(normalizeTag)
  );

  const missingSkillsInput = uniqueRequired.length > 0 && candidateSkills == null;

  let coverage: number;
  const matchedSkills: string[] = [];

  if (uniqueRequired.length === 0) {
    // Empty required tags give S=1 before the role multiplier / cap (FR-044).
    coverage = 1;
  } else if (missingSkillsInput) {
    coverage = 0;
  } else {
    for (const tag of uniqueRequired) {
      if (candidateSet.has(tag)) matchedSkills.push(tag);
    }
    coverage = matchedSkills.length / uniqueRequired.length;
  }

  const normalizedSlotRole = normalizeRole(slotRole);
  const normalizedCandidateRole = normalizeRole(candidateRole);
  const roleMatched =
    normalizedSlotRole !== null &&
    normalizedCandidateRole !== null &&
    normalizedSlotRole === normalizedCandidateRole;

  let s = coverage;
  if (roleMatched) {
    s = s * ROLE_MATCH_MULTIPLIER;
  }
  s = Math.min(1, s);

  return { s, matchedSkills, roleMatched, missingSkillsInput };
}

/**
 * FR-045: goal adjacency.
 * Identical → 1; Learning↔Project Completion or Project Completion↔Competitive → 0.5;
 * Learning↔Competitive → 0; either side missing → 0.
 */
export function computeGoalAlignment(
  slotGoal: string | null | undefined,
  candidateGoal: string | null | undefined
): { g: number; missing: boolean } {
  const teamGoal = normalizeGoal(slotGoal);
  const partGoal = normalizeGoal(candidateGoal);

  if (teamGoal === null || partGoal === null) {
    return { g: 0, missing: true };
  }
  if (teamGoal === partGoal) {
    return { g: 1, missing: false };
  }

  for (const [a, b] of GOAL_ADJACENCY) {
    if ((teamGoal === a && partGoal === b) || (teamGoal === b && partGoal === a)) {
      return { g: 0.5, missing: false };
    }
  }

  return { g: 0, missing: false };
}

/**
 * FR-045: H = min(candidateHours / requestedHours, 1).
 * requestedHours === 0 → H = 1. Missing either side (when requested > 0 needs candidate) → 0.
 */
export function computeHoursAlignment(
  requestedHours: number | null | undefined,
  candidateHours: number | null | undefined
): { h: number; missing: boolean } {
  if (requestedHours === null || requestedHours === undefined) {
    return { h: 0, missing: true };
  }
  if (!Number.isFinite(requestedHours) || requestedHours < 0) {
    return { h: 0, missing: true };
  }
  if (requestedHours === 0) {
    return { h: 1, missing: false };
  }
  if (candidateHours === null || candidateHours === undefined) {
    return { h: 0, missing: true };
  }
  if (!Number.isFinite(candidateHours) || candidateHours < 0) {
    return { h: 0, missing: true };
  }
  return { h: Math.min(candidateHours / requestedHours, 1), missing: false };
}

/**
 * FR-043: clamp a composite score into [0, 100].
 * Non-finite values (NaN / ±Infinity) become 0 so rankings never receive invalid numbers.
 */
export function boundCompatibilityScore(score: number): number {
  if (!Number.isFinite(score)) {
    return COMPATIBILITY_SCORE_MIN;
  }
  return Math.min(COMPATIBILITY_SCORE_MAX, Math.max(COMPATIBILITY_SCORE_MIN, score));
}

export function isCompatibilityScoreInBounds(score: number): boolean {
  return Number.isFinite(score) && score >= COMPATIBILITY_SCORE_MIN && score <= COMPATIBILITY_SCORE_MAX;
}

/**
 * FR-043: one-decimal display string without changing the unrounded ranking value.
 * Always derived from a bounded score so UI never shows values outside 0.0–100.0.
 */
export function formatCompatibilityDisplayScore(score: number): string {
  return boundCompatibilityScore(score).toFixed(1);
}

/**
 * Validates scoring inputs for explicit field errors (NR-017: preserve caller data).
 * Unknown goals/roles and out-of-range hours are rejected; omitted optionals are allowed
 * and scored as 0 by the engine (FR-043 missing-input rule).
 */
export function validateCompatibilityScoreInputs(
  slot: SlotScoringInput,
  candidate: CandidateScoringInput
): { ok: true } | { ok: false; errors: CompatibilityScoreFieldErrors } {
  const errors: CompatibilityScoreFieldErrors = {};

  if (slot.role != null && slot.role !== '' && normalizeRole(slot.role) === null) {
    errors.role = `Slot role must be one of: ${ALLOWED_PRIMARY_ROLES.join(', ')}.`;
  }
  if (
    candidate.primaryRole != null &&
    candidate.primaryRole !== '' &&
    normalizeRole(candidate.primaryRole) === null
  ) {
    errors.primaryRole = `Primary role must be one of: ${ALLOWED_PRIMARY_ROLES.join(', ')}.`;
  }

  if (slot.goal != null && slot.goal !== '' && normalizeGoal(slot.goal) === null) {
    errors.goal = `Goal must be one of: ${TEAM_GOALS.join(', ')}.`;
  }
  if (
    candidate.goal != null &&
    candidate.goal !== '' &&
    normalizeGoal(candidate.goal) === null
  ) {
    errors.candidateGoal = `Goal must be one of: ${TEAM_GOALS.join(', ')}.`;
  }

  if (slot.requiredSkills != null) {
    if (!Array.isArray(slot.requiredSkills)) {
      errors.requiredSkills = 'Required skills must be an array of strings.';
    } else if (slot.requiredSkills.some((t) => typeof t !== 'string')) {
      errors.requiredSkills = 'Each required skill must be a string.';
    }
  }
  if (candidate.skills != null) {
    if (!Array.isArray(candidate.skills)) {
      errors.skills = 'Candidate skills must be an array of strings.';
    } else if (candidate.skills.some((t) => typeof t !== 'string')) {
      errors.skills = 'Each candidate skill must be a string.';
    }
  }

  if (
    slot.requestedHours !== null &&
    slot.requestedHours !== undefined &&
    (!isFiniteNonNegativeNumber(slot.requestedHours) ||
      slot.requestedHours > TEAM_MAX_COMMITMENT_HOURS)
  ) {
    errors.requestedHours = `Requested hours must be between 0 and ${TEAM_MAX_COMMITMENT_HOURS}.`;
  }
  if (
    candidate.commitmentHours !== null &&
    candidate.commitmentHours !== undefined &&
    (!isFiniteNonNegativeNumber(candidate.commitmentHours) ||
      candidate.commitmentHours > TEAM_MAX_COMMITMENT_HOURS)
  ) {
    errors.commitmentHours = `Commitment hours must be between 0 and ${TEAM_MAX_COMMITMENT_HOURS}.`;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

/**
 * Computes FR-043–045 compatibility for one slot ↔ candidate pair.
 * Does not invent missing values; invalid callers should use validateCompatibilityScoreInputs first.
 */
export function computeCompatibilityScore(
  slot: SlotScoringInput,
  candidate: CandidateScoringInput
): CompatibilityScoreResult {
  const skillPart = computeSkillCoverage(
    slot.requiredSkills,
    candidate.skills,
    slot.role,
    candidate.primaryRole
  );
  const goalPart = computeGoalAlignment(slot.goal, candidate.goal);
  const hoursPart = computeHoursAlignment(slot.requestedHours, candidate.commitmentHours);

  const components: CompatibilityComponents = {
    skill: skillPart.s,
    goal: goalPart.g,
    hours: hoursPart.h,
  };

  const rawScore = 100 * (components.skill + components.goal + components.hours) * SCORE_COMPONENT_WEIGHT;
  const boundedScore = boundCompatibilityScore(rawScore);

  const requiredCount = (slot.requiredSkills ?? []).filter(
    (t) => typeof t === 'string' && t.trim().length > 0
  ).length;

  return {
    score: boundedScore,
    displayScore: formatCompatibilityDisplayScore(boundedScore),
    components,
    matchedSkills: skillPart.matchedSkills,
    roleMatched: skillPart.roleMatched,
    hadMissingInput:
      skillPart.missingSkillsInput || goalPart.missing || hoursPart.missing,
    contributions: {
      skill:
        requiredCount === 0
          ? skillPart.roleMatched
            ? 'No required skills listed; full skill coverage (role match applied, capped at 1.0).'
            : 'No required skills listed; full skill coverage (S = 1.0).'
          : `Matched ${skillPart.matchedSkills.length} of ${requiredCount} required skills` +
            (skillPart.roleMatched ? ' with primary-role match (×1.2, capped at 1.0).' : '.'),
      goal: goalPart.missing
        ? 'Goal alignment unavailable (missing goal on team or candidate); scored 0.'
        : goalPart.g === 1
          ? 'Identical goals.'
          : goalPart.g === 0.5
            ? 'Adjacent goals (partial alignment).'
            : 'Non-adjacent goals.',
      hours: hoursPart.missing
        ? 'Hours alignment unavailable (missing commitment data); scored 0.'
        : slot.requestedHours === 0
          ? 'Team requested 0 hours; full hours coverage (H = 1.0).'
          : `Commitment ${candidate.commitmentHours}h vs requested ${slot.requestedHours}h.`,
    },
  };
}

/**
 * FR-043 ranking comparator:
 * 1) higher unrounded score (after bounding to 0–100)
 * 2) display handle (case-insensitive)
 * 3) internal identifier (never shown in UI)
 * Stable for identical inputs.
 */
export function compareCompatibilityResults(
  a: RankableCompatibilityResult,
  b: RankableCompatibilityResult
): number {
  const scoreA = boundCompatibilityScore(a.score);
  const scoreB = boundCompatibilityScore(b.score);
  if (scoreA !== scoreB) {
    return scoreB - scoreA;
  }
  const handleCmp = (a.displayHandle || '').localeCompare(b.displayHandle || '', 'en', {
    sensitivity: 'base',
  });
  if (handleCmp !== 0) return handleCmp;
  return (a.internalId || '').localeCompare(b.internalId || '', 'en');
}

/**
 * Sorts candidates with FR-043 tie-breaking and assigns 1-based `rank`.
 * Does not expose internalId as a display field — callers should omit it from API DTOs.
 */
export function sortWithCompatibilityRanks<T extends RankableCompatibilityResult>(
  results: readonly T[]
): Array<T & { rank: number }> {
  const sorted = [...results].sort(compareCompatibilityResults);
  return sorted.map((row, index) => ({ ...row, rank: index + 1 }));
}

function throwValidationErrors(errors: CompatibilityScoreFieldErrors): never {
  const err = new Error('Validation failed') as Error & {
    status: number;
    errors: CompatibilityScoreFieldErrors;
  };
  err.status = 400;
  err.errors = errors;
  throw err;
}

/**
 * Scores and sorts candidates deterministically. Invalid inputs throw with field errors
 * so callers can return 400 without discarding other form state (NR-017).
 */
export function rankCandidatesByCompatibility(
  slot: SlotScoringInput,
  candidates: ReadonlyArray<
    CandidateScoringInput & { displayHandle?: string | null; internalId: string }
  >
): RankedCompatibilityResult[] {
  // Slot-only shape check (candidate fields may be intentionally sparse → score 0).
  const slotCheck = validateCompatibilityScoreInputs(slot, {
    primaryRole: null,
    skills: [],
    commitmentHours: null,
    goal: null,
  });
  if (!slotCheck.ok) {
    throwValidationErrors(slotCheck.errors);
  }

  const ranked: RankableCompatibilityResult[] = candidates.map((candidate) => {
    const fieldCheck = validateCompatibilityScoreInputs(slot, candidate);
    if (!fieldCheck.ok) {
      throwValidationErrors(fieldCheck.errors);
    }
    const scored = computeCompatibilityScore(slot, candidate);
    return {
      ...scored,
      displayHandle: (candidate.displayHandle ?? '').trim() || '',
      internalId: candidate.internalId,
    };
  });

  return sortWithCompatibilityRanks(ranked);
}

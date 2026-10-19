import {
  SCORING_GOALS,
  SCORING_MAX_COMMITMENT_HOURS,
  SCORING_ROLES,
  type CandidateScoringFormState,
  type CompatibilityScoreFieldErrors,
  type CompatibilityScorePayload,
  type ScoringGoal,
  type ScoringRole,
  type SlotScoringFormState,
} from './compatibilityTypes';

function parseSkillsInput(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function normalizeRole(raw: string): ScoringRole | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  for (const role of SCORING_ROLES) {
    if (role.toLowerCase() === trimmed) return role;
  }
  return null;
}

function normalizeGoal(raw: string): ScoringGoal | null {
  const collapsed = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!collapsed) return null;
  for (const goal of SCORING_GOALS) {
    if (goal.toLowerCase() === collapsed) return goal;
  }
  return null;
}

function parseOptionalHours(
  raw: string,
  field: 'requestedHours' | 'commitmentHours',
  errors: CompatibilityScoreFieldErrors
): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > SCORING_MAX_COMMITMENT_HOURS) {
    errors[field] = `Hours must be between 0 and ${SCORING_MAX_COMMITMENT_HOURS}.`;
    return null;
  }
  return value;
}

/**
 * Client-side FR-043–045 input validation.
 * Returns field errors without mutating the caller's form state (NR-017).
 * Empty optional fields are allowed and will score as 0 on the server.
 */
export function validateCompatibilityScoreForms(
  slot: SlotScoringFormState,
  candidate: CandidateScoringFormState
):
  | { ok: true; payload: CompatibilityScorePayload }
  | { ok: false; errors: CompatibilityScoreFieldErrors } {
  const errors: CompatibilityScoreFieldErrors = {};

  let slotRole: string | null = null;
  if (slot.role.trim()) {
    const normalized = normalizeRole(slot.role);
    if (!normalized) {
      errors.role = `Slot role must be one of: ${SCORING_ROLES.join(', ')}.`;
    } else {
      slotRole = normalized;
    }
  }

  let candidateRole: string | null = null;
  if (candidate.primaryRole.trim()) {
    const normalized = normalizeRole(candidate.primaryRole);
    if (!normalized) {
      errors.primaryRole = `Primary role must be one of: ${SCORING_ROLES.join(', ')}.`;
    } else {
      candidateRole = normalized;
    }
  }

  let slotGoal: string | null = null;
  if (slot.goal.trim()) {
    const normalized = normalizeGoal(slot.goal);
    if (!normalized) {
      errors.goal = `Goal must be one of: ${SCORING_GOALS.join(', ')}.`;
    } else {
      slotGoal = normalized;
    }
  }

  let candidateGoal: string | null = null;
  if (candidate.goal.trim()) {
    const normalized = normalizeGoal(candidate.goal);
    if (!normalized) {
      errors.candidateGoal = `Goal must be one of: ${SCORING_GOALS.join(', ')}.`;
    } else {
      candidateGoal = normalized;
    }
  }

  const requestedHours = parseOptionalHours(slot.requestedHours, 'requestedHours', errors);
  const commitmentHours = parseOptionalHours(
    candidate.commitmentHours,
    'commitmentHours',
    errors
  );

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    payload: {
      slot: {
        role: slotRole,
        requiredSkills: parseSkillsInput(slot.requiredSkillsInput),
        requestedHours,
        goal: slotGoal,
      },
      candidate: {
        primaryRole: candidateRole,
        skills: parseSkillsInput(candidate.skillsInput),
        commitmentHours,
        goal: candidateGoal,
        displayHandle: candidate.displayHandle.trim() || null,
      },
    },
  };
}

/** One-decimal display helper matching FR-043 (server remains authoritative for ranking). */
export function formatCompatibilityDisplayScore(score: number): string {
  const bounded = Math.min(100, Math.max(0, score));
  return bounded.toFixed(1);
}

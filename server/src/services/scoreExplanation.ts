/**
 * FR-047 / US-015: owner-facing score explanations without internal identifiers.
 *
 * Ranking may use an internal id for final tie-break, but that value must never appear
 * in contribution text or public response DTOs. participantId may still be returned
 * separately for invitation wiring (FR-048) — never inside explanation strings.
 */

import type { CompatibilityScoreResult } from './compatibilityScoring.js';

export const SELF_DECLARED_SCORE_NOTICE =
  'Scores use self-declared skills, role, goal, and hours. Compatibility is a recommendation aid, not a probability of team success.';

export type ScoreContributionComponent = 'skill' | 'goal' | 'hours';

export interface PublicScoreContributionItem {
  component: ScoreContributionComponent;
  label: string;
  /** Component value in [0, 1]. */
  value: number;
  /** Human-readable explanation (no UUIDs / internal ids). */
  detail: string;
}

export interface PublicScoreExplanation {
  displayScore: string;
  score: number;
  notice: string;
  roleMatched: boolean;
  matchedSkills: string[];
  hadMissingInput: boolean;
  items: PublicScoreContributionItem[];
  /** Flat strings kept for simple clients; same text as items[].detail. */
  contributions: {
    skill: string;
    goal: string;
    hours: string;
  };
}

const INTERNAL_ID_KEY = /internalId|internal_id|internalIdentifier/i;
const UUID_IN_TEXT =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

/**
 * Builds the owner-visible explanation from a scored result.
 * Drops ranking-only fields (displayHandle / internalId) if present on the input.
 */
export function buildPublicScoreExplanation(
  result: CompatibilityScoreResult,
  options?: { notice?: string }
): PublicScoreExplanation {
  const contributions = {
    skill: sanitizeExplanationText(result.contributions.skill),
    goal: sanitizeExplanationText(result.contributions.goal),
    hours: sanitizeExplanationText(result.contributions.hours),
  };

  return {
    displayScore: result.displayScore,
    score: result.score,
    notice: options?.notice ?? SELF_DECLARED_SCORE_NOTICE,
    roleMatched: result.roleMatched,
    matchedSkills: [...result.matchedSkills],
    hadMissingInput: result.hadMissingInput,
    items: [
      {
        component: 'skill',
        label: 'Skills',
        value: result.components.skill,
        detail: contributions.skill,
      },
      {
        component: 'goal',
        label: 'Goal',
        value: result.components.goal,
        detail: contributions.goal,
      },
      {
        component: 'hours',
        label: 'Hours',
        value: result.components.hours,
        detail: contributions.hours,
      },
    ],
    contributions,
  };
}

/** Strip accidental UUIDs from explanation copy (defense in depth). */
export function sanitizeExplanationText(text: string): string {
  return text.replace(UUID_IN_TEXT, '[redacted]');
}

/**
 * Recursively removes ranking-only internal identifier keys from a JSON-like value.
 * Does not remove participantId (invite key) — only internalId-style fields.
 */
export function omitInternalIdentifierFields<T>(value: T): T {
  return scrub(value) as T;
}

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(scrub);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (INTERNAL_ID_KEY.test(key)) continue;
      out[key] = scrub(child);
    }
    return out;
  }
  return value;
}

/**
 * Narrow check: explanation payload must not include internalId keys or UUIDs in detail text.
 */
export function assertPublicExplanationSafe(explanation: PublicScoreExplanation): void {
  const serialized = JSON.stringify(explanation);
  if (INTERNAL_ID_KEY.test(serialized)) {
    throw new Error('Public score explanation must not include internal identifier fields.');
  }
  for (const item of explanation.items) {
    if (UUID_IN_TEXT.test(item.detail)) {
      throw new Error('Public score explanation details must not include internal identifiers.');
    }
  }
}

/** True if a public JSON payload still contains ranking-only internalId keys. */
export function publicPayloadHasInternalIdKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(publicPayloadHasInternalIdKey);
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (INTERNAL_ID_KEY.test(key)) return true;
      if (publicPayloadHasInternalIdKey(child)) return true;
    }
  }
  return false;
}

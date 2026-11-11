/**
 * US-016 / #155 — match percentage and matched skill tags for recommended teams.
 *
 * Given the participant's reverse-matching inputs (#153, `buildReverseMatchInputs`) and an open
 * team vacancy, this works out HOW WELL the vacancy suits the participant:
 *
 *   matchPercent  a whole number from 0 to 100 (the rounded compatibility score);
 *   matchedSkills the vacancy's required skills the participant has, in the vacancy's own spelling;
 *   missingSkills the required skills the participant does not have yet.
 *
 * It reuses the platform's one compatibility formula (FR-043 to FR-045, policy R-04) instead of
 * inventing a second one, so a team and a candidate always get the same score for the same pair:
 *
 *   score = 100 * (S + G + H) / 3, each part between 0 and 1
 *   S  share of the vacancy's required skills the participant has (x1.2 when the roles match,
 *      capped at 1; a vacancy that lists no required skills gives S = 1)
 *   G  goal fit: same goal 1, neighbouring goals 0.5, otherwise 0
 *   H  hours fit: min(participant hours / team hours, 1)
 *   anything the participant or team has not stated scores 0 and is never invented.
 *
 * The participant's role for the role bonus is the role they are looking for (their Looking-for-Team
 * preference), or their primary role when they have not set one. Nothing here reads or writes data,
 * and nothing returned contains an email or any private field. Which teams may be shown at all is
 * decided earlier by `teamRecommendationEligibility.ts`.
 */

import type { Team, TeamVacancy } from '../db/types.js';
import {
  computeCompatibilityScore,
  boundCompatibilityScore,
  type CompatibilityComponents,
} from './compatibilityScoring.js';
import { normalizeSkillTags, skillKey, type ReverseMatchInputs } from './teamRecommendationEligibility.js';

/** An open vacancy and the team facts the score needs. */
export interface ScorableTeamVacancy {
  team: Pick<Team, 'id' | 'name' | 'goal' | 'commitment_hours'>;
  vacancy: Pick<TeamVacancy, 'id' | 'role' | 'skills'>;
}

export interface TeamMatchScore {
  teamId: string;
  vacancyId: string;
  /** Whole number, 0 to 100: the score shown to the participant. */
  matchPercent: number;
  /** Unrounded score, 0 to 100, used to order suggestions. */
  score: number;
  /** One-decimal text of the unrounded score, for example "53.3". */
  displayScore: string;
  /** Required skills the participant has, in the vacancy's own spelling and order. */
  matchedSkills: string[];
  /** Required skills the participant does not have, in the vacancy's own spelling and order. */
  missingSkills: string[];
  /** How many different skills the vacancy requires. */
  requiredSkillCount: number;
  /** True when the participant's role matches the vacancy role (the x1.2 bonus applied). */
  roleMatched: boolean;
  components: CompatibilityComponents;
  /** True when a part of the score used the "not stated scores 0" rule. */
  hadMissingInput: boolean;
  contributions: { skill: string; goal: string; hours: string };
}

/**
 * Required skills as the team wrote them: trimmed, single-spaced, no duplicates that differ only by
 * case or spacing. The first spelling wins.
 */
function requiredSkillsOf(vacancy: Pick<TeamVacancy, 'skills'>): string[] {
  return normalizeSkillTags(vacancy.skills);
}

/** Scores one open vacancy for one participant. Never throws; missing data scores 0. */
export function scoreTeamVacancy(
  inputs: ReverseMatchInputs,
  candidate: ScorableTeamVacancy
): TeamMatchScore {
  const required = requiredSkillsOf(candidate.vacancy);

  const result = computeCompatibilityScore(
    {
      role: candidate.vacancy.role,
      requiredSkills: required,
      requestedHours: Number(candidate.team.commitment_hours),
      goal: candidate.team.goal,
    },
    {
      primaryRole: inputs.desiredRole ?? inputs.primaryRole,
      // Cleaned again here so matching never depends on the caller having done it.
      skills: normalizeSkillTags(inputs.skills),
      commitmentHours: inputs.commitmentHours,
      goal: inputs.goal,
    }
  );

  // The engine reports matches in lower case; report them in the vacancy's own spelling.
  const matchedKeys = new Set(result.matchedSkills.map(skillKey));
  const matchedSkills = required.filter((skill) => matchedKeys.has(skillKey(skill)));
  const missingSkills = required.filter((skill) => !matchedKeys.has(skillKey(skill)));

  const score = boundCompatibilityScore(result.score);
  return {
    teamId: candidate.team.id,
    vacancyId: candidate.vacancy.id,
    matchPercent: Math.min(100, Math.max(0, Math.round(score))),
    score,
    displayScore: result.displayScore,
    matchedSkills,
    missingSkills,
    requiredSkillCount: required.length,
    roleMatched: result.roleMatched,
    components: result.components,
    hadMissingInput: result.hadMissingInput,
    contributions: result.contributions,
  };
}

export interface RankedTeamMatch extends TeamMatchScore {
  /** Team name for display and tie-breaking (the team's own public name). */
  teamName: string;
  /** 1-based position after ordering. */
  rank: number;
}

/**
 * Orders suggestions best first, the same way every time for the same data:
 * higher score, then more matched skills, then team name (A to Z, ignoring case), then vacancy id.
 * `limit` keeps only the top suggestions (no limit when omitted); an invalid limit is ignored.
 */
export function rankTeamVacancies(
  inputs: ReverseMatchInputs,
  candidates: readonly ScorableTeamVacancy[],
  limit?: number
): RankedTeamMatch[] {
  const scored = candidates.map((candidate) => ({
    ...scoreTeamVacancy(inputs, candidate),
    teamName: candidate.team.name,
  }));

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.matchedSkills.length !== b.matchedSkills.length) {
      return b.matchedSkills.length - a.matchedSkills.length;
    }
    const byName = a.teamName.localeCompare(b.teamName, 'en', { sensitivity: 'base' });
    if (byName !== 0) return byName;
    return a.vacancyId.localeCompare(b.vacancyId, 'en');
  });

  const ranked = scored.map((row, index) => ({ ...row, rank: index + 1 }));
  return typeof limit === 'number' && Number.isInteger(limit) && limit >= 0 ? ranked.slice(0, limit) : ranked;
}

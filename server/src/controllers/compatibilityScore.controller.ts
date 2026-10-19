import type { Request, Response, NextFunction } from 'express';
import {
  computeCompatibilityScore,
  type CandidateScoringInput,
  type SlotScoringInput,
} from '../services/compatibilityScoring.js';
import {
  assertPublicExplanationSafe,
  buildPublicScoreExplanation,
  omitInternalIdentifierFields,
} from '../services/scoreExplanation.js';

/**
 * POST /api/scoring/compatibility
 * Dry-run FR-043–045 scoring with FR-047 explainable contributions (no internal ids).
 */
export async function previewCompatibilityScore(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { slot, candidate } = req.body as {
      slot: SlotScoringInput;
      candidate: CandidateScoringInput;
    };

    const result = computeCompatibilityScore(slot, candidate);
    const explanation = buildPublicScoreExplanation(result);
    assertPublicExplanationSafe(explanation);

    const payload = omitInternalIdentifierFields({
      status: 'ok' as const,
      score: explanation.score,
      displayScore: explanation.displayScore,
      components: result.components,
      matchedSkills: explanation.matchedSkills,
      roleMatched: explanation.roleMatched,
      hadMissingInput: explanation.hadMissingInput,
      contributions: explanation.contributions,
      explanation,
      notice: explanation.notice,
    });

    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
}

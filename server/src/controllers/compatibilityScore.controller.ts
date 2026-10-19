import type { Request, Response, NextFunction } from 'express';
import {
  computeCompatibilityScore,
  type CandidateScoringInput,
  type SlotScoringInput,
} from '../services/compatibilityScoring.js';

/**
 * POST /api/scoring/compatibility
 * Dry-run FR-043–045 scoring for a slot ↔ candidate pair (US-015 scoring-rules task).
 * Returns explainable contributions; never invents missing inputs (scores them as 0).
 * Full recommendation ranking/eligibility is a separate US-015 service task.
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

    res.status(200).json({
      status: 'ok',
      score: result.score,
      displayScore: result.displayScore,
      components: result.components,
      matchedSkills: result.matchedSkills,
      roleMatched: result.roleMatched,
      hadMissingInput: result.hadMissingInput,
      contributions: result.contributions,
      notice:
        'Scores use self-declared skills, role, goal, and hours. Compatibility is a recommendation aid, not a probability of team success.',
    });
  } catch (err) {
    next(err);
  }
}

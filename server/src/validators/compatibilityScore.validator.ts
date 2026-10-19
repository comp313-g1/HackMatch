import type { Request, Response, NextFunction } from 'express';
import type {
  CandidateScoringInput,
  CompatibilityScoreFieldErrors,
  SlotScoringInput,
} from '../services/compatibilityScoring.js';
import { validateCompatibilityScoreInputs } from '../services/compatibilityScoring.js';

export interface CompatibilityScoreRequestBody {
  slot: SlotScoringInput;
  candidate: CandidateScoringInput;
}

/**
 * Parses POST body for FR-043–045 score preview / dry-run.
 * On failure returns 400 with field errors and echoes submitted values (NR-017).
 */
export function parseCompatibilityScoreBody(body: unknown):
  | { ok: true; slot: SlotScoringInput; candidate: CandidateScoringInput }
  | {
      ok: false;
      errors: CompatibilityScoreFieldErrors;
      submitted: unknown;
    } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      errors: { body: 'Request body must be a JSON object with slot and candidate.' },
      submitted: body,
    };
  }

  const record = body as Record<string, unknown>;
  if (record.slot === null || typeof record.slot !== 'object' || Array.isArray(record.slot)) {
    return {
      ok: false,
      errors: { body: 'slot must be an object.' },
      submitted: body,
    };
  }
  if (
    record.candidate === null ||
    typeof record.candidate !== 'object' ||
    Array.isArray(record.candidate)
  ) {
    return {
      ok: false,
      errors: { body: 'candidate must be an object.' },
      submitted: body,
    };
  }

  const slotRaw = record.slot as Record<string, unknown>;
  const candRaw = record.candidate as Record<string, unknown>;

  const slot: SlotScoringInput = {
    role: slotRaw.role as string | null | undefined,
    requiredSkills: slotRaw.requiredSkills as readonly string[] | null | undefined,
    requestedHours: slotRaw.requestedHours as number | null | undefined,
    goal: slotRaw.goal as string | null | undefined,
  };
  const candidate: CandidateScoringInput = {
    primaryRole: candRaw.primaryRole as string | null | undefined,
    skills: candRaw.skills as readonly string[] | null | undefined,
    commitmentHours: candRaw.commitmentHours as number | null | undefined,
    goal: candRaw.goal as string | null | undefined,
    displayHandle: candRaw.displayHandle as string | null | undefined,
    internalId: candRaw.internalId as string | null | undefined,
  };

  const validation = validateCompatibilityScoreInputs(slot, candidate);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, submitted: body };
  }

  return { ok: true, slot, candidate };
}

export function validateCompatibilityScorePayload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const parsed = parseCompatibilityScoreBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({
      error: 'Validation failed.',
      code: 'COMPATIBILITY_SCORE_VALIDATION',
      errors: parsed.errors,
      submitted: parsed.submitted,
    });
    return;
  }
  req.body = {
    slot: parsed.slot,
    candidate: parsed.candidate,
  } satisfies CompatibilityScoreRequestBody;
  next();
}

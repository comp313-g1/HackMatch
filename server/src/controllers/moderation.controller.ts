import type { Request, Response, NextFunction } from 'express';
import type { ModerationCaseStatus } from '../db/types.js';
import type {
  CreateModerationCaseSanitized,
  DecideModerationCaseSanitized,
} from '../validators/moderation.validator.js';
import {
  createModerationCase,
  getModerationCaseDetail,
  listModerationActionRecords,
  listModerationQueue,
  ModerationServiceError,
} from '../services/moderationCases.js';
import { decideModerationCase } from '../services/moderationDecisions.js';

function handleModerationError(err: unknown, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  if (err instanceof ModerationServiceError) {
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }
  next(err);
}

/**
 * GET /api/admin/moderation/cases — newest-first safety queue (US-026 / #239 / FR-075).
 */
export async function listModerationCasesHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = (res.locals.moderationQueueQuery || {}) as {
      status?: ModerationCaseStatus;
      limit?: number;
    };
    const cases = await listModerationQueue(query);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ cases });
  } catch (err: unknown) {
    handleModerationError(err, res, next);
  }
}

/**
 * GET /api/admin/moderation/cases/:caseId — case + sanitized target detail (US-026 / #239).
 */
export async function getModerationCaseDetailHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const detail = await getModerationCaseDetail(String(req.params.caseId));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(detail);
  } catch (err: unknown) {
    handleModerationError(err, res, next);
  }
}

/**
 * POST /api/admin/moderation/cases — ADMIN opens a case with target, reason, time (US-026 AC 1).
 */
export async function createModerationCaseHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = req.participant;
    if (!actor) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(401).json({
        error: 'Authentication required. Missing or malformed Authorization header.',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    const body = req.body as CreateModerationCaseSanitized;
    const created = await createModerationCase({
      actorParticipantId: actor.id,
      actorRole: actor.role,
      targetType: body.targetType,
      targetId: body.targetId,
      reason: body.reason,
      flaggedUrl: body.flaggedUrl,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ case: created });
  } catch (err: unknown) {
    handleModerationError(err, res, next);
  }
}

/**
 * GET /api/admin/moderation/cases/:caseId/action-records — safe FR-079 records (#243).
 */
export async function listModerationActionRecordsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const records = await listModerationActionRecords(String(req.params.caseId));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ records });
  } catch (err: unknown) {
    handleModerationError(err, res, next);
  }
}

/**
 * POST /api/admin/moderation/cases/:caseId/decide — dismiss/redact/warn/hide/disable_url (#242).
 */
export async function decideModerationCaseHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = req.participant;
    if (!actor) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(401).json({
        error: 'Authentication required. Missing or malformed Authorization header.',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    const body = req.body as DecideModerationCaseSanitized;
    const result = await decideModerationCase({
      actorParticipantId: actor.id,
      actorRole: actor.role,
      caseId: String(req.params.caseId),
      action: body.action,
      reason: body.reason,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      case: result.case,
      action: result.action,
      outcome: result.outcome,
      safeStateSummary: result.safeStateSummary,
    });
  } catch (err: unknown) {
    handleModerationError(err, res, next);
  }
}

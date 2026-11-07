import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  MAX_REPORT_EXPLANATION_LENGTH,
  MAX_REPORT_FLAGGED_URL_LENGTH,
  REPORT_CATEGORIES,
  REPORT_TARGET_TYPES,
  isValidHttpsReportUrl,
  isValidReportCategory,
  isValidReportTargetType,
  isValidReportUuid,
  normalizeReportExplanation,
  normalizeReportFlaggedUrl,
} from '../db/moderationReportModel.js';
import type {
  ModerationReportCategory,
  ModerationReportTargetType,
} from '../db/types.js';

export {
  MAX_REPORT_EXPLANATION_LENGTH,
  MAX_REPORT_FLAGGED_URL_LENGTH,
  REPORT_CATEGORIES,
  REPORT_TARGET_TYPES,
};

const ALLOWED_REPORT_KEYS = new Set([
  'targetType',
  'targetId',
  'category',
  'explanation',
  'flaggedUrl',
]);

export interface ValidatedModerationReportInput {
  targetType: ModerationReportTargetType;
  targetId: string;
  category: ModerationReportCategory;
  explanation: string | null;
  flaggedUrl: string | null;
}

export interface ModerationReportValidationResult {
  valid: boolean;
  fieldErrors: Record<string, string>;
  normalized: ValidatedModerationReportInput | null;
  submitted: unknown;
}

/**
 * Pure validator for participant report submissions (US-025 AC 2 / #233 / FR-073 / NR-017).
 * Validates targetType, targetId, category ('Harassment', 'Spam', 'Phishing Link', 'Fake Account'),
 * optional explanation (trimmed, <= 1000 chars), and optional/required https:// flaggedUrl.
 */
export function validateModerationReportPayload(
  body: unknown
): ModerationReportValidationResult {
  const submitted = body;

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      fieldErrors: {
        body: 'Request body must be a JSON object.',
      },
      normalized: null,
      submitted,
    };
  }

  const record = body as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};

  for (const key of Object.keys(record)) {
    if (!ALLOWED_REPORT_KEYS.has(key)) {
      fieldErrors[key] = `Unknown field "${key}".`;
    }
  }

  const rawTargetType = record.targetType;
  let targetType: ModerationReportTargetType | null = null;
  if (typeof rawTargetType !== 'string' || !isValidReportTargetType(rawTargetType)) {
    fieldErrors.targetType =
      'Please select a valid report target (team, profile, event, or url).';
  } else {
    targetType = rawTargetType.trim() as ModerationReportTargetType;
  }

  const rawTargetId = record.targetId;
  let targetId: string | null = null;
  if (typeof rawTargetId !== 'string' || !isValidReportUuid(rawTargetId)) {
    fieldErrors.targetId = 'A valid target identifier is required.';
  } else {
    targetId = rawTargetId.trim();
  }

  const rawCategory = record.category;
  let category: ModerationReportCategory | null = null;
  if (typeof rawCategory !== 'string' || !isValidReportCategory(rawCategory)) {
    fieldErrors.category =
      'Please select a valid category (Harassment, Spam, Phishing Link, or Fake Account).';
  } else {
    category = rawCategory.trim() as ModerationReportCategory;
  }

  const rawExplanation = record.explanation;
  let explanation: string | null = null;
  if (rawExplanation !== undefined && rawExplanation !== null) {
    if (typeof rawExplanation !== 'string') {
      fieldErrors.explanation = 'Explanation must be a string when provided.';
    } else {
      const normalizedExplanation = normalizeReportExplanation(rawExplanation);
      if (
        normalizedExplanation !== null &&
        [...normalizedExplanation].length > MAX_REPORT_EXPLANATION_LENGTH
      ) {
        fieldErrors.explanation = `Explanation must not exceed ${MAX_REPORT_EXPLANATION_LENGTH} characters.`;
      } else {
        explanation = normalizedExplanation;
      }
    }
  }

  const rawFlaggedUrl = record.flaggedUrl;
  let flaggedUrl: string | null = null;
  if (rawFlaggedUrl !== undefined && rawFlaggedUrl !== null) {
    if (typeof rawFlaggedUrl !== 'string') {
      fieldErrors.flaggedUrl =
        'Flagged URL must be a valid https:// URL when provided.';
    } else {
      flaggedUrl = normalizeReportFlaggedUrl(rawFlaggedUrl);
    }
  }

  if (targetType === 'url' && !flaggedUrl) {
    fieldErrors.flaggedUrl =
      'A valid https:// URL is required when reporting a suspicious link.';
  } else if (flaggedUrl !== null && !isValidHttpsReportUrl(flaggedUrl)) {
    fieldErrors.flaggedUrl = `Flagged URL must be a valid https:// URL up to ${MAX_REPORT_FLAGGED_URL_LENGTH} characters.`;
  }

  if (
    Object.keys(fieldErrors).length > 0 ||
    !targetType ||
    !targetId ||
    !category
  ) {
    return {
      valid: false,
      fieldErrors,
      normalized: null,
      submitted,
    };
  }

  return {
    valid: true,
    fieldErrors: {},
    normalized: {
      targetType,
      targetId,
      category,
      explanation,
      flaggedUrl,
    },
    submitted,
  };
}

/**
 * Express middleware that validates POST /api/reports body and echoes submitted values
 * on 400 VALIDATION_ERROR so client forms preserve user input (NR-010 / NR-017).
 */
export const validateCreateModerationReport: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const result = validateModerationReportPayload(req.body);

  if (!result.valid || !result.normalized) {
    const firstMessage =
      Object.values(result.fieldErrors)[0] || 'Validation failed.';
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: firstMessage,
        fieldErrors: result.fieldErrors,
      },
      code: 'VALIDATION_ERROR',
      errors: result.fieldErrors,
      submitted: result.submitted,
    });
    return;
  }

  res.locals.validatedReport = result.normalized;
  req.body = result.normalized;
  next();
};

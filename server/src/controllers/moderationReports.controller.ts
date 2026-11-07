import type { Request, RequestHandler, Response } from 'express';
import {
  ReportServiceError,
  submitParticipantReport,
} from '../services/moderationReports.js';
import { toParticipantReportReceiptDto } from '../services/reportPrivacy.js';
import { ReportRateLimitError } from '../services/reportRateLimiter.js';
import {
  validateModerationReportPayload,
  type ValidatedModerationReportInput,
} from '../validators/moderationReport.validator.js';

export const createModerationReportHandler: RequestHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const participant = req.participant || res.locals.participant;
  if (!participant || !participant.id) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(401).json({
      error: 'Authentication required.',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  let input: ValidatedModerationReportInput = res.locals.validatedReport;
  if (!input) {
    const validated = validateModerationReportPayload(req.body);
    if (!validated.valid || !validated.normalized) {
      const firstMessage =
        Object.values(validated.fieldErrors)[0] || 'Validation failed.';
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: firstMessage,
          fieldErrors: validated.fieldErrors,
        },
        code: 'VALIDATION_ERROR',
        errors: validated.fieldErrors,
        submitted: req.body,
      });
      return;
    }
    input = validated.normalized;
  }

  try {
    const receipt = await submitParticipantReport(participant.id, input);
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({
      data: toParticipantReportReceiptDto(receipt),
    });
  } catch (err: unknown) {
    res.setHeader('Cache-Control', 'no-store');
    if (err instanceof ReportRateLimitError) {
      res.setHeader('Retry-After', String(err.retryAfterSeconds));
      res.status(429).json({
        error: {
          code: err.code,
          message: err.message,
          retryAfterSeconds: err.retryAfterSeconds,
        },
        code: err.code,
        retryAfterSeconds: err.retryAfterSeconds,
        submitted: req.body,
      });
      return;
    }

    if (err instanceof ReportServiceError) {
      res.status(err.status).json({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
        code: err.code,
        submitted: req.body,
      });
      return;
    }

    console.error('[REPORT ERROR]', err);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred while processing the report.',
      },
    });
  }
};

export const forbidParticipantReportReadHandler: RequestHandler = (
  _req: Request,
  res: Response
): void => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(403).json({
    error: {
      code: 'REPORT_READ_FORBIDDEN',
      message:
        'Moderation reports are confidential and cannot be read by participants.',
    },
    code: 'REPORT_READ_FORBIDDEN',
  });
};

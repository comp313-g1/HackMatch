import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { UUID_REGEX } from './team.validator.js';

export interface InvitationFieldErrors {
  vacancyId?: string;
  inviteeParticipantId?: string;
  source?: string;
  body?: string;
  _form?: string;
  [unknownKey: string]: string | undefined;
}

export interface IssueInvitationInputSanitized {
  vacancyId: string;
  inviteeParticipantId: string;
  /** Entry point for FR-048 audit/telemetry; optional. */
  source: 'recommendation' | 'direct';}

const ALLOWED_KEYS = new Set(['vacancyId', 'inviteeParticipantId', 'source']);

/**
 * Validates POST /api/teams/:teamId/invitations body (US-017 / FR-048).
 * Preserves caller-entered ids in the request body on failure via middleware pattern.
 */
export function validateIssueInvitationInput(raw: unknown): {
  errors: InvitationFieldErrors;
  sanitized: IssueInvitationInputSanitized | null;
} {
  const errors: InvitationFieldErrors = {};

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: { body: 'Request body must be a JSON object.' }, sanitized: null };
  }

  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) {
      errors[key] = `Unknown field "${key}".`;
    }
  }

  const vacancyIdRaw = record.vacancyId;
  if (typeof vacancyIdRaw !== 'string' || !UUID_REGEX.test(vacancyIdRaw.trim())) {
    errors.vacancyId = 'vacancyId must be a valid UUID.';
  }

  const inviteeRaw = record.inviteeParticipantId;
  if (typeof inviteeRaw !== 'string' || !UUID_REGEX.test(inviteeRaw.trim())) {
    errors.inviteeParticipantId = 'inviteeParticipantId must be a valid UUID.';
  }

  let source: 'recommendation' | 'direct' = 'direct';
  if (record.source !== undefined) {
    if (record.source !== 'recommendation' && record.source !== 'direct') {
      errors.source = 'source must be "recommendation" or "direct".';
    } else {
      source = record.source;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors, sanitized: null };
  }

  return {
    errors: {},
    sanitized: {
      vacancyId: String(vacancyIdRaw).trim(),
      inviteeParticipantId: String(inviteeRaw).trim(),
      source,
    },
  };
}

export const validateIssueInvitationBody: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const result = validateIssueInvitationInput(req.body);
  if (Object.keys(result.errors).length > 0 || !result.sanitized) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: result.errors,
    });
    return;
  }
  req.body = result.sanitized;
  next();
};

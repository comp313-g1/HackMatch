import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { UUID_REGEX } from './team.validator.js';

export interface InvitationFieldErrors {
  vacancyId?: string;
  slotId?: string;
  inviteeParticipantId?: string;
  inviteeId?: string;
  source?: string;
  body?: string;
  _form?: string;
  [unknownKey: string]: string | undefined;
}

export interface IssueInvitationInputSanitized {
  vacancyId: string;
  slotId: string;
  inviteeParticipantId: string;
  inviteeId: string;
  /** Entry point for FR-048 audit/telemetry; optional. */
  source: 'recommendation' | 'direct';
}

const ALLOWED_KEYS = new Set([
  'vacancyId',
  'slotId',
  'inviteeParticipantId',
  'inviteeId',
  'source',
]);

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

  const rawVacancy = record.slotId ?? record.vacancyId;
  if (record.slotId === undefined && record.vacancyId === undefined) {
    errors.vacancyId = 'vacancyId must be a valid UUID.';
  } else {
    if (record.vacancyId !== undefined) {
      if (typeof record.vacancyId !== 'string' || !UUID_REGEX.test(record.vacancyId.trim())) {
        errors.vacancyId = 'vacancyId must be a valid UUID.';
      }
    }
    if (record.slotId !== undefined) {
      if (typeof record.slotId !== 'string' || !UUID_REGEX.test(record.slotId.trim())) {
        errors.slotId = 'slotId must be a valid UUID.';
      }
    }
  }

  const rawInvitee = record.inviteeId ?? record.inviteeParticipantId;
  if (record.inviteeId === undefined && record.inviteeParticipantId === undefined) {
    errors.inviteeParticipantId = 'inviteeParticipantId must be a valid UUID.';
  } else {
    if (record.inviteeParticipantId !== undefined) {
      if (typeof record.inviteeParticipantId !== 'string' || !UUID_REGEX.test(record.inviteeParticipantId.trim())) {
        errors.inviteeParticipantId = 'inviteeParticipantId must be a valid UUID.';
      }
    }
    if (record.inviteeId !== undefined) {
      if (typeof record.inviteeId !== 'string' || !UUID_REGEX.test(record.inviteeId.trim())) {
        errors.inviteeId = 'inviteeId must be a valid UUID.';
      }
    }
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

  const vacancyId = String(rawVacancy).trim();
  const inviteeParticipantId = String(rawInvitee).trim();

  return {
    errors: {},
    sanitized: {
      vacancyId,
      slotId: vacancyId,
      inviteeParticipantId,
      inviteeId: inviteeParticipantId,
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

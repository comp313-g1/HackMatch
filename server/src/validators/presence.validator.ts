import type { Request, Response, NextFunction } from 'express';
import type { PresenceStatus } from '../db/types.js';

/** US-030 / #343 / FR-086 allowed presence values. */
export const PRESENCE_STATUSES = [
  'Online',
  'Idle',
  'Do Not Disturb',
  'Invisible',
] as const satisfies readonly PresenceStatus[];

export const DEFAULT_PRESENCE_STATUS: PresenceStatus = 'Invisible';

export interface PresenceFieldErrors {
  presenceStatus?: string;
  body?: string;
  [unknownKey: string]: string | undefined;
}

export interface ValidatedPresenceUpdateInput {
  presenceStatus: PresenceStatus;
}

const ALLOWED_PAYLOAD_KEYS = new Set(['presenceStatus', 'status']);

/**
 * Normalize client status strings to canonical FR-086 values.
 * Accepts exact labels and a few common aliases (dnd, do_not_disturb).
 */
export function normalizePresenceStatus(raw: unknown): PresenceStatus | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;

  for (const status of PRESENCE_STATUSES) {
    if (status.toLowerCase() === trimmed.toLowerCase()) {
      return status;
    }
  }

  const compact = trimmed.toLowerCase().replace(/[\s_-]+/g, '');
  if (compact === 'dnd' || compact === 'donotdisturb') {
    return 'Do Not Disturb';
  }
  if (compact === 'online') return 'Online';
  if (compact === 'idle' || compact === 'away') return 'Idle';
  if (compact === 'invisible' || compact === 'offline' || compact === 'hidden') {
    return 'Invisible';
  }

  return null;
}

export function validatePresenceUpdatePayload(body: unknown): {
  isValid: boolean;
  errors: PresenceFieldErrors;
  data?: ValidatedPresenceUpdateInput;
} {
  const errors: PresenceFieldErrors = {};

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      isValid: false,
      errors: { body: 'Request body must be a JSON object.' },
    };
  }

  const record = body as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!ALLOWED_PAYLOAD_KEYS.has(key)) {
      errors[key] = `Unknown field '${key}' is not allowed.`;
    }
  }

  const rawStatus =
    record.presenceStatus !== undefined ? record.presenceStatus : record.status;

  if (rawStatus === undefined || rawStatus === null) {
    errors.presenceStatus =
      'presenceStatus is required and must be one of: Online, Idle, Do Not Disturb, Invisible.';
  } else {
    const normalized = normalizePresenceStatus(rawStatus);
    if (!normalized) {
      errors.presenceStatus =
        'presenceStatus must be one of: Online, Idle, Do Not Disturb, Invisible.';
    } else if (Object.keys(errors).length === 0) {
      return {
        isValid: true,
        errors: {},
        data: { presenceStatus: normalized },
      };
    }
  }

  return { isValid: false, errors };
}

export function validatePresenceUpdateBody(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const result = validatePresenceUpdatePayload(req.body);
  if (!result.isValid || !result.data) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Invalid presence status.',
      code: 'VALIDATION_ERROR',
      fieldErrors: result.errors,
      errors: result.errors,
    });
    return;
  }

  req.body = result.data;
  next();
}

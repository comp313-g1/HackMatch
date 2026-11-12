import type { NextFunction, Request, Response } from 'express';

/**
 * US-035 / #407 — a typing signal body is exactly `{ "typing": true | false }`.
 *
 * No draft, message, keystroke, participant, or display-name field is accepted.
 * `req.body` is ALWAYS replaced before responding, even on rejection, because the
 * request logger records the request body: unexpected client fields (such as a
 * draft) must never reach the logs. Error messages name fields, never values.
 */
export function validateTypingSignalBody(req: Request, res: Response, next: NextFunction): void {
  const raw: unknown = req.body;
  const isObject = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
  const record = isObject ? (raw as Record<string, unknown>) : {};
  const errors: Record<string, string> = {};

  if (!isObject) errors.body = 'Request body must be a JSON object.';
  const unknownFields = Object.keys(record).filter((key) => key !== 'typing');
  if (unknownFields.length > 0) errors.request = 'Only the typing field is accepted.';
  if (typeof record.typing !== 'boolean') errors.typing = 'typing must be true or false.';

  if (Object.keys(errors).length > 0) {
    req.body = {};
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: 'Validation failed.', code: 'VALIDATION_ERROR', errors, fieldErrors: errors });
    return;
  }

  req.body = { typing: record.typing as boolean };
  next();
}

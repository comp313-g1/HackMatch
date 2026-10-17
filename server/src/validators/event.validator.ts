import type { Request, Response, NextFunction } from 'express';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates that :eventId route param is a valid UUIDv4/UUID.
 * Rejects with 400 Bad Request if malformed, preventing injection or wasted DB queries.
 */
export function validateEventIdParam(req: Request, res: Response, next: NextFunction): void {
  const { eventId } = req.params;

  if (!eventId || typeof eventId !== 'string' || !UUID_REGEX.test(eventId.trim())) {
    res.status(400).json({ error: 'Invalid event id' });
    return;
  }

  next();
}

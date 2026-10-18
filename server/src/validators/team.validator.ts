import type { Request, Response, NextFunction } from 'express';

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates teamId and optional vacancyId route parameters as valid UUIDs.
 */
export function validateTeamIdParams(req: Request, res: Response, next: NextFunction): void {
  const { teamId, vacancyId } = req.params;

  if (!teamId || typeof teamId !== 'string' || !UUID_REGEX.test(teamId.trim())) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: { teamId: 'Invalid team ID format.' },
    });
    return;
  }

  if (vacancyId !== undefined) {
    if (typeof vacancyId !== 'string' || !UUID_REGEX.test(vacancyId.trim())) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({
        error: 'Validation failed.',
        code: 'VALIDATION_ERROR',
        errors: { vacancyId: 'Invalid vacancy ID format.' },
      });
      return;
    }
  }

  next();
}

/**
 * Validates eventId query parameter for GET /api/teams/mine.
 */
export function validateMyTeamQuery(req: Request, res: Response, next: NextFunction): void {
  const { eventId } = req.query;

  if (!eventId || typeof eventId !== 'string' || !UUID_REGEX.test(eventId.trim())) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: { eventId: 'Event ID is required and must be a valid UUID.' },
    });
    return;
  }

  next();
}

/**
 * Ensures that request body is a non-null JSON object and not an array.
 */
export function requireJsonObjectBody(req: Request, res: Response, next: NextFunction): void {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: { body: 'Request body must be a JSON object.' },
    });
    return;
  }

  next();
}

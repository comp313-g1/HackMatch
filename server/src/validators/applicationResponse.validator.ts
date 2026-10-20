import type { NextFunction, Request, Response } from 'express';
import { UUID_REGEX } from './team.validator.js';

/** Reject malformed application ids before PostgreSQL UUID casts (#190). */
export function validateApplicationIdParam(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const applicationId = String(req.params.applicationId ?? '').trim();
  if (!UUID_REGEX.test(applicationId)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Application id must be a valid UUID.',
      code: 'VALIDATION_ERROR',
      errors: { applicationId: 'Application id must be a valid UUID.' },
    });
    return;
  }
  req.params.applicationId = applicationId;
  next();
}


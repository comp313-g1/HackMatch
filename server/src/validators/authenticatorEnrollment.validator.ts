import type { Request, Response, NextFunction } from 'express';

const ENROLLMENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function isObjectBody(body: unknown): body is Record<string, unknown> {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
}

/** Enrollment always targets the authenticated owner, so begin accepts no target fields. */
export function validateBeginAuthenticatorEnrollment(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const body = req.body ?? {};
  if (!isObjectBody(body) || Object.keys(body).length > 0) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors: {
        request: 'Authenticator enrollment does not accept account or participant fields.',
      },
    });
    return;
  }

  req.body = {};
  next();
}

export function validateConfirmAuthenticatorEnrollment(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const body = req.body;
  const errors: Record<string, string> = {};

  if (!isObjectBody(body)) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors: {
        enrollmentId: 'Enrollment id is required.',
        code: 'A 6-digit authenticator code is required.',
      },
    });
    return;
  }

  const extraFields = Object.keys(body).filter(
    (field) => field !== 'enrollmentId' && field !== 'code'
  );
  if (extraFields.length > 0) {
    errors.request = 'Only enrollmentId and code are accepted.';
  }

  const enrollmentId =
    typeof body.enrollmentId === 'string' ? body.enrollmentId.trim() : '';
  if (!ENROLLMENT_ID_PATTERN.test(enrollmentId)) {
    errors.enrollmentId = 'A valid enrollment id is required.';
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!/^\d{6}$/.test(code)) {
    errors.code = 'A 6-digit authenticator code is required.';
  }

  if (Object.keys(errors).length > 0) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors,
    });
    return;
  }

  // Never preserve or echo unapproved fields (especially arbitrary account IDs).
  req.body = { enrollmentId, code };
  next();
}

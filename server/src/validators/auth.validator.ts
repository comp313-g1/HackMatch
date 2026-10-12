import type { Request, Response, NextFunction } from 'express';

export interface RegistrationFieldErrors {
  fullName?: string;
  email?: string;
  password?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates password complexity per US-001 AC 1 / FR-001:
 * At least 8 characters, mixed case (uppercase & lowercase), a digit, and a special character.
 */
export function isPasswordPolicyCompliant(password: string): boolean {
  if (typeof password !== 'string' || password.length < 8) {
    return false;
  }
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  return hasUpper && hasLower && hasDigit && hasSpecial;
}

export const PRIVILEGE_ESCALATION_KEYS = [
  'isAdmin',
  'is_admin',
  'claims',
  'customClaims',
  'roles',
] as const;

/**
 * Express middleware validating registration payload for POST /api/auth/register.
 * Enforces role boundaries (HTTP 403 on role escalation attempts) and field
 * validation rules (HTTP 400 with structured field errors).
 */
export function validateRegisterPayload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json({
      error: 'Validation failed',
      errors: {
        fullName: 'Full name is required.',
        email: 'Email address is required.',
        password: 'Password is required.',
      },
    });
    return;
  }

  // 1. Role boundary & ADMIN protection (US-001 AC 4 / US-001-T6 / FR-001)
  if (body.role !== undefined && body.role !== null) {
    const rawRole = String(body.role).trim().toUpperCase();
    if (rawRole !== 'PART') {
      res.status(403).json({
        error: 'Public registration cannot grant administrative privileges.',
      });
      return;
    }
  }

  for (const key of PRIVILEGE_ESCALATION_KEYS) {
    if (
      (body as Record<string, unknown>)[key] !== undefined &&
      (body as Record<string, unknown>)[key] !== null
    ) {
      res.status(403).json({
        error: 'Public registration cannot grant administrative privileges.',
      });
      return;
    }
  }

  const fieldErrors: RegistrationFieldErrors = {};

  // 2. Full Name validation (trimmed string, 1-100 characters)
  const rawFullName = body.fullName;
  if (typeof rawFullName !== 'string' || rawFullName.trim().length === 0) {
    fieldErrors.fullName = 'Full name is required.';
  } else if (rawFullName.trim().length > 100) {
    fieldErrors.fullName = 'Full name must not exceed 100 characters.';
  }

  // 3. Email validation (trimmed string, syntax regex, max 255 chars, academic not required)
  const rawEmail = body.email;
  if (typeof rawEmail !== 'string' || rawEmail.trim().length === 0) {
    fieldErrors.email = 'Email address is required.';
  } else {
    const trimmedEmail = rawEmail.trim();
    if (trimmedEmail.length > 255 || !EMAIL_REGEX.test(trimmedEmail)) {
      fieldErrors.email = 'Please provide a valid email address.';
    }
  }

  // 4. Password validation (strict password policy)
  const rawPassword = body.password;
  if (typeof rawPassword !== 'string' || rawPassword.length === 0) {
    fieldErrors.password = 'Password is required.';
  } else if (!isPasswordPolicyCompliant(rawPassword)) {
    fieldErrors.password =
      'Password must be at least 8 characters long and include uppercase, lowercase, a number, and a special character.';
  }

  // 5. Halt on validation errors (NR-017 / NR-010)
  if (Object.keys(fieldErrors).length > 0) {
    res.status(400).json({
      error: 'Validation failed',
      errors: fieldErrors,
    });
    return;
  }

  // Whitelist and sanitize valid inputs in request body
  req.body = {
    fullName: (rawFullName as string).trim(),
    email: (rawEmail as string).trim().toLowerCase(),
    password: rawPassword as string,
  };

  next();
}

export interface ResendVerificationFieldErrors {
  email?: string;
}

export interface VerifyEmailFieldErrors {
  oobCode?: string;
}

/**
 * Express middleware validating payload for POST /api/auth/resend-verification.
 * Enforces email presence, syntax, and maximum length.
 */
export function validateResendVerificationPayload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json({
      error: 'Validation failed',
      errors: {
        email: 'Email address is required.',
      },
    });
    return;
  }

  const rawEmail = body.email;
  if (typeof rawEmail !== 'string' || rawEmail.trim().length === 0) {
    res.status(400).json({
      error: 'Validation failed',
      errors: {
        email: 'Email address is required.',
      },
    });
    return;
  }

  const trimmedEmail = rawEmail.trim();
  if (trimmedEmail.length > 255 || !EMAIL_REGEX.test(trimmedEmail)) {
    res.status(400).json({
      error: 'Validation failed',
      errors: {
        email: 'Please provide a valid email address.',
      },
    });
    return;
  }

  req.body = {
    email: trimmedEmail.toLowerCase(),
  };

  next();
}

/**
 * Express middleware validating payload for POST /api/auth/verify-email.
 * Enforces presence of non-empty oobCode string.
 */
export function validateVerifyEmailPayload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json({
      error: 'Validation failed',
      errors: {
        oobCode: 'Action code is required.',
      },
    });
    return;
  }

  const rawCode = body.oobCode;
  const rawEmail = body.email;

  const hasCode = typeof rawCode === 'string' && rawCode.trim().length > 0;
  const hasEmail = typeof rawEmail === 'string' && rawEmail.trim().length > 0;

  if (!hasCode && !hasEmail) {
    res.status(400).json({
      error: 'Validation failed',
      errors: {
        oobCode: 'Action code is required.',
      },
    });
    return;
  }

  req.body = {
    ...(hasCode ? { oobCode: (rawCode as string).trim() } : {}),
    ...(hasEmail ? { email: (rawEmail as string).trim().toLowerCase() } : {}),
  };

  next();
}

export const ALLOWED_OAUTH_PROVIDERS = ['google', 'github', 'google.com', 'github.com'] as const;
export type AllowedOAuthProvider = (typeof ALLOWED_OAUTH_PROVIDERS)[number];

export interface OAuthSignInFieldErrors {
  idToken?: string;
  provider?: string;
}

/**
 * Express middleware validating payload for POST /api/auth/oauth/sign-in.
 * Enforces presence of non-empty idToken and whitelisted provider ('google' or 'github').
 */
export function validateOAuthSignInPayload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json({
      error: 'Validation failed',
      errors: {
        idToken: 'Firebase ID token is required.',
        provider: 'Provider is required.',
      },
    });
    return;
  }

  const fieldErrors: OAuthSignInFieldErrors = {};

  const rawToken = body.idToken;
  if (typeof rawToken !== 'string' || rawToken.trim().length === 0) {
    fieldErrors.idToken = 'Firebase ID token is required.';
  }

  const rawProvider = body.provider;
  if (
    typeof rawProvider !== 'string' ||
    !ALLOWED_OAUTH_PROVIDERS.includes(rawProvider.trim().toLowerCase() as AllowedOAuthProvider)
  ) {
    fieldErrors.provider = "Provider must be 'google' or 'github'.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    res.status(400).json({
      error: 'Validation failed',
      errors: fieldErrors,
    });
    return;
  }

  req.body = {
    idToken: (rawToken as string).trim(),
    provider: (rawProvider as string).trim().toLowerCase(),
    consentHandleAvatar: Boolean(body.consentHandleAvatar),
  };

  next();
}


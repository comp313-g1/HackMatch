import type { Request, Response, NextFunction } from 'express';
import {
  evaluateAdminSelfPromotionAttempt,
  sanitizeSubmittedAccountDraft,
} from '../services/accountPrivacy.js';

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

  // 1. Role boundary & ADMIN protection (US-001 AC 4 / US-027 / #254)
  const privilegeKeys: Record<string, unknown> = {};
  for (const key of PRIVILEGE_ESCALATION_KEYS) {
    privilegeKeys[key] = (body as Record<string, unknown>)[key];
  }
  const selfPromotion = evaluateAdminSelfPromotionAttempt({
    role: body.role,
    privilegeKeys,
  });
  if (selfPromotion) {
    res.status(403).json({
      error: selfPromotion.message,
      code: selfPromotion.code,
      // NR-017 — keep non-secret draft fields; never echo password.
      submitted: sanitizeSubmittedAccountDraft(body),
    });
    return;
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
 * Shared email-only body validation used by resend-verification and password-reset.
 * Enforces email presence, syntax, and maximum length; normalizes to lowercase.
 */
function validateEmailOnlyPayload(
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
 * Express middleware validating payload for POST /api/auth/resend-verification.
 * Enforces email presence, syntax, and maximum length.
 */
export function validateResendVerificationPayload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  validateEmailOnlyPayload(req, res, next);
}

/**
 * Express middleware validating payload for POST /api/auth/password-reset (US-005 / FR-011).
 * Same email rules as resend-verification; preserves client-entered email on 400 via field errors.
 */
export function validatePasswordResetRequestPayload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  validateEmailOnlyPayload(req, res, next);
}

export interface PasswordResetConfirmFieldErrors {
  oobCode?: string;
  newPassword?: string;
  confirmPassword?: string;
}

/**
 * Express middleware validating POST /api/auth/password-reset/validate (US-005 / S1-P2-16).
 * Requires a non-empty oobCode string.
 */
export function validatePasswordResetValidatePayload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json({
      error: 'Validation failed',
      errors: {
        oobCode: 'Reset link code is required.',
      },
    });
    return;
  }

  const rawCode = body.oobCode;
  if (typeof rawCode !== 'string' || rawCode.trim().length === 0) {
    res.status(400).json({
      error: 'Validation failed',
      errors: {
        oobCode: 'Reset link code is required.',
      },
      code: 'INVALID_ACTION_CODE',
      state: 'invalid',
    });
    return;
  }

  req.body = { oobCode: rawCode.trim() };
  next();
}

/**
 * Express middleware validating POST /api/auth/password-reset/confirm (US-005 / FR-012).
 * Enforces oobCode presence and registration password policy; optional confirmPassword must match.
 * Field errors preserve client-entered values (NR-017).
 */
export function validatePasswordResetConfirmPayload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json({
      error: 'Validation failed',
      errors: {
        oobCode: 'Reset link code is required.',
        newPassword: 'Password is required.',
      } satisfies PasswordResetConfirmFieldErrors,
    });
    return;
  }

  const fieldErrors: PasswordResetConfirmFieldErrors = {};

  const rawCode = body.oobCode;
  if (typeof rawCode !== 'string' || rawCode.trim().length === 0) {
    fieldErrors.oobCode = 'Reset link code is required.';
  }

  const rawPassword = body.newPassword;
  if (typeof rawPassword !== 'string' || rawPassword.length === 0) {
    fieldErrors.newPassword = 'Password is required.';
  } else if (!isPasswordPolicyCompliant(rawPassword)) {
    fieldErrors.newPassword =
      'Password must be at least 8 characters long and include uppercase, lowercase, a number, and a special character.';
  }

  const rawConfirm = body.confirmPassword;
  if (rawConfirm !== undefined && rawConfirm !== null) {
    if (typeof rawConfirm !== 'string' || rawConfirm.length === 0) {
      fieldErrors.confirmPassword = 'Please confirm your new password.';
    } else if (typeof rawPassword === 'string' && rawConfirm !== rawPassword) {
      fieldErrors.confirmPassword = 'Passwords do not match.';
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    res.status(400).json({
      error: 'Validation failed',
      errors: fieldErrors,
    });
    return;
  }

  req.body = {
    oobCode: (rawCode as string).trim(),
    newPassword: rawPassword as string,
    ...(typeof rawConfirm === 'string' ? { confirmPassword: rawConfirm } : {}),
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
    consentHandleAvatar: body.consentHandleAvatar === true,
  };

  next();
}

export interface OAuthLinkFieldErrors {
  idToken?: string;
  provider?: string;
}

/**
 * Express middleware validating payload for POST /api/auth/oauth/link (US-002 AC 4 / S1-P2-04).
 * Enforces presence of non-empty provider idToken and valid provider name ('google' or 'github').
 */
export function validateOAuthLinkPayload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({
      error: 'Validation failed',
      errors: {
        idToken: 'Firebase ID token is required.',
        provider: 'Provider is required.',
      },
    });
    return;
  }

  const fieldErrors: OAuthLinkFieldErrors = {};

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
    consentHandleAvatar: body.consentHandleAvatar === true,
  };

  next();
}

export interface MfaVerifyFieldErrors {
  otp?: string;
  code?: string;
  challengeId?: string;
}

/**
 * Express middleware validating payload for POST /api/auth/mfa/verify (US-004 AC 2 / S1-P1-10–11 / S1-P3-04).
 * Enforces presence of 6-digit numeric OTP/code and normalizes challengeId.
 * Supports both { otp, challengeId? } and { code, challengeId } formats.
export interface MfaVerifyFieldErrors {
  otp?: string;
  challengeId?: string;
  code?: string;
}

/**
 * Express middleware validating payload for POST /api/auth/mfa/verify.
 * Supports both { otp, challengeId? } (S1-P3-04 integration tests & validator unit tests)
 * and { challengeId, code } (React frontend & S1-P1-11 route tests).
 */
export function validateMfaVerifyPayload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({
      error: 'Validation failed',
      errors: {
        otp: 'A 6-digit verification code is required.',
      },
    });
    return;
  }

  // 1. S1-P3-04 contract: explicit 'otp' key in request body
  if ('otp' in body) {
    const rawOtp = body.otp;
    if (typeof rawOtp !== 'string' || !/^\d{6}$/.test(rawOtp.trim())) {
      res.status(400).json({
        error: 'Validation failed',
        errors: {
          otp: 'A 6-digit verification code is required.',
        },
      });
      return;
    }

    const candidate = rawOtp.trim();
    const rawChallengeId = body.challengeId;
    const normalizedChallengeId =
      typeof rawChallengeId === 'string' && rawChallengeId.trim().length > 0
        ? rawChallengeId.trim()
        : undefined;

    req.body = {
      otp: candidate,
      ...(normalizedChallengeId ? { challengeId: normalizedChallengeId } : {}),
    };
    next();
    return;
  }

  // 2. S1-P1-10 / S1-P1-11 contract: { challengeId, code }
  const fieldErrors: MfaVerifyFieldErrors = {};

  const rawChallengeId = body.challengeId;
  if (typeof rawChallengeId !== 'string' || rawChallengeId.trim().length === 0) {
    fieldErrors.challengeId = 'Challenge id is required.';
  }

  const rawCode = body.code;
  const code =
    typeof rawCode === 'string'
      ? rawCode.trim()
      : typeof rawCode === 'number'
        ? String(rawCode)
        : '';
  if (!/^\d{6}$/.test(code)) {
    fieldErrors.code = 'Enter the 6-digit verification code.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    res.status(400).json({
      error: 'Validation failed',
      errors: fieldErrors,
    });
    return;
  }

  req.body = {
    challengeId: (rawChallengeId as string).trim(),
    code,
  };
  next();
}



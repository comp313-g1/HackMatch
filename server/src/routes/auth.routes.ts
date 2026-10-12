import { Router } from 'express';
import {
  validateRegisterPayload,
  validateResendVerificationPayload,
  validateVerifyEmailPayload,
} from '../validators/auth.validator.js';
import {
  register,
  resendVerification,
  verifyEmail,
} from '../controllers/auth.controller.js';

export const authRouter = Router();

/**
 * Public registration endpoint for participant accounts (US-001 / FR-001).
 * Validates full name, email format, password complexity, and role boundaries,
 * then provisions Firebase Auth user and PostgreSQL participant record.
 */
authRouter.post('/register', validateRegisterPayload, register);

/**
 * Public endpoint to request a replacement email verification link (US-001 AC 3 / FR-081).
 * Enforces rate limiting and anti-enumeration protections.
 */
authRouter.post('/resend-verification', validateResendVerificationPayload, resendVerification);

/**
 * Public endpoint to verify email with an action code (US-001 AC 3 / FR-002).
 * Verifies code, updates participant status, and ensures zero session creation.
 */
authRouter.post('/verify-email', validateVerifyEmailPayload, verifyEmail);



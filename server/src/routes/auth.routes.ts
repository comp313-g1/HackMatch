import { Router } from 'express';
import {
  validateRegisterPayload,
  validateResendVerificationPayload,
  validateVerifyEmailPayload,
  validateOAuthSignInPayload,
  validateOAuthLinkPayload,
} from '../validators/auth.validator.js';
import {
  register,
  resendVerification,
  verifyEmail,
  oauthSignIn,
  oauthLink,
} from '../controllers/auth.controller.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';

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

/**
 * Public federated OAuth sign-in and registration endpoint (US-002 / FR-003 / FR-004).
 * Verifies Firebase ID token, resolves or provisions participant record,
 * enforces account linking security (US-002 AC 4), and routes into US-004 email OTP flow.
 * Strictly issues zero cookies or session tokens (FR-007 / US-002 AC 5).
 */
authRouter.post('/oauth/sign-in', validateOAuthSignInPayload, oauthSignIn);

/**
 * Authenticated provider linking endpoint (US-002 AC 4 / S1-P2-04 / FR-003).
 * Requires verified participant session and recent reauthentication.
 * Links external Google/GitHub OAuth identity to existing participant profile.
 */
authRouter.post(
  '/oauth/link',
  requireVerifiedParticipant,
  validateOAuthLinkPayload,
  oauthLink
);




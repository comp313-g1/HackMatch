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
  getCurrentUser,
  createSession,
  clearSession,
} from '../controllers/auth.controller.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireSessionCookie } from '../middleware/requireSessionCookie.js';
import { requireCsrf } from '../middleware/requireCsrf.js';

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

/**
 * Returns the signed-in user's identity after verifying the Firebase ID token,
 * including revocation and disabled-account checks (US-003 AC 4 / AC 5).
 */
authRouter.get('/me', requireFirebaseAuth, getCurrentUser);

/**
 * Cookie-based sessions (US-003 AC 4): exchange a recent, MFA-verified ID token for an
 * HttpOnly, Secure, SameSite=Strict session cookie with a fixed lifetime, inspect it,
 * or clear it. Clearing requires the CSRF token.
 */
authRouter.post('/session', requireFirebaseAuth, requireMfa, createSession);
authRouter.get('/session', requireSessionCookie, getCurrentUser);
authRouter.delete('/session', requireCsrf, clearSession);




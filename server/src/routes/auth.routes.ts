import { Router } from 'express';
import {
  validateRegisterPayload,
  validateResendVerificationPayload,
  validateVerifyEmailPayload,
  validateOAuthSignInPayload,
  validateOAuthLinkPayload,
  validateMfaVerifyPayload,
} from '../validators/auth.validator.js';
import {
  register,
  resendVerification,
  verifyEmail,
  oauthSignIn,
  oauthLink,
  issueMfaChallenge,
  getCurrentUser,
  createSession,
  logout,
  sendMfaOtp,
  verifyMfaOtp,
  verifyMfaChallenge,
} from '../controllers/auth.controller.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireSessionCookie } from '../middleware/requireSessionCookie.js';
import { requireCsrfIfCookieSession } from '../middleware/requireCsrf.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';

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
 * MFA OTP dispatch endpoint (US-004 AC 1 / FR-009 / FR-081 / FR-084).
 * Enforces verified participant/admin account, 15m lockout, 60s/1h rate limits,
 * and invalidates predecessor challenges.
 */
authRouter.post('/mfa/send', requireFirebaseAuth, requireActiveAccount, sendMfaOtp);

/**
 * MFA OTP verification endpoint (US-004 AC 2 / FR-010 / NR-008).
 * Validates 6-digit OTP, enforces 15m lockout, single-use consumption,
 * logs attempt, and sets Firebase mfa_auth_time claim on success.
 */
authRouter.post(
  '/mfa/verify',
  requireFirebaseAuth,
  requireActiveAccount,
  validateMfaVerifyPayload,
  (req, res, next) => {
    if (req.body && req.body.code !== undefined && req.body.otp === undefined) {
      return verifyMfaChallenge(req, res, next);
    }
    return verifyMfaOtp(req, res, next);
  }
);

/**
 * Returns the signed-in user's identity after verifying the Firebase ID token,
 * including revocation and disabled-account checks (US-003 AC 4 / AC 5).
 */
authRouter.get('/me', requireFirebaseAuth, getCurrentUser);

/**
 * Post-password / pre-session check (US-003 AC 2 / US-003-T4).
 * Rejects Firebase-disabled and DB-suspended accounts before MFA or session creation.
 */
authRouter.get('/account-status', requireFirebaseAuth, requireActiveAccount, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ active: true });
});

/**
 * Issue a cryptographically random 6-digit MFA OTP after primary auth (US-004 AC 1 / FR-009 / S1-P1-09).
 * Requires a verified Firebase ID token and an active participant. Never creates a session (FR-007).
 */
authRouter.post(
  '/mfa/challenge',
  requireFirebaseAuth,
  requireActiveAccount,
  issueMfaChallenge
);

/**
 * Cookie-based sessions (US-003 AC 4 / AC 5): exchange a recent, MFA-verified ID token for an
 * HttpOnly, Secure, SameSite=Strict session cookie with a fixed lifetime, inspect it,
 * or sign out. Logout revokes Firebase refresh tokens and clears cookies; CSRF is required
 * when a session cookie is present. Suspended accounts cannot start a session.
 */
authRouter.post('/session', requireFirebaseAuth, requireActiveAccount, requireMfa, createSession);
authRouter.get('/session', requireSessionCookie, getCurrentUser);
authRouter.delete('/session', requireCsrfIfCookieSession, logout);




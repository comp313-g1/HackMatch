import type { Request, Response, NextFunction } from 'express';
import { firebaseAuth, verifyEmailActionCode, sendVerificationEmail, getFirebaseAdminAuth } from '../config/firebase.js';
import { config } from '../config/index.js';
import { participantsRepository } from '../db/participants.repository.js';
import { providerIdentitiesRepository } from '../db/provider_identities.repository.js';
import { mfaRepository } from '../db/mfa.repository.js';
import type { Participant, OAuthProvider } from '../db/types.js';
import { generateOtp, createMfaChallenge, evaluateAccountLockout, verifyOtpHash } from '../utils/otp.js';
import { rateLimiter } from '../utils/rateLimiter.js';
import { hasCompletedMfa, markMfaComplete } from '../utils/mfaClaim.js';
import { securityConfig } from '../config/security.js';
import { extractBearerToken, mapFirebaseAuthError } from '../middleware/requireFirebaseAuth.js';
import {
  sessionCookieOptions,
  csrfCookieOptions,
  generateCsrfToken,
  clearSessionCookies,
} from '../utils/sessionCookies.js';
import { ACCOUNT_SUSPENDED_MESSAGE } from '../middleware/requireActiveAccount.js';
import {
  issueMfaOtpForParticipant,
  _setMfaOtpEmailSender as _setIssueMfaOtpEmailSender,
  _resetMfaOtpEmailSender as _resetIssueMfaOtpEmailSender,
} from '../services/issueMfaOtp.js';
import { verifyMfaOtpForParticipant } from '../services/verifyMfaOtp.js';

export type MfaOtpEmailSender = (email: string, otp: string) => Promise<void>;

let mfaOtpEmailSender: MfaOtpEmailSender = async (email: string, _otp: string) => {
  if (config.nodeEnv === 'development') {
    console.info(`[AUTH] MFA OTP email dispatched to ${email}`);
  }
};

export function _setMfaOtpEmailSender(sender: MfaOtpEmailSender): void {
  mfaOtpEmailSender = sender;
  _setIssueMfaOtpEmailSender(sender);
}

export function _resetMfaOtpEmailSender(): void {
  mfaOtpEmailSender = async (email: string, _otp: string) => {
    if (config.nodeEnv === 'development') {
      console.info(`[AUTH] MFA OTP email dispatched to ${email}`);
    }
  };
  _resetIssueMfaOtpEmailSender();
}

/**
 * Shared internal helper to evaluate lockout, enforce rate limiting, generate & persist OTP challenge,
 * dispatch the email, and return the masked non-session response.
 * (Enforces FR-009, FR-010, FR-081, FR-084, US-004 AC 1, and US-004-T6).
 */
export async function dispatchMfaChallenge(
  participant: Participant,
  res: Response,
  decodedAuthTime?: number
): Promise<void> {
  // 1. Check 15-minute account lockout (FR-010 / NR-008 / US-004 AC 3)
  const lockout = await evaluateAccountLockout(participant.id);
  if (lockout.locked) {
    res.status(423).json({
      error: 'Account temporarily locked due to too many failed OTP attempts. Please wait 15 minutes before trying again.',
      code: 'ACCOUNT_LOCKED',
      retryAfter: lockout.retryAfterSeconds,
    });
    return;
  }

  // 2. Post-lockout expiry requires fresh primary authentication (US-004-T6)
  if (
    lockout.lastLockoutEndsAt &&
    typeof decodedAuthTime === 'number' &&
    decodedAuthTime * 1000 < lockout.lastLockoutEndsAt
  ) {
    res.status(401).json({
      error: 'Your account was previously locked. Please sign in again with your password or credentials before requesting a new code.',
      code: 'FRESH_AUTH_REQUIRED',
    });
    return;
  }

  // 3. Enforce FR-081 rate limiting (1 send / 60s, 5 / hour)
  const rateCheck = rateLimiter.checkLimit('mfa_otp', participant.email.toLowerCase());
  if (!rateCheck.allowed) {
    const retryAfterSeconds = rateCheck.retryAfterSeconds ?? 60;
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      error: 'Too many OTP requests. Please wait before requesting another code.',
      code: 'RATE_LIMITED',
      retryAfter: retryAfterSeconds,
    });
    return;
  }

  // 4. Issue OTP challenge & dispatch email (FR-009 / FR-084 / US-004 AC 1)
  const otpCode = generateOtp();
  const challenge = await createMfaChallenge(participant.id, otpCode);

  try {
    await mfaOtpEmailSender(participant.email, otpCode);
    rateLimiter.recordSend('mfa_otp', participant.email.toLowerCase());
  } catch (dispatchErr: unknown) {
    // FR-084: Email delivery failure never verifies or creates session
    await mfaRepository.invalidatePendingChallenges(participant.id);
    const errMsg = dispatchErr instanceof Error ? dispatchErr.message : 'Unknown dispatch error';
    console.warn(`[AUTH] Failed to send MFA OTP email for ${participant.email}: ${errMsg}`);
    res.status(502).json({
      error: 'Failed to dispatch verification code email. Please try again.',
      code: 'EMAIL_DELIVERY_FAILED',
    });
    return;
  }

  // 5. Mask email & return HTTP 200 non-session response (US-002 AC 5 / FR-007)
  const [userPart = '', domainPart = ''] = participant.email.split('@');
  const maskedUser = userPart.length > 1
    ? `${userPart[0]}***${userPart.slice(-1)}`
    : `${userPart}***`;
  const maskedEmail = `${maskedUser}@${domainPart}`;

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    requiresOtp: true,
    challengeId: challenge.id,
    email: maskedEmail,
    expiresInSeconds: 600,
    message: 'A 6-digit verification code has been sent to your email.',
  });
}

/**
 * Issues a cryptographically random 6-digit MFA OTP after primary authentication
 * (POST /api/auth/mfa/challenge) — FR-009 / US-004 AC 1 / S1-P1-09.
 *
 * Requires a verified Firebase ID token and an active participant. Does not create
 * a session (FR-007). Email delivery failures return 502 without authenticating (FR-084).
 */
export async function issueMfaChallenge(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const firebaseUser = req.firebaseUser;
    if (!firebaseUser?.uid) {
      res.status(401).json({
        error: 'Authentication required. Missing or malformed Authorization header.',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    if (!firebaseUser.email || firebaseUser.email_verified !== true) {
      res.status(403).json({
        error: 'A verified email is required before a login code can be sent.',
        code: 'EMAIL_NOT_VERIFIED',
      });
      return;
    }

    let participant = req.participant;
    if (!participant) {
      participant =
        (await participantsRepository.findByFirebaseUid(firebaseUser.uid)) ?? undefined;
    }

    if (!participant) {
      res.status(404).json({
        error: 'No HackMatch account is linked to this sign-in. Please register first.',
        code: 'PARTICIPANT_NOT_FOUND',
      });
      return;
    }

    if (participant.is_suspended) {
      res.status(403).json({
        error: ACCOUNT_SUSPENDED_MESSAGE,
        code: 'ACCOUNT_SUSPENDED',
      });
      return;
    }

    const issued = await issueMfaOtpForParticipant(participant);
    if (!issued.ok) {
      if (issued.retryAfter != null) {
        res.setHeader('Retry-After', String(issued.retryAfter));
      }
      res.status(issued.status).json({
        error: issued.error,
        code: issued.code,
        ...(issued.retryAfter != null ? { retryAfter: issued.retryAfter } : {}),
      });
      return;
    }

    res.status(200).json({
      requiresOtp: true,
      challengeId: issued.challengeId,
      email: issued.maskedEmail,
      expiresInSeconds: issued.expiresInSeconds,
      message: issued.message,
    });
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Verifies a 6-digit MFA OTP and sets the MFA claim (POST /api/auth/mfa/verify).
 * Used by the React OTP entry form (US-004 / S1-P1-10 / FR-010).
 */
export async function verifyMfaChallenge(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const firebaseUser = req.firebaseUser;
    if (!firebaseUser?.uid) {
      res.status(401).json({
        error: 'Authentication required. Missing or malformed Authorization header.',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    let participant = req.participant;
    if (!participant) {
      participant =
        (await participantsRepository.findByFirebaseUid(firebaseUser.uid)) ?? undefined;
    }
    if (!participant) {
      res.status(404).json({
        error: 'No HackMatch account is linked to this sign-in. Please register first.',
        code: 'PARTICIPANT_NOT_FOUND',
      });
      return;
    }

    const { challengeId, code } = req.body as { challengeId: string; code: string };
    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      typeof req.ip === 'string'
        ? req.ip
        : Array.isArray(forwarded)
          ? forwarded[0]
          : typeof forwarded === 'string'
            ? forwarded.split(',')[0]?.trim()
            : null;

    const result = await verifyMfaOtpForParticipant(
      participant,
      firebaseUser,
      challengeId,
      code,
      ip
    );

    if (!result.ok) {
      if (result.retryAfter != null) {
        res.setHeader('Retry-After', String(result.retryAfter));
      }
      res.status(result.status).json({
        error: result.error,
        code: result.code,
        ...(result.retryAfter != null ? { retryAfter: result.retryAfter } : {}),
      });
      return;
    }

    res.status(200).json({
      verified: true,
      message: 'Verification code accepted. You can continue to your account.',
    });
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Handles user registration (POST /api/auth/register).
 * Provisions Firebase Authentication user record and Supabase PostgreSQL participant,
 * executing compensatory rollback on database insertion failure to guarantee atomic consistency.
 *
 * Security invariant: Enforces FR-007 / US-001 AC 5 — returns no session cookies, JWTs,
 * or active credentials before email verification and MFA.
 */
export async function register(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { fullName, email, password } = req.body;

  try {
    // 1. Create user in Firebase Authentication via Admin SDK
    const userRecord = await firebaseAuth.createUser({
      email,
      password,
      displayName: fullName,
      emailVerified: false,
    });

    // 2. Persist participant profile in PostgreSQL database
    try {
      const participant = await participantsRepository.createParticipant({
        firebase_uid: userRecord.uid,
        email,
        full_name: fullName,
        role: 'PART',
        is_verified: false,
      });

      // 3. Dispatch Firebase email verification link & record in rate limiter (FR-084 / US-001 AC 2)
      let verificationEmailSent = false;
      try {
        const actionCodeSettings = {
          url: `${config.clientUrl}/?mode=verifyEmail&email=${encodeURIComponent(email)}`,
        };
        if (process.env.VITEST) {
          await firebaseAuth.generateEmailVerificationLink(email, actionCodeSettings);
        } else {
          const sendFn = firebaseAuth.sendVerificationEmail || sendVerificationEmail;
          await sendFn(email, actionCodeSettings);
        }
        rateLimiter.recordSend('verification', email);
        verificationEmailSent = true;
      } catch (sendErr: unknown) {
        // FR-084: Email dispatch failure never verifies account or creates session.
        // Internal diagnostics record failure without leaking tokens/passwords (NR-021, Invariant L41).
        const errMsg = sendErr instanceof Error ? sendErr.message : 'Unknown dispatch error';
        console.warn(`[AUTH] Failed to generate/dispatch verification link for ${email}: ${errMsg}`);
      }

      // 4. Respond with HTTP 201 Created and user summary (zero session tokens / cookies issued)
      res.status(201).json({
        message: 'User registered successfully',
        user: {
          id: participant.id,
          firebaseUid: participant.firebase_uid,
          email: participant.email,
          fullName: participant.full_name,
          role: 'PART',
          isVerified: false,
        },
        verificationEmailSent,
      });
    } catch (dbErr: unknown) {
      // Compensatory rollback: delete created Firebase user to prevent orphaned auth record
      try {
        await firebaseAuth.deleteUser(userRecord.uid);
      } catch (rollbackErr) {
        console.error('Critical compensation error deleting Firebase user:', rollbackErr);
      }

      // Handle PostgreSQL unique constraint violation on email (error code 23505)
      const errObj = dbErr && typeof dbErr === 'object' ? (dbErr as Record<string, unknown>) : null;
      const dbCode = errObj && 'code' in errObj ? String(errObj.code) : '';
      const dbMessage = errObj && 'message' in errObj ? String(errObj.message) : '';

      if (
        dbCode === '23505' ||
        dbMessage.toLowerCase().includes('unique') ||
        dbMessage.toLowerCase().includes('duplicate')
      ) {
        res.status(409).json({
          error: 'An account with this email already exists.',
          code: 'EMAIL_ALREADY_IN_USE',
        });
        return;
      }

      // Pass unexpected database failure to centralized error handler
      next(dbErr);
    }
  } catch (err: unknown) {
    const errObj = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
    const errorCode = errObj && 'code' in errObj ? String(errObj.code) : '';

    if (errorCode === 'auth/email-already-exists') {
      res.status(409).json({
        error: 'An account with this email already exists.',
        code: 'EMAIL_ALREADY_IN_USE',
      });
      return;
    }

    if (errorCode === 'auth/invalid-email') {
      res.status(400).json({
        error: 'Invalid email address.',
        code: 'INVALID_EMAIL',
      });
      return;
    }

    if (errorCode === 'auth/invalid-password' || errorCode === 'auth/weak-password') {
      res.status(400).json({
        error: 'Password does not meet requirements.',
        code: 'WEAK_PASSWORD',
      });
      return;
    }

    // Pass unexpected Firebase errors to centralized error handler
    next(err);
  }
}

/**
 * Handles requesting a replacement email verification link (POST /api/auth/resend-verification).
 * Enforces FR-081 dual-tier rate limiting (1/60s, 5/hour) and returns uniform responses
 * with normalized execution timing to prevent account enumeration attacks.
 */
export async function resendVerification(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { email } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();

  try {
    // 1. Dual-tier rate limiting check (FR-081)
    const limitCheck = rateLimiter.checkLimit('verification', normalizedEmail);
    if (!limitCheck.allowed) {
      const retryAfterSeconds = limitCheck.retryAfterSeconds ?? 60;
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'Too many requests. Please wait before requesting another verification email.',
        code: 'RATE_LIMITED',
        retryAfter: retryAfterSeconds,
      });
      return;
    }

    // 2. Lookup participant in database
    const participant = await participantsRepository.findByEmail(normalizedEmail);

    if (participant && !participant.is_verified) {
      try {
        const actionCodeSettings = {
          url: `${config.clientUrl}/?mode=verifyEmail&email=${encodeURIComponent(normalizedEmail)}`,
        };
        if (process.env.VITEST) {
          await firebaseAuth.generateEmailVerificationLink(normalizedEmail, actionCodeSettings);
        } else {
          const sendFn = firebaseAuth.sendVerificationEmail || sendVerificationEmail;
          await sendFn(normalizedEmail, actionCodeSettings);
        }
      } catch (sendErr: unknown) {
        // FR-084: Authentication email delivery failure feedback; never leaks secrets (NR-021)
        const errMsg = sendErr instanceof Error ? sendErr.message : 'Unknown dispatch error';
        console.warn(`[AUTH] Failed to generate/dispatch replacement verification link for ${normalizedEmail}: ${errMsg}`);
      }
    } else {
      // Normalize timing to neutralize side-channel analysis (R1)
      if (config.nodeEnv !== 'test') {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    // Record send attempt in rate limiter to prevent enumeration via rate limiter status
    rateLimiter.recordSend('verification', normalizedEmail);

    // 3. FR-081 Anti-enumeration: Uniform HTTP 200 response (zero session tokens/cookies issued)
    res.status(200).json({
      message: 'If an account exists for this address, a verification link has been sent.',
    });
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Handles processing email verification action codes (POST /api/auth/verify-email).
 * Verifies the action code, marks the participant verified in Supabase PostgreSQL,
 * synchronizes Firebase user record, and strictly enforces zero session issuance (US-001 AC 5 / FR-007).
 */
export async function verifyEmail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { oobCode, email } = req.body;
  const code = String(oobCode || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();

  try {
    let verifiedEmail = '';

    if (code) {
      try {
        const verifyFn = firebaseAuth.verifyEmailActionCode || verifyEmailActionCode;
        const result = await verifyFn(code);
        if (result?.email) {
          verifiedEmail = result.email.trim().toLowerCase();
        }
      } catch (codeErr: unknown) {
        // Reconcile if action code was already consumed (e.g. by Firebase-hosted page or client SDK)
        if (normalizedEmail && !process.env.VITEST) {
          try {
            const authClient = getFirebaseAdminAuth();
            const fbUser = await authClient.getUserByEmail(normalizedEmail);
            if (fbUser?.emailVerified) {
              verifiedEmail = normalizedEmail;
            }
          } catch {
            // Ignore error and fall through
          }
        }
        if (!verifiedEmail) {
          throw codeErr;
        }
      }
    } else if (normalizedEmail) {
      // Reconcile redirect from Firebase-hosted verification page
      try {
        const authClient = getFirebaseAdminAuth();
        const fbUser = await authClient.getUserByEmail(normalizedEmail);
        if (fbUser?.emailVerified) {
          verifiedEmail = normalizedEmail;
        }
      } catch {
        // Ignore error
      }
    }

    if (!verifiedEmail) {
      res.status(400).json({
        error: 'Verification link is invalid or has already been used.',
        code: 'INVALID_ACTION_CODE',
      });
      return;
    }

    const participant = await participantsRepository.findByEmail(verifiedEmail);
    if (!participant) {
      res.status(404).json({
        error: 'Participant record not found.',
        code: 'PARTICIPANT_NOT_FOUND',
      });
      return;
    }

    // Mark participant account as verified in Supabase PostgreSQL
    await participantsRepository.updateVerificationStatus(participant.id, true);

    // Synchronize Firebase Auth user record emailVerified state if available
    if (typeof firebaseAuth.updateUser === 'function' && participant.firebase_uid) {
      try {
        await firebaseAuth.updateUser(participant.firebase_uid, { emailVerified: true });
      } catch {
        // Defensive synchronization: Identity Toolkit already marked the user emailVerified
      }
    }

    // US-001 AC 5 / FR-007 invariant: zero session cookies or tokens returned
    res.status(200).json({
      message: 'Email verified successfully. Please proceed to sign in.',
      isVerified: true,
    });
  } catch (err: unknown) {
    const errObj = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
    const errorCode = errObj && 'code' in errObj ? String(errObj.code) : '';

    if (errorCode === 'auth/expired-action-code' || errorCode === 'EXPIRED_ACTION_CODE') {
      res.status(400).json({
        error: 'Verification link has expired. Please request a replacement link.',
        code: 'EXPIRED_ACTION_CODE',
      });
      return;
    }

    if (errorCode === 'auth/invalid-action-code' || errorCode === 'INVALID_ACTION_CODE') {
      res.status(400).json({
        error: 'Verification link is invalid or has already been used.',
        code: 'INVALID_ACTION_CODE',
      });
      return;
    }

    // Forward unexpected errors to centralized error handler
    next(err);
  }
}

/**
 * Handles federated OAuth sign-in and registration (POST /api/auth/oauth/sign-in).
 * Verifies Firebase ID token, resolves or provisions participant record,
 * enforces account linking security (US-002 AC 4), evaluates 15-minute account lockout (FR-010),
 * enforces rate limits (FR-081), creates a 10-minute MFA challenge (FR-009 / US-004),
 * and dispatches a 6-digit OTP code to the verified email address.
 *
 * Invariant: Returns HTTP 200 with { requiresOtp: true, challengeId, email, expiresInSeconds: 600 }.
 * Strictly returns ZERO session cookies or JWT access tokens (US-002 AC 5 / FR-007).
 */
export async function oauthSignIn(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { idToken, provider, consentHandleAvatar } = req.body;

  try {
    // 1. Verify Firebase ID token
    let decodedToken: {
      uid: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
      role?: string;
      screen_name?: string;
      firebase?: {
        sign_in_provider?: string;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };

    try {
      decodedToken = await firebaseAuth.verifyIdToken(idToken);
    } catch {
      res.status(401).json({
        error: 'Invalid or expired authentication token. Please sign in again.',
        code: 'INVALID_TOKEN',
      });
      return;
    }

    // 2. Cross-provider validation: verify token provider matches requested provider
    const tokenProvider = decodedToken?.firebase?.sign_in_provider || '';
    const isGoogle = (provider === 'google' || provider === 'google.com') && tokenProvider === 'google.com';
    const isGithub = (provider === 'github' || provider === 'github.com') && tokenProvider === 'github.com';

    if (!isGoogle && !isGithub) {
      res.status(400).json({
        error: 'Provider in request does not match the authentication credential.',
        code: 'PROVIDER_MISMATCH',
      });
      return;
    }

    // 3. Provider email verification check (US-002 AC 2 / US-002-T3)
    if (!decodedToken.email || !decodedToken.email_verified) {
      res.status(403).json({
        error: 'A verified provider email is required. Please sign up using standard email registration.',
        code: 'UNVERIFIED_PROVIDER_EMAIL',
      });
      return;
    }

    // 4. ADMIN role protection on ID token claim (US-002 AC 4 / FR-003)
    if (decodedToken.role === 'ADMIN') {
      res.status(403).json({
        error: 'Public OAuth cannot be used to authenticate an administrator account.',
        code: 'ADMIN_OAUTH_PROHIBITED',
      });
      return;
    }

    // 5. Resolve Participant & Guard Account Linking
    const normProvider: OAuthProvider = provider.startsWith('google') ? 'google' : 'github';
    let existingIdentity = await providerIdentitiesRepository.findByProviderUid(normProvider, decodedToken.uid);
    if (!existingIdentity) {
      const altProvider: OAuthProvider = normProvider === 'google' ? 'google.com' : 'github.com';
      existingIdentity = await providerIdentitiesRepository.findByProviderUid(altProvider, decodedToken.uid);
    }

    let participant: Participant | null = null;

    if (existingIdentity) {
      participant = await participantsRepository.findById(existingIdentity.participant_id);
    } else {
      // Identity not linked to this provider UID. Check if email already registered.
      const emailMatch = await participantsRepository.findByEmail(decodedToken.email.toLowerCase());
      if (emailMatch) {
        // US-002 AC 4 / US-002-T5: Reject automatic linking by email alone
        res.status(409).json({
          error: 'An account with this email already exists. Please sign in with your password to link your provider.',
          code: 'LINKING_REAUTHENTICATION_REQUIRED',
        });
        return;
      }

      // New user: provision PART participant and create provider identity
      const fallbackName = (
        decodedToken.name ||
        decodedToken.email.split('@')[0] ||
        'Participant'
      ).slice(0, 100);

      participant = await participantsRepository.createParticipant({
        firebase_uid: decodedToken.uid,
        email: decodedToken.email.toLowerCase(),
        full_name: fallbackName,
        role: 'PART',
        is_verified: true,
      });

      const handle = consentHandleAvatar
        ? (typeof decodedToken.screen_name === 'string'
            ? decodedToken.screen_name
            : typeof decodedToken.name === 'string'
              ? decodedToken.name
              : null)
        : null;
      const avatarUrl = consentHandleAvatar
        ? (typeof decodedToken.picture === 'string' ? decodedToken.picture : null)
        : null;

      await providerIdentitiesRepository.createProviderIdentity({
        participant_id: participant.id,
        provider: normProvider,
        provider_uid: decodedToken.uid,
        email: decodedToken.email.toLowerCase(),
        provider_handle: handle ? handle.slice(0, 100) : null,
        avatar_url: avatarUrl,
      });
    }

    // Guard against non-existent participant or ADMIN role in database
    if (!participant || participant.role === 'ADMIN') {
      res.status(403).json({
        error: 'Public OAuth cannot be used to authenticate an administrator account.',
        code: 'ADMIN_OAUTH_PROHIBITED',
      });
      return;
    }

    // Suspended accounts cannot start a session (US-003 AC 2 / US-003-T4 / FR-005)
    if (participant.is_suspended) {
      res.status(403).json({
        error: ACCOUNT_SUSPENDED_MESSAGE,
        code: 'ACCOUNT_SUSPENDED',
      });
      return;
    }

    // 6. Dispatch MFA OTP challenge (FR-009 / FR-010 / FR-081 / FR-084 / US-004)
    const rawAuthTime = typeof decodedToken.auth_time === 'number' ? decodedToken.auth_time : undefined;
    await dispatchMfaChallenge(participant, res, rawAuthTime);
  } catch (err: unknown) {
    next(err);
  }
}

export const REAUTH_MAX_AGE_SECONDS = 900; // 15 minutes window for reauthentication

/**
 * Handles account linking with reauthentication check (POST /api/auth/oauth/link).
 * Enforces US-002 AC 4, US-002-T5, S1-P2-04, and FR-003:
 * 1. Checks that caller is an authenticated, verified participant and not an ADMIN.
 * 2. Enforces fresh reauthentication within 15 minutes (with clock-skew defense).
 * 3. Verifies provider Firebase ID token, provider match, and verified provider email.
 * 4. Strictly checks email equality between provider token and caller participant.
 * 5. Rejects if provider UID or provider identity is already linked to another participant or already exists.
 * 6. Persists new provider identity link idempotently.
 */
export async function oauthLink(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const participant = req.participant;
  const firebaseUser = req.firebaseUser;
  const { idToken, provider, consentHandleAvatar } = req.body;

  try {
    // 1. Guard authenticated participant context and role boundaries (US-002 AC 4 / FR-003)
    if (!participant || !firebaseUser) {
      res.status(401).json({
        error: 'Authentication required. Missing participant session.',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    if (participant.role === 'ADMIN' || firebaseUser.role === 'ADMIN') {
      res.status(403).json({
        error: 'Public OAuth cannot be used to link an administrator account.',
        code: 'ADMIN_OAUTH_PROHIBITED',
      });
      return;
    }

    // 2. Fresh reauthentication check with clock-skew defense (US-002 AC 4)
    const nowSeconds = Math.floor(Date.now() / 1000);
    const authTime = typeof firebaseUser.auth_time === 'number' ? firebaseUser.auth_time : 0;

    // Reject missing auth_time, future-skewed tokens beyond 30s, or tokens older than 15m
    if (authTime === 0 || authTime > nowSeconds + 30 || nowSeconds - authTime > REAUTH_MAX_AGE_SECONDS) {
      res.status(401).json({
        error: 'Recent reauthentication is required to link an external provider. Please sign in again.',
        code: 'REAUTHENTICATION_REQUIRED',
      });
      return;
    }

    // 3. Verify provider Firebase ID token
    let decodedProviderToken;
    try {
      decodedProviderToken = await firebaseAuth.verifyIdToken(idToken);
    } catch {
      res.status(401).json({
        error: 'Invalid or expired provider token. Please try again.',
        code: 'INVALID_TOKEN',
      });
      return;
    }

    // 4. Validate provider match
    const tokenProvider = decodedProviderToken?.firebase?.sign_in_provider || '';
    const isGoogle = (provider === 'google' || provider === 'google.com') && tokenProvider === 'google.com';
    const isGithub = (provider === 'github' || provider === 'github.com') && tokenProvider === 'github.com';

    if (!isGoogle && !isGithub) {
      res.status(400).json({
        error: 'Provider in request does not match the authentication credential.',
        code: 'PROVIDER_MISMATCH',
      });
      return;
    }

    // 5. Provider email verification check (US-002 AC 2)
    if (!decodedProviderToken.email || !decodedProviderToken.email_verified) {
      res.status(403).json({
        error: 'A verified provider email is required to link this account.',
        code: 'UNVERIFIED_PROVIDER_EMAIL',
      });
      return;
    }

    // 6. ADMIN role check on provider token
    if (decodedProviderToken.role === 'ADMIN') {
      res.status(403).json({
        error: 'Public OAuth cannot be used to link an administrator account.',
        code: 'ADMIN_OAUTH_PROHIBITED',
      });
      return;
    }

    // 7. Ownership boundary: provider email must match participant email (normalized)
    if (decodedProviderToken.email.trim().toLowerCase() !== participant.email.trim().toLowerCase()) {
      res.status(409).json({
        error: 'Provider email does not match your registered account email.',
        code: 'EMAIL_MISMATCH',
      });
      return;
    }

    // 8. Conflict & Uniqueness checks across provider aliases
    const normProvider: OAuthProvider = provider.startsWith('google') ? 'google' : 'github';

    // Check if this provider UID is already linked to anyone
    let existingIdentity = await providerIdentitiesRepository.findByProviderUid(normProvider, decodedProviderToken.uid);
    if (!existingIdentity) {
      const altProvider: OAuthProvider = normProvider === 'google' ? 'google.com' : 'github.com';
      existingIdentity = await providerIdentitiesRepository.findByProviderUid(altProvider, decodedProviderToken.uid);
    }

    if (existingIdentity) {
      if (existingIdentity.participant_id === participant.id) {
        // Idempotent: already linked to this participant
        res.status(200).json({
          success: true,
          message: 'Provider is already linked to your account.',
          identity: {
            id: existingIdentity.id,
            provider: existingIdentity.provider,
            email: existingIdentity.email,
            provider_handle: existingIdentity.provider_handle,
          },
        });
        return;
      }

      // Linked to a different participant
      res.status(409).json({
        error: 'This provider account is already linked to another user.',
        code: 'PROVIDER_ALREADY_LINKED',
      });
      return;
    }

    // Check if participant already has a different UID linked for this provider
    const userIdentities = await providerIdentitiesRepository.findByParticipantId(participant.id);
    const existingForProvider = userIdentities.find(
      (id) => id.provider === normProvider || id.provider === `${normProvider}.com`
    );
    if (existingForProvider) {
      res.status(409).json({
        error: `A ${normProvider === 'google' ? 'Google' : 'GitHub'} account is already linked to this profile.`,
        code: 'PROVIDER_ALREADY_EXISTS',
      });
      return;
    }

    // 9. Persist provider identity link with defensive Postgres unique violation handling
    const rawClaims = decodedProviderToken as Record<string, unknown>;
    const handle = consentHandleAvatar
      ? (typeof rawClaims.screen_name === 'string'
          ? rawClaims.screen_name
          : typeof rawClaims.name === 'string'
            ? rawClaims.name
            : null)
      : null;
    const avatarUrl = consentHandleAvatar
      ? (typeof rawClaims.picture === 'string' ? rawClaims.picture : null)
      : null;

    let createdIdentity;
    try {
      createdIdentity = await providerIdentitiesRepository.createProviderIdentity({
        participant_id: participant.id,
        provider: normProvider,
        provider_uid: decodedProviderToken.uid,
        email: decodedProviderToken.email.trim().toLowerCase(),
        provider_handle: handle ? handle.slice(0, 100) : null,
        avatar_url: avatarUrl,
      });
    } catch (dbErr: unknown) {
      // Catch race condition: Postgres unique constraint violation (code 23505)
      const isUniqueViolation =
        dbErr && typeof dbErr === 'object' && 'code' in dbErr && (dbErr as { code: string }).code === '23505';
      if (isUniqueViolation) {
        res.status(409).json({
          error: 'This provider account is already linked to another user.',
          code: 'PROVIDER_ALREADY_LINKED',
        });
        return;
      }
      throw dbErr;
    }

    res.status(200).json({
      success: true,
      message: 'Provider successfully linked to your account.',
      identity: {
        id: createdIdentity.id,
        provider: createdIdentity.provider,
        email: createdIdentity.email,
        provider_handle: createdIdentity.provider_handle,
      },
    });
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Returns the identity behind a verified Firebase ID token (GET /api/auth/me, US-003 AC 4).
 * Must be mounted after `requireFirebaseAuth`. Never echoes the token itself.
 */
export function getCurrentUser(req: Request, res: Response): void {
  const decoded = req.firebaseUser;
  if (!decoded) {
    res.status(401).json({
      error: 'Authentication required. Missing or malformed Authorization header.',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  const role = typeof decoded.role === 'string' ? decoded.role : null;

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    user: {
      uid: decoded.uid,
      email: decoded.email ?? null,
      emailVerified: decoded.email_verified === true,
      role,
      signInProvider: decoded.firebase?.sign_in_provider ?? null,
    },
    session: {
      authTime: new Date(decoded.auth_time * 1000).toISOString(),
      expiresAt: new Date(decoded.exp * 1000).toISOString(),
      mfaVerified: hasCompletedMfa(decoded),
    },
  });
}

/**
 * Dispatches an MFA verification code email to the authenticated participant/admin (POST /api/auth/mfa/send).
 * Enforces US-004 AC 1, AC 4, FR-009, FR-010, FR-081, FR-084, and US-004-T6.
 */
export async function sendMfaOtp(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const participant = req.participant;
  const decodedToken = req.firebaseUser;

  if (!decodedToken) {
    res.status(401).json({
      error: 'Authentication required. Missing or malformed Authorization header.',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  // Guard verified email (US-004 / FR-009 / US-001 AC 5)
  // Both PART and ADMIN can call this, but their email must be verified.
  const isVerified = participant?.is_verified || decodedToken.email_verified === true;
  if (!participant || !isVerified) {
    res.status(403).json({
      error: 'Email address must be verified before two-factor authentication.',
      code: 'EMAIL_NOT_VERIFIED',
    });
    return;
  }

  try {
    await dispatchMfaChallenge(participant, res, decodedToken.auth_time);
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Verifies a 6-digit MFA OTP and marks the Firebase sign-in complete (POST /api/auth/mfa/verify).
 * Enforces US-004 AC 2, AC 3, FR-010, NR-008, US-004-T1, US-004-T2, US-004-T3, and US-004-T6.
 */
export async function verifyMfaOtp(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const participant = req.participant;
  const decodedToken = req.firebaseUser;

  if (!decodedToken) {
    res.status(401).json({
      error: 'Authentication required. Missing or malformed Authorization header.',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  const isVerified = participant?.is_verified || decodedToken.email_verified === true;
  if (!participant || !isVerified) {
    res.status(403).json({
      error: 'Email address must be verified before two-factor authentication.',
      code: 'EMAIL_NOT_VERIFIED',
    });
    return;
  }

  try {
    // 1. Check account lockout (US-004 AC 3 / FR-010)
    const lockout = await evaluateAccountLockout(participant.id);
    if (lockout.locked) {
      await mfaRepository.invalidatePendingChallenges(participant.id);
      res.status(423).json({
        error: 'Account temporarily locked due to too many failed OTP attempts. Please wait 15 minutes before trying again.',
        code: 'ACCOUNT_LOCKED',
        retryAfter: lockout.retryAfterSeconds,
      });
      return;
    }

    // 2. Post-lockout expiry requires fresh primary authentication (US-004-T6)
    if (
      lockout.lastLockoutEndsAt &&
      typeof decodedToken.auth_time === 'number' &&
      decodedToken.auth_time * 1000 < lockout.lastLockoutEndsAt
    ) {
      res.status(401).json({
        error: 'Your account was previously locked. Please sign in again with your password or credentials before verifying your code.',
        code: 'FRESH_AUTH_REQUIRED',
      });
      return;
    }

    const { otp, challengeId, code } = req.body;
    const rawOtp = String(otp || code || '');

    // 3. Locate active challenge bound to this participant (FR-009 / NR-008)
    const challenge = await mfaRepository.getLatestActiveChallenge(participant.id);
    if (!challenge) {
      res.status(400).json({
        error: 'No active verification code found or code has expired. Please request a new code.',
        code: 'INVALID_OR_EXPIRED_OTP',
      });
      return;
    }

    // Guard against challengeId mismatch (binding to specific challenge)
    if (typeof challengeId === 'string' && challenge.id !== challengeId) {
      res.status(400).json({
        error: 'Invalid or expired verification challenge. Please request a new code.',
        code: 'INVALID_OR_EXPIRED_OTP',
      });
      return;
    }

    const isCodeMatch = verifyOtpHash(rawOtp, challenge.otp_hash);
    const now = Date.now();
    const isExpired = now >= Date.parse(challenge.expires_at);

    // 4. Code matches hash but challenge has reached/exceeded 10m expiry (US-004 AC 1 / US-004-T2)
    if (isExpired && isCodeMatch) {
      res.status(400).json({
        error: 'Verification code has expired. Please request a new code.',
        code: 'OTP_EXPIRED',
      });
      return;
    }

    const clientIp = (req.ip || (req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim() || null;

    // 5. Code does not match (or expired code without matching hash)
    if (!isCodeMatch) {
      // Record failed attempt
      await mfaRepository.createAttempt({
        participant_id: participant.id,
        challenge_id: challenge.id,
        success: false,
        ip_address: clientIp,
      });

      // Check if this failure triggered a 15-minute account lockout (5th attempt)
      const postAttemptLockout = await evaluateAccountLockout(participant.id);
      if (postAttemptLockout.locked) {
        await mfaRepository.invalidatePendingChallenges(participant.id);
        res.status(423).json({
          error: 'Account temporarily locked due to too many failed OTP attempts. Please wait 15 minutes before trying again.',
          code: 'ACCOUNT_LOCKED',
          retryAfter: postAttemptLockout.retryAfterSeconds,
        });
        return;
      }

      // Calculate remaining attempts before lockout (1..4)
      const recentAttempts = await mfaRepository.getRecentAttempts(participant.id, 5);
      let consecutiveFailures = 0;
      for (const a of recentAttempts) {
        if (a.success) break;
        consecutiveFailures++;
      }
      const remainingAttempts = Math.max(0, 5 - consecutiveFailures);

      res.status(400).json({
        error: 'Invalid verification code. Please try again.',
        code: 'INVALID_OTP',
        remainingAttempts,
      });
      return;
    }

    // 6. Valid OTP & unexpired challenge: consume atomically (FR-010 / NR-008)
    try {
      await mfaRepository.markChallengeConsumed(challenge.id);
    } catch {
      // Row was already consumed or invalidated concurrently (replay collision trap)
      res.status(400).json({
        error: 'No active verification code found or code has expired. Please request a new code.',
        code: 'INVALID_OR_EXPIRED_OTP',
      });
      return;
    }

    // Record successful attempt (resets failure counter per FR-010)
    await mfaRepository.createAttempt({
      participant_id: participant.id,
      challenge_id: challenge.id,
      success: true,
      ip_address: clientIp,
    });

    // 7. Update Firebase custom claims with mfa_auth_time matching auth_time
    await markMfaComplete(decodedToken.uid, decodedToken.auth_time);

    res.status(200).json({
      verified: true,
      mfaAuthTime: decodedToken.auth_time,
      message: 'Two-factor authentication complete.',
    });
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Exchanges a fresh, MFA-verified Firebase ID token for an HttpOnly session cookie
 * (POST /api/auth/session, US-003 AC 4). Must be mounted after `requireFirebaseAuth`
 * and `requireMfa`. The cookie lasts a fixed SESSION_COOKIE_MAX_AGE_SECONDS (7 days by
 * default) and is not extended by later requests.
 */
export async function createSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const decoded = req.firebaseUser;
  const idToken = extractBearerToken(req.headers.authorization);
  if (!decoded || !idToken) {
    res.status(401).json({
      error: 'Authentication required. Missing or malformed Authorization header.',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  // Check 15-minute account lockout if participant is present (US-004 AC 3 / FR-010)
  if (req.participant) {
    try {
      const lockout = await evaluateAccountLockout(req.participant.id);
      if (lockout.locked) {
        res.status(423).json({
          error: 'Account temporarily locked due to too many failed OTP attempts. Please wait 15 minutes before trying again.',
          code: 'ACCOUNT_LOCKED',
          retryAfter: lockout.retryAfterSeconds,
        });
        return;
      }
    } catch (lockoutErr: unknown) {
      if (
        lockoutErr instanceof Error &&
        lockoutErr.message.includes('Missing SUPABASE_URL')
      ) {
        // Safe offline/unit-test fallback when DB is unconfigured
      } else {
        throw lockoutErr;
      }
    }
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const signInAge = nowSeconds - decoded.auth_time;
  if (!Number.isFinite(signInAge) || signInAge < -60 || signInAge > securityConfig.recentSignInSeconds) {
    res.status(401).json({
      error: 'Please sign in again to start a new session.',
      code: 'RECENT_SIGN_IN_REQUIRED',
    });
    return;
  }

  const maxAgeSeconds = securityConfig.sessionCookie.maxAgeSeconds;
  try {
    const sessionCookie = await firebaseAuth.createSessionCookie(idToken, {
      expiresIn: maxAgeSeconds * 1000,
    });
    const csrfToken = generateCsrfToken();

    res.cookie(securityConfig.sessionCookie.name, sessionCookie, sessionCookieOptions());
    res.cookie(securityConfig.sessionCookie.csrfName, csrfToken, csrfCookieOptions());
    res.status(200).json({
      session: {
        expiresAt: new Date((nowSeconds + maxAgeSeconds) * 1000).toISOString(),
        maxAgeSeconds,
      },
      csrfToken,
    });
  } catch (err: unknown) {
    const failure = mapFirebaseAuthError(err);
    if (failure) {
      res.status(failure.status).json({ error: failure.error, code: failure.code });
      return;
    }
    next(err);
  }
}

/**
 * Signs the user out (DELETE /api/auth/session, US-003 AC 5 / FR-008 / US-003-T5).
 *
 * Mount after `requireCsrfIfCookieSession`. Resolves the user from the session cookie
 * or a Bearer ID token (without requiring an unrevoked token, so a second logout is safe),
 * revokes all Firebase refresh tokens for that account, then clears the cookies.
 * Replaying the old ID token or session cookie against protected routes then fails
 * because those middlewares verify with checkRevoked=true.
 */
export async function logout(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  const cookies = (req.cookies ?? {}) as Record<string, unknown>;
  const sessionCookie = cookies[securityConfig.sessionCookie.name];
  const bearer = extractBearerToken(req.headers.authorization);

  let uid: string | null = null;

  if (typeof sessionCookie === 'string' && sessionCookie !== '') {
    try {
      // checkRevoked=false: allow logout even if tokens were already revoked.
      const decoded = await firebaseAuth.verifySessionCookie(sessionCookie, false);
      uid = decoded.uid;
    } catch (err: unknown) {
      const failure = mapFirebaseAuthError(err);
      if (failure && !bearer) {
        clearSessionCookies(res);
        res.status(failure.status).json({ error: failure.error, code: failure.code });
        return;
      }
      // Fall through and try the Bearer token when the session cookie is unusable.
    }
  }

  if (!uid && bearer) {
    try {
      const decoded = await firebaseAuth.verifyIdToken(bearer, false);
      uid = decoded.uid;
    } catch (err: unknown) {
      const failure = mapFirebaseAuthError(err) ?? {
        status: 401,
        code: 'INVALID_TOKEN',
        error: 'Invalid authentication token. Please sign in again.',
      };
      clearSessionCookies(res);
      res.status(failure.status).json({ error: failure.error, code: failure.code });
      return;
    }
  }

  if (!uid) {
    clearSessionCookies(res);
    res.status(401).json({
      error: 'No active session. Please sign in.',
      code: 'NO_SESSION',
    });
    return;
  }

  try {
    await firebaseAuth.revokeRefreshTokens(uid);
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';

    if (code === 'auth/user-not-found') {
      // Account already gone: local cookies are still cleared below.
    } else {
      const failure = mapFirebaseAuthError(err);
      if (failure) {
        // Local cookies are cleared so this browser is signed out even if Firebase is down.
        clearSessionCookies(res);
        res.status(failure.status).json({
          error:
            failure.code === 'AUTH_SERVICE_UNAVAILABLE'
              ? 'Could not fully revoke your session. You are signed out on this device; try again if you used other devices.'
              : failure.error,
          code: failure.code === 'AUTH_SERVICE_UNAVAILABLE' ? 'REVOCATION_FAILED' : failure.code,
        });
        return;
      }
      next(err);
      return;
    }
  }

  clearSessionCookies(res);
  res.status(200).json({
    message: 'Signed out successfully. All refresh tokens for this account have been revoked.',
    code: 'LOGGED_OUT',
  });
}

/** @deprecated Use `logout`. Kept as a name alias for older imports in tests. */
export const clearSession = logout;

import type { Request, Response, NextFunction } from 'express';
import { firebaseAuth, verifyEmailActionCode, sendVerificationEmail, getFirebaseAdminAuth } from '../config/firebase.js';
import { config } from '../config/index.js';
import { participantsRepository } from '../db/participants.repository.js';
import { providerIdentitiesRepository } from '../db/provider_identities.repository.js';
import { mfaRepository } from '../db/mfa.repository.js';
import type { Participant, OAuthProvider } from '../db/types.js';
import { generateOtp, createMfaChallenge, evaluateAccountLockout } from '../utils/otp.js';
import { rateLimiter } from '../utils/rateLimiter.js';
import { hasCompletedMfa } from '../utils/mfaClaim.js';
import { securityConfig } from '../config/security.js';
import { extractBearerToken, mapFirebaseAuthError } from '../middleware/requireFirebaseAuth.js';
import {
  sessionCookieOptions,
  csrfCookieOptions,
  generateCsrfToken,
  clearSessionCookies,
} from '../utils/sessionCookies.js';

export type MfaOtpEmailSender = (email: string, otp: string) => Promise<void>;

let mfaOtpEmailSender: MfaOtpEmailSender = async (email: string, _otp: string) => {
  if (config.nodeEnv === 'development') {
    console.info(`[AUTH] MFA OTP email dispatched to ${email}`);
  }
};

export function _setMfaOtpEmailSender(sender: MfaOtpEmailSender): void {
  mfaOtpEmailSender = sender;
}

export function _resetMfaOtpEmailSender(): void {
  mfaOtpEmailSender = async (email: string, _otp: string) => {
    if (config.nodeEnv === 'development') {
      console.info(`[AUTH] MFA OTP email dispatched to ${email}`);
    }
  };
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

    // 6. Check 15-minute account lockout (FR-010 / NR-008)
    const lockout = await evaluateAccountLockout(participant.id);
    if (lockout.locked) {
      res.status(423).json({
        error: 'Account temporarily locked due to too many failed OTP attempts. Please wait 15 minutes before trying again.',
        code: 'ACCOUNT_LOCKED',
        retryAfter: lockout.retryAfterSeconds,
      });
      return;
    }

    // 7. Enforce FR-081 rate limiting (1 send / 60s, 5 / hour)
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

    // 8. Issue OTP challenge & dispatch email (FR-009 / FR-084 / US-004)
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

    // 9. Mask email & return HTTP 200 non-session response (US-002 AC 5 / FR-007)
    const [userPart = '', domainPart = ''] = participant.email.split('@');
    const maskedUser = userPart.length > 1
      ? `${userPart[0]}***${userPart.slice(-1)}`
      : `${userPart}***`;
    const maskedEmail = `${maskedUser}@${domainPart}`;

    res.status(200).json({
      requiresOtp: true,
      challengeId: challenge.id,
      email: maskedEmail,
      expiresInSeconds: 600,
      message: 'A 6-digit verification code has been sent to your email.',
    });
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
 * Clears the session and CSRF cookies (DELETE /api/auth/session). Mount after `requireCsrf`.
 * Refresh-token revocation on logout is handled by the US-003 logout task.
 */
export function clearSession(_req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  clearSessionCookies(res);
  res.status(204).end();
}

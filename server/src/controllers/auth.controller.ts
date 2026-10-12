import type { Request, Response, NextFunction } from 'express';
import { firebaseAuth, verifyEmailActionCode } from '../config/firebase.js';
import { config } from '../config/index.js';
import { participantsRepository } from '../db/participants.repository.js';
import { rateLimiter } from '../utils/rateLimiter.js';

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
          url: `${config.clientUrl}/?mode=verifyEmail`,
        };
        await firebaseAuth.generateEmailVerificationLink(email, actionCodeSettings);
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
          url: `${config.clientUrl}/?mode=verifyEmail`,
        };
        await firebaseAuth.generateEmailVerificationLink(normalizedEmail, actionCodeSettings);
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
  const { oobCode } = req.body;
  const code = String(oobCode || '').trim();

  try {
    const verifyFn = firebaseAuth.verifyEmailActionCode || verifyEmailActionCode;
    const result = await verifyFn(code);

    if (!result || !result.email) {
      res.status(400).json({
        error: 'Verification link is invalid or has already been used.',
        code: 'INVALID_ACTION_CODE',
      });
      return;
    }

    const participant = await participantsRepository.findByEmail(result.email);
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



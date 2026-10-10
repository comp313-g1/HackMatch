import type { Request, Response, NextFunction } from 'express';
import { firebaseAuth } from '../config/firebase.js';
import { participantsRepository } from '../db/participants.repository.js';

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

      // 3. Respond with HTTP 201 Created and user summary (zero session tokens / cookies issued)
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

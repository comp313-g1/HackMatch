import type { RequestHandler } from 'express';
import { requireFirebaseAuth } from './requireFirebaseAuth.js';
import { requireMfa } from './requireMfa.js';
import { requireActiveAccount } from './requireActiveAccount.js';
import { requireAdminRole } from './requireRole.js';

/**
 * ADMIN-only guard for US-027 account-management routes (AC 1 & 5 / FR-082 / #248).
 *
 * Stack (in order):
 * 1. `requireFirebaseAuth` — Visitors / missing tokens → 401 UNAUTHORIZED
 * 2. `requireMfa` — signed-in without email OTP → 403 MFA_REQUIRED
 * 3. `requireActiveAccount` — suspended accounts → 403 ACCOUNT_SUSPENDED
 * 4. `requireAdminRole` — PART or forged/demoted ADMIN claims → 403
 */
export const requireAccountsAdmin: RequestHandler[] = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireAdminRole,
];

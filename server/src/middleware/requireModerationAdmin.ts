import type { RequestHandler } from 'express';
import { requireFirebaseAuth } from './requireFirebaseAuth.js';
import { requireMfa } from './requireMfa.js';
import { requireActiveAccount } from './requireActiveAccount.js';
import { requireAdminRole } from './requireRole.js';

/**
 * ADMIN-only guard for US-026 moderation routes (AC 5 / FR-082 / #240).
 *
 * Stack (in order):
 * 1. `requireFirebaseAuth` — Visitors / missing tokens → 401 UNAUTHORIZED
 * 2. `requireMfa` — signed-in without email OTP → 403 MFA_REQUIRED
 * 3. `requireActiveAccount` — suspended accounts → 403 ACCOUNT_SUSPENDED
 * 4. `requireAdminRole` — PART or forged/demoted ADMIN claims → 403 FORBIDDEN_ROLE /
 *    ROLE_MISMATCH / INVALID_ROLE_CLAIM
 *
 * Mount with `router.use(...requireModerationAdmin)` so every moderation path
 * (queue, target detail, create, and later decide actions) inherits the same RBAC.
 */
export const requireModerationAdmin: RequestHandler[] = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireAdminRole,
];

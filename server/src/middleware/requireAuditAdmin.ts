import type { RequestHandler } from 'express';
import { requireFirebaseAuth } from './requireFirebaseAuth.js';
import { requireMfa } from './requireMfa.js';
import { requireActiveAccount } from './requireActiveAccount.js';
import { requireAdminRole } from './requireRole.js';

/**
 * ADMIN-only guard for the US-028 audit-record routes (AC 3 / FR-080 / #258).
 *
 * 1. `requireFirebaseAuth` — Visitors / missing tokens → 401
 * 2. `requireMfa`          — email code step incomplete → 403 MFA_REQUIRED
 * 3. `requireActiveAccount`— suspended accounts → 403 ACCOUNT_SUSPENDED
 * 4. `requireAdminRole`    — PART or forged/demoted ADMIN claims → 403
 *
 * The database re-verifies the ADMIN role again inside query_admin_audit_records().
 */
export const requireAuditAdmin: RequestHandler[] = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireAdminRole,
];

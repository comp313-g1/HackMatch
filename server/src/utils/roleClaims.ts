import type { DecodedIdToken } from 'firebase-admin/auth';
import { firebaseAuth } from '../config/firebase.js';
import type { ParticipantRole } from '../db/types.js';

export const PARTICIPANT_ROLES: readonly ParticipantRole[] = ['PART', 'ADMIN'];

export type RoleClaimResult =
  | { status: 'valid'; role: ParticipantRole }
  | { status: 'missing' }
  | { status: 'invalid' };

/**
 * Reads the `role` custom claim from a verified ID token.
 * Only the exact values `PART` and `ADMIN` are accepted; anything else is invalid.
 */
export function readRoleClaim(decoded: DecodedIdToken): RoleClaimResult {
  const raw: unknown = decoded.role;
  if (raw === undefined || raw === null) return { status: 'missing' };
  if (typeof raw === 'string' && (PARTICIPANT_ROLES as readonly string[]).includes(raw)) {
    return { status: 'valid', role: raw as ParticipantRole };
  }
  return { status: 'invalid' };
}

/**
 * Sets `role: 'PART'` on a Firebase user while keeping any other custom claims.
 * Never assigns ADMIN; administrators are provisioned only via `npm run admin:provision`.
 */
export async function assignParticipantRoleClaim(uid: string): Promise<void> {
  const user = await firebaseAuth.getUser(uid);
  const existing = (user.customClaims ?? {}) as Record<string, unknown>;
  if (existing.role === 'PART') return;
  await firebaseAuth.setCustomUserClaims(uid, { ...existing, role: 'PART' });
}

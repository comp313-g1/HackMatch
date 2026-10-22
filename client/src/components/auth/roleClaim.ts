/**
 * Client mirror of server role claim reading (US-003 / #359).
 * Only exact `PART` | `ADMIN` values are trusted; anything else is ignored for UI.
 */

export type AppRole = 'PART' | 'ADMIN';

/** Reads `role` from Firebase ID token claims. Missing/invalid → null (treat as non-admin UI). */
export function readAppRole(claims: Record<string, unknown>): AppRole | null {
  const raw = claims.role;
  if (raw === 'PART' || raw === 'ADMIN') return raw;
  return null;
}

/** ADMIN-only primary-nav destinations (#359). */
export function isAdminOnlyNavView(view: string): boolean {
  return view === 'moderation' || view === 'accounts';
}

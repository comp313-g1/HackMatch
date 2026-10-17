/**
 * Tracks recently consumed password-reset oobCodes (US-005 / S1-P2-16).
 * Firebase maps both tampered and already-used codes to INVALID_OOB_CODE;
 * this store lets the API return an explicit USED_ACTION_CODE after a successful confirm.
 * Hashes only — never stores raw oobCodes (NR-021).
 */

import crypto from 'crypto';

const TTL_MS = 60 * 60 * 1000; // align with Firebase ~60-minute reset window (FR-011)

const consumedAtByHash = new Map<string, number>();

function hashOobCode(oobCode: string): string {
  return crypto.createHash('sha256').update(oobCode.trim()).digest('hex');
}

function evictExpired(now = Date.now()): void {
  for (const [hash, consumedAt] of consumedAtByHash) {
    if (now - consumedAt >= TTL_MS) {
      consumedAtByHash.delete(hash);
    }
  }
}

/** Returns true when this oobCode was already successfully confirmed in this process. */
export function wasPasswordResetCodeConsumed(oobCode: string, now = Date.now()): boolean {
  evictExpired(now);
  const hash = hashOobCode(oobCode);
  const consumedAt = consumedAtByHash.get(hash);
  if (consumedAt === undefined) return false;
  if (now - consumedAt >= TTL_MS) {
    consumedAtByHash.delete(hash);
    return false;
  }
  return true;
}

/** Records a successful password-reset confirm so replay returns USED_ACTION_CODE. */
export function markPasswordResetCodeConsumed(oobCode: string, now = Date.now()): void {
  evictExpired(now);
  consumedAtByHash.set(hashOobCode(oobCode), now);
}

/** Test helper — clears the in-memory consumed store. */
export function _resetConsumedPasswordResetCodes(): void {
  consumedAtByHash.clear();
}

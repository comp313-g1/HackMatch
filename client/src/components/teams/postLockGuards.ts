/**
 * US-022 / #210 / FR-067 — client helpers for post-lock roster freeze.
 * Server rejects leave / remove / slot edits / disband with 409 TEAM_NOT_MUTABLE
 * (details.reason = Locked). UI disables those controls when lifecycle is Locked.
 */

export const POST_LOCK_REJECT_MESSAGE =
  'This roster is locked. Leaving, member removals, slot edits, and disbanding are not allowed.';

export const POST_LOCK_UI_NOTICE =
  'This roster is locked. Leaving, member removals, slot edits, and disbanding are disabled.';

export function isLifecycleLocked(lifecycle: {
  mutable: boolean;
  reason: string | null;
} | null | undefined): boolean {
  return Boolean(lifecycle && !lifecycle.mutable && lifecycle.reason === 'Locked');
}

/** Prefer server error text; fall back to Locked copy when details.reason is Locked. */
export function postLockMutationErrorMessage(err: {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}): string {
  if (err.code === 'TEAM_NOT_MUTABLE' && err.details?.reason === 'Locked') {
    return err.message?.trim() || POST_LOCK_REJECT_MESSAGE;
  }
  if (err.message?.trim()) return err.message.trim();
  return POST_LOCK_REJECT_MESSAGE;
}

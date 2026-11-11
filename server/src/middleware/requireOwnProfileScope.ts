import type { Request, Response, NextFunction } from 'express';

/**
 * US-016 / #158 — a participant may only act on their OWN profile.
 *
 * The recommended-teams endpoint works out who is asking from the verified sign-in token and never
 * from the request. This guard makes that rule explicit instead of silently ignoring a caller who
 * names someone else:
 *
 *   - a request that names no identity passes;
 *   - a request that names the caller's own identity passes (the value is never used);
 *   - a request that names a malformed identity is refused with 400 VALIDATION_ERROR;
 *   - a request that names another participant is refused with 403 FORBIDDEN_NOT_OWN_PROFILE.
 *
 * It must run AFTER the sign-in, MFA, active-account, role and verification checks, so req.participant
 * is the verified caller and an anonymous or ineligible caller learns nothing about this rule. It
 * looks at the query string, the JSON body and the route parameters. The refusal never repeats the
 * value that was sent and never says whether the other participant exists.
 */

/** Names that carry a participant id (a UUID). */
const PARTICIPANT_ID_KEYS = [
  'participantId',
  'participant_id',
  'userId',
  'user_id',
  'accountId',
  'account_id',
  'profileId',
  'profile_id',
] as const;

/** Names that carry the caller's sign-in identity (not a UUID). */
const FIREBASE_UID_KEYS = ['firebaseUid', 'firebase_uid', 'uid'] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const OWN_PROFILE_ONLY_MESSAGE = 'You can only view recommendations for your own profile.';

type Source = Record<string, unknown>;

function sourcesOf(req: Request): Source[] {
  const asRecord = (value: unknown): Source | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Source) : null;
  return [asRecord(req.query), asRecord(req.body), asRecord(req.params)].filter(
    (source): source is Source => source !== null
  );
}

/** A single non-empty text value, or null when the value is blank, repeated or not text. */
function singleText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function requireOwnProfileScope(req: Request, res: Response, next: NextFunction): void {
  const caller = req.participant;
  if (!caller) {
    // Defensive: this guard is only valid after the verified-participant checks.
    res.setHeader('Cache-Control', 'no-store');
    res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
    return;
  }

  const errors: Record<string, string> = {};
  let namesAnotherParticipant = false;

  for (const source of sourcesOf(req)) {
    for (const key of PARTICIPANT_ID_KEYS) {
      if (!(key in source) || source[key] === undefined) continue;
      const value = singleText(source[key]);
      if (value === null || !UUID_PATTERN.test(value)) {
        errors[key] = 'Must be a valid participant id, or be left out.';
      } else if (value.toLowerCase() !== caller.id.toLowerCase()) {
        namesAnotherParticipant = true;
      }
    }
    for (const key of FIREBASE_UID_KEYS) {
      if (!(key in source) || source[key] === undefined) continue;
      const value = singleText(source[key]);
      if (value === null) {
        errors[key] = 'Must be a valid identity, or be left out.';
      } else if (value !== caller.firebase_uid) {
        namesAnotherParticipant = true;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: 'Invalid request.', code: 'VALIDATION_ERROR', errors });
    return;
  }

  if (namesAnotherParticipant) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(403).json({ error: OWN_PROFILE_ONLY_MESSAGE, code: 'FORBIDDEN_NOT_OWN_PROFILE' });
    return;
  }

  next();
}

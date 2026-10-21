/**
 * US-026 / #245 / AC 4 — keep credentials, private contacts, and private workspace
 * data out of moderation case payloads and FR-079 safe summaries.
 */

export const MODERATION_PRIVACY_NOTICE =
  'Credentials, private contact handles, and private workspace content are not available through moderation cases.';

/** Top-level and nested keys that must never appear in ADMIN moderation responses. */
const PRIVATE_MODERATION_KEY_PATTERN =
  /^(email|password|otp(_hash)?|token|id_?token|refresh_?token|firebase_?uid|shared_?contact_?handle|private_?note|workspace_?notes?|team_?notes?|credentials?|mfa_?secret|recovery_?codes?)$/i;

export interface ModerationPrivacyFlags {
  credentialsIncluded: false;
  privateContactsIncluded: false;
  /** ADMIN role never grants US-023 private workspace access via cases. */
  privateWorkspaceAccessGranted: false;
  notice: string;
}

export function moderationPrivacyFlags(): ModerationPrivacyFlags {
  return {
    credentialsIncluded: false,
    privateContactsIncluded: false,
    privateWorkspaceAccessGranted: false,
    notice: MODERATION_PRIVACY_NOTICE,
  };
}

export function isPrivateModerationKey(key: string): boolean {
  return PRIVATE_MODERATION_KEY_PATTERN.test(key);
}

/**
 * Recursively omit credential / private-contact / private-workspace fields.
 * Arrays and plain objects are walked; primitives are returned unchanged.
 */
export function scrubPrivateModerationFields<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubPrivateModerationFields(item)) as T;
  }

  if (typeof value !== 'object') {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isPrivateModerationKey(key)) {
      continue;
    }
    out[key] = scrubPrivateModerationFields(child);
  }
  return out as T;
}

/** True when a serialized payload still contains a known private key name. */
export function publicPayloadHasPrivateModerationKey(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) {
    return value.some((item) => publicPayloadHasPrivateModerationKey(item));
  }
  if (typeof value !== 'object') return false;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isPrivateModerationKey(key)) return true;
    if (publicPayloadHasPrivateModerationKey(child)) return true;
  }
  return false;
}

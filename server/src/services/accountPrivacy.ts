/**
 * US-027 / #254 / AC 1 & 4 — keep credentials, OTPs, and private team notes out of
 * ADMIN account-management payloads; support blocking public ADMIN self-promotion.
 */

export const ACCOUNT_PRIVACY_NOTICE =
  'Credentials, OTPs, private contact handles, and private team notes are not available through account-management endpoints. Public ADMIN registration or self-promotion is prohibited.';

export const ADMIN_SELF_PROMOTION_CODE = 'ADMIN_SELF_PROMOTION_FORBIDDEN';

export const ADMIN_SELF_PROMOTION_MESSAGE =
  'Public registration or self-promotion to ADMIN is prohibited. Administrator accounts are created only through authorized operator provisioning.';

/**
 * Keys that must never appear in ADMIN account responses or FR-079 safe summaries.
 * Email remains allowed on account cards (US-027 AC 1 identifier); secrets and notes do not.
 */
const PRIVATE_ACCOUNT_KEY_PATTERN =
  /^(password|passwd|pwd|otp([_-]?hash|[_-]?code|[_-]?token)?|otpHash|otpCode|token|id_?token|refresh_?token|access_?token|session(_token)?|firebase_?uid|firebaseUid|shared_?contact_?handle|sharedContactHandle|private_?note|workspace_?notes?|workspaceNote|team_?notes?|teamNotes|credentials?|mfa_?secret|recovery_?codes?|secret|api_?key)$/i;

export interface AccountPrivacyFlags {
  credentialsIncluded: false;
  otpsIncluded: false;
  privateTeamNotesIncluded: false;
  privateContactsIncluded: false;
  publicAdminSelfPromotionAllowed: false;
  notice: string;
}

export function accountPrivacyFlags(): AccountPrivacyFlags {
  return {
    credentialsIncluded: false,
    otpsIncluded: false,
    privateTeamNotesIncluded: false,
    privateContactsIncluded: false,
    publicAdminSelfPromotionAllowed: false,
    notice: ACCOUNT_PRIVACY_NOTICE,
  };
}

export function isPrivateAccountKey(key: string): boolean {
  return PRIVATE_ACCOUNT_KEY_PATTERN.test(key);
}

/**
 * Recursively omit credential / OTP / private-note / private-contact fields.
 */
export function scrubPrivateAccountFields<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubPrivateAccountFields(item)) as T;
  }

  if (typeof value !== 'object') {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isPrivateAccountKey(key)) {
      continue;
    }
    out[key] = scrubPrivateAccountFields(child);
  }
  return out as T;
}

/** True when a serialized payload still contains a known private key name. */
export function publicPayloadHasPrivateAccountKey(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) {
    return value.some((item) => publicPayloadHasPrivateAccountKey(item));
  }
  if (typeof value !== 'object') return false;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isPrivateAccountKey(key)) return true;
    if (publicPayloadHasPrivateAccountKey(child)) return true;
  }
  return false;
}

/**
 * Build a safe "submitted" echo for validation failures — never includes password/OTP.
 */
export function sanitizeSubmittedAccountDraft(
  body: unknown
): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  const record = body as Record<string, unknown>;
  const submitted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isPrivateAccountKey(key) || key.toLowerCase() === 'password') {
      submitted[key] = '[redacted]';
      continue;
    }
    submitted[key] = value;
  }
  return submitted;
}

/**
 * Reject public attempts to claim or escalate to ADMIN (US-027 AC 4).
 * Returns null when the attempt is allowed (PART / omitted).
 */
export function evaluateAdminSelfPromotionAttempt(input: {
  role?: unknown;
  privilegeKeys?: Record<string, unknown>;
}): { forbidden: true; code: typeof ADMIN_SELF_PROMOTION_CODE; message: string } | null {
  if (input.role !== undefined && input.role !== null) {
    const raw = String(input.role).trim().toUpperCase();
    if (raw !== 'PART') {
      return {
        forbidden: true,
        code: ADMIN_SELF_PROMOTION_CODE,
        message: ADMIN_SELF_PROMOTION_MESSAGE,
      };
    }
  }

  const privilegeKeys = input.privilegeKeys || {};
  for (const [key, value] of Object.entries(privilegeKeys)) {
    if (value !== undefined && value !== null) {
      return {
        forbidden: true,
        code: ADMIN_SELF_PROMOTION_CODE,
        message: ADMIN_SELF_PROMOTION_MESSAGE,
      };
    }
    void key;
  }

  return null;
}

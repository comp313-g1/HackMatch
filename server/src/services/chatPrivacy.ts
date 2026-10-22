/**
 * US-030 / #345 / FR-089 — keep credentials, OTPs, and account emails out of
 * chat channel/message payloads. Display handles only.
 */

export const CHAT_PRIVACY_NOTICE =
  'Credentials, OTPs, and account emails are not available through chat endpoints. Messages show author handles only.';

/**
 * Top-level and nested keys that must never appear in chat API responses.
 * Includes email (unlike ADMIN account cards, which may show email as an identifier).
 */
const PRIVATE_CHAT_KEY_PATTERN =
  /^(email|e[_-]?mail|mail|password|passwd|pwd|otp([_-]?hash|[_-]?code|[_-]?token)?|otpHash|otpCode|token|id_?token|refresh_?token|access_?token|session(_token)?|firebase_?uid|firebaseUid|shared_?contact_?handle|sharedContactHandle|private_?note|workspace_?notes?|workspaceNote|team_?notes?|teamNotes|credentials?|mfa_?secret|recovery_?codes?|secret|api_?key)$/i;

export interface ChatPrivacyFlags {
  credentialsIncluded: false;
  otpsIncluded: false;
  emailsIncluded: false;
  notice: string;
}

export function chatPrivacyFlags(): ChatPrivacyFlags {
  return {
    credentialsIncluded: false,
    otpsIncluded: false,
    emailsIncluded: false,
    notice: CHAT_PRIVACY_NOTICE,
  };
}

export function isPrivateChatKey(key: string): boolean {
  return PRIVATE_CHAT_KEY_PATTERN.test(key);
}

/**
 * Recursively omit credential / OTP / email / secret fields from chat payloads.
 */
export function scrubPrivateChatFields<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubPrivateChatFields(item)) as T;
  }

  if (typeof value !== 'object') {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isPrivateChatKey(key)) {
      continue;
    }
    out[key] = scrubPrivateChatFields(child);
  }
  return out as T;
}

/** True when a serialized payload still contains a known private chat key name. */
export function publicPayloadHasPrivateChatKey(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) {
    return value.some((item) => publicPayloadHasPrivateChatKey(item));
  }
  if (typeof value !== 'object') return false;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isPrivateChatKey(key)) return true;
    if (publicPayloadHasPrivateChatKey(child)) return true;
  }
  return false;
}

/**
 * Build a safe "submitted" echo for validation failures (NR-017).
 * Never echoes password / OTP / email values in the clear.
 */
export function sanitizeSubmittedChatDraft(body: unknown): unknown {
  if (body === null || body === undefined) {
    return body;
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }

  const record = body as Record<string, unknown>;
  const submitted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isPrivateChatKey(key)) {
      submitted[key] = '[redacted]';
      continue;
    }
    submitted[key] = value;
  }
  return submitted;
}

/**
 * Wrap a successful chat response with privacy flags and a scrubbed payload.
 */
export function buildChatSuccessPayload<T extends Record<string, unknown>>(
  data: T
): T & { privacy: ChatPrivacyFlags } {
  return {
    ...scrubPrivateChatFields(data),
    privacy: chatPrivacyFlags(),
  };
}

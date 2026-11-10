import type { AuditRecord } from './auditTypes';

/**
 * US-028 / #263 display rules for personal data in audit records (NR-023, FR-079).
 *
 * Audit rows hold identifiers, not names or e-mail addresses, and the server already removes
 * credential and contact fields from the state summary. Two things can still carry personal
 * data into the screen: the free-text reason an administrator typed, and string values inside
 * the summary. Those are masked here, at display time, as a second layer. The stored record is
 * never changed (the audit trail is append-only).
 */

export const EMAIL_PLACEHOLDER = '[email removed]';
export const PHONE_PLACEHOLDER = '[phone removed]';

/** Same label roster history uses for an erased account (server: buildMembershipPseudonym). */
export const FORMER_MEMBER_PREFIX = 'Former Member';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// The lookbehind makes a match start only at the beginning of a run of address characters,
// which keeps the scan linear even for a very long string with no "@" in it.
const EMAIL = /(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
/**
 * Phone numbers, deliberately conservative so ids, dates, case numbers and timestamps are not
 * hidden: an international number with a leading "+", or the common 3-3-4 grouped form.
 */
const PHONE = /(?<![\w+])(?:\+\d[\d\s().-]{7,}\d|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})(?![\w-])/g;

export interface RedactionResult {
  text: string;
  /** How many pieces of personal contact data were hidden. */
  redactedCount: number;
}

/** Hides e-mail addresses and phone numbers in free text. Record/participant UUIDs are left intact. */
export function redactPersonalText(text: string): RedactionResult {
  let redactedCount = 0;
  // Split on UUIDs so the digits inside an id can never be mistaken for a phone number.
  const parts = text.split(new RegExp(`(${UUID.source})`, 'gi'));
  const out = parts.map((part, index) => {
    if (index % 2 === 1) return part; // a UUID
    return part
      .replace(EMAIL, () => {
        redactedCount += 1;
        return EMAIL_PLACEHOLDER;
      })
      .replace(PHONE, () => {
        redactedCount += 1;
        return PHONE_PLACEHOLDER;
      });
  });
  return { text: out.join(''), redactedCount };
}

export interface SummaryRedaction {
  value: Record<string, unknown>;
  redactedCount: number;
}

/** Applies redactPersonalText to every string value in the summary (keys are not changed). */
export function redactSummary(summary: Record<string, unknown>): SummaryRedaction {
  let redactedCount = 0;
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const r = redactPersonalText(value);
      redactedCount += r.redactedCount;
      return r.text;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  };
  return { value: walk(summary) as Record<string, unknown>, redactedCount };
}

/** Stable non-identifying label for an erased account, e.g. "Former Member 1a2b3c4d". */
export function formerMemberLabel(id: string): string {
  return `${FORMER_MEMBER_PREFIX} ${id.replace(/-/g, '').slice(0, 8)}`;
}

/**
 * True when this record says the target account's live personal data was erased (a completed
 * deletion). Decided from the record alone, so a row never depends on which pages were loaded.
 */
export function isIdentityErasure(record: Pick<AuditRecord, 'actionType' | 'outcome' | 'safeStateSummary'>): boolean {
  return (
    record.actionType === 'account_delete' &&
    (record.outcome === 'deletion_completed' || record.safeStateSummary?.livePiiErased === true)
  );
}

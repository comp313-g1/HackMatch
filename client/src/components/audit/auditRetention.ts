/**
 * US-028 / #263 retention display (NR-023, R-06).
 *
 * The team has not approved a retention period for audit records yet, so by default the page
 * says so and marks nothing. When a period is approved it is set once through
 * VITE_AUDIT_RETENTION_DAYS and records older than it are labelled "Past retention" for review.
 * This is display only: the audit trail is append-only and this page never deletes anything.
 */

export const RETENTION_MIN_DAYS = 1;
/** Sanity ceiling (10 years); anything larger is treated as a configuration mistake. */
export const RETENTION_MAX_DAYS = 3650;

export type RetentionPolicy =
  | { status: 'pending' }
  | { status: 'invalid'; raw: string }
  | { status: 'approved'; days: number };

/** Parses the configured value: empty = not approved yet; a whole number of days = approved. */
export function readRetentionPolicy(raw: string | number | null | undefined): RetentionPolicy {
  if (raw === undefined || raw === null) return { status: 'pending' };
  const text = String(raw).trim();
  if (text === '') return { status: 'pending' };
  if (!/^\d+$/.test(text)) return { status: 'invalid', raw: text };
  const days = Number(text);
  if (days < RETENTION_MIN_DAYS || days > RETENTION_MAX_DAYS) return { status: 'invalid', raw: text };
  return { status: 'approved', days };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Truncates fractional seconds to milliseconds so every engine parses the same instant. */
function parseUtc(iso: string): number {
  return Date.parse(iso.replace(/(\.\d{3})\d+/, '$1'));
}

/** True when the record is strictly older than `days` days at `now` (exactly N days is not past). */
export function isPastRetention(createdAt: string, days: number, now: number): boolean {
  const created = parseUtc(createdAt);
  if (Number.isNaN(created)) return false; // never claim a record is expired when its time is unreadable
  return now - created > days * DAY_MS;
}

export function describeRetention(policy: RetentionPolicy): string {
  switch (policy.status) {
    case 'approved':
      return `Retention: audit records are kept for ${policy.days} day${policy.days === 1 ? '' : 's'}. Older records are marked "Past retention" for review; they are never edited or deleted from this page.`;
    case 'invalid':
      return `Retention: the configured retention period ("${policy.raw}") is not valid, so no records are marked. It must be a whole number of days from ${RETENTION_MIN_DAYS} to ${RETENTION_MAX_DAYS}.`;
    default:
      return 'Retention: the retention period for audit records has not been approved yet (NR-023 / R-06). Until it is, use synthetic demonstration data only.';
  }
}

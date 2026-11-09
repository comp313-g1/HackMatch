/** US-028 / #259 audit-record client types (FR-079, FR-080). Mirrors server/src/services/auditRecords.ts. */

export type AuditCategory = 'event' | 'moderation' | 'account';

export interface AuditRecord {
  id: string;
  /** Actor identified by participant id only (never email or name). */
  actorId: string;
  actionType: string;
  category: AuditCategory;
  targetType: string;
  targetId: string;
  reason: string;
  outcome: string;
  /** Already scrubbed of credentials and private contacts by the server. */
  safeStateSummary: Record<string, unknown>;
  /** UTC ISO-8601 with microseconds, e.g. 2026-11-03T10:00:00.123456Z. */
  createdAt: string;
}

export interface AuditPage {
  records: AuditRecord[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface AuditQueryParams {
  limit?: number;
  cursor?: string | null;
}

export const AUDIT_PAGE_SIZE = 25;

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  event: 'Event',
  moderation: 'Moderation',
  account: 'Account',
};

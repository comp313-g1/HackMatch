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

/** Raw values of the filter form (strings, exactly as typed). */
export interface AuditFilters {
  /** Participant id of the administrator who took the action. */
  actor: string;
  /** Exact action type, e.g. account_suspend. */
  actionType: string;
  category: '' | AuditCategory;
  /** YYYY-MM-DD, inclusive, UTC. */
  from: string;
  /** YYYY-MM-DD, inclusive, UTC. */
  to: string;
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  actor: '',
  actionType: '',
  category: '',
  from: '',
  to: '',
};

export type AuditFilterErrors = Partial<Record<keyof AuditFilters, string>>;

export interface AuditQueryParams extends Partial<AuditFilters> {
  limit?: number;
  cursor?: string | null;
}

/** Suggestions for the action-type box; any lowercase action type is still accepted. */
export const KNOWN_AUDIT_ACTION_TYPES = [
  'moderation_dismiss',
  'moderation_redact',
  'moderation_warn',
  'moderation_hide',
  'moderation_disable_url',
  'account_suspend',
  'account_delete',
] as const;

export const AUDIT_PAGE_SIZE = 25;

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  event: 'Event',
  moderation: 'Moderation',
  account: 'Account',
};

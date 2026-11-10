import { getSupabaseClient } from './client.js';

/**
 * US-028 / #258 read-only audit query over event_action_records (FR-080).
 * The database function re-verifies the caller is an active ADMIN and returns
 * one consistent newest-first page; nothing here can write to the audit table.
 */
export type AuditCategory = 'event' | 'moderation' | 'account';

export interface AuditRecordRow {
  id: string;
  actorId: string;
  targetType: string;
  targetId: string;
  actionType: string;
  category: AuditCategory;
  reason: string;
  outcome: string;
  safeStateSummary: Record<string, unknown> | null;
  /** UTC ISO-8601 with microseconds, e.g. 2026-11-03T10:00:00.123456Z */
  createdAt: string;
}

export interface AuditQueryParams {
  actorId?: string | null;
  actionType?: string | null;
  category?: AuditCategory | null;
  /** Inclusive lower bound (UTC). */
  from?: string | null;
  /** Inclusive upper bound (UTC). */
  to?: string | null;
  limit: number;
  cursor?: { createdAt: string; id: string } | null;
}

export interface AuditQueryResult {
  records: AuditRecordRow[];
  hasMore: boolean;
  nextCursor: { createdAt: string; id: string } | null;
}

export interface IAuditRecordsRepository {
  query(adminId: string, params: AuditQueryParams): Promise<AuditQueryResult>;
}

export const auditRecordsRepository: IAuditRecordsRepository = {
  async query(adminId, params) {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('query_admin_audit_records', {
      p_actor: adminId,
      p_audit_actor: params.actorId ?? null,
      p_action_type: params.actionType ?? null,
      p_category: params.category ?? null,
      p_from: params.from ?? null,
      p_to: params.to ?? null,
      p_limit: params.limit,
      p_cursor_created_at: params.cursor?.createdAt ?? null,
      p_cursor_id: params.cursor?.id ?? null,
    });
    if (error) throw error;
    return data as AuditQueryResult;
  },
};

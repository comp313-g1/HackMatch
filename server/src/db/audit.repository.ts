
import { getSupabaseClient } from './client.js';

export interface AuditFilters {
  actorId?: string;
  actionType?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export async function queryAuditRecords(filters: AuditFilters) {
  const db = getSupabaseClient();

  let query = db
    .from('event_action_records')
    .select(
      'id, actor_id, action_type, target_type, target_id, reason, outcome, created_at',
      { count: 'exact' }
    );

  if (filters.actorId) {
    query = query.eq('actor_id', filters.actorId);
  }

  if (filters.actionType) {
    query = query.eq('action_type', filters.actionType);
  }

  if (filters.from) {
    query = query.gte('created_at', filters.from);
  }

  if (filters.to) {
    query = query.lte('created_at', filters.to);
  }

  const start = (filters.page - 1) * filters.pageSize;
  const end = start + filters.pageSize - 1;

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(start, end);

  if (error) throw error;

  return {
    records: data ?? [],
    total: count ?? 0,
  };
}

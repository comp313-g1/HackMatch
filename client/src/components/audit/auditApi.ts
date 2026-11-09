
import { authFetch } from '../../config/authFetch';
import type { AuditResponse } from './auditTypes';

export interface AuditFilters {
  actorId?: string;
  actionType?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export async function fetchAuditRecords(
  filters: AuditFilters = {}
): Promise<AuditResponse> {
  const params = new URLSearchParams();

  if (filters.actorId) {
    params.set('actorId', filters.actorId);
  }

  if (filters.actionType) {
    params.set('actionType', filters.actionType);
  }

  if (filters.from) {
    params.set('from', filters.from);
  }

  if (filters.to) {
    params.set('to', filters.to);
  }

  params.set('page', String(filters.page ?? 1));
  params.set('pageSize', String(filters.pageSize ?? 20));

  const queryString = params.toString();

  const response = await authFetch(
    `/api/admin/audit-records?${queryString}`,
    {
      method: 'GET',
    }
  );

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        'Authentication required. Please sign in again.'
      );
    }

    if (response.status === 403) {
      throw new Error(
        'Access denied. Administrator permissions required.'
      );
    }

    throw new Error(
      `Failed to fetch audit records. HTTP ${response.status}`
    );
  }

  const data: AuditResponse = await response.json();

  return data;
}

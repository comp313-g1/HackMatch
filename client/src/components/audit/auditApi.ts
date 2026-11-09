import { authFetch, AuthRequiredError } from '../../config/authFetch';
import type { AuditPage, AuditQueryParams } from './auditTypes';

export { AuthRequiredError };

export class AuditApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly fieldErrors?: Record<string, string>
  ) {
    super(message || code);
    this.name = 'AuditApiError';
  }
}

/** GET /api/admin/audit-records — ADMIN-only, read-only, newest first (US-028 / #258). */
export async function fetchAuditRecords(params: AuditQueryParams = {}): Promise<AuditPage> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  const qs = query.toString();

  let res: Response;
  try {
    res = await authFetch(`/api/admin/audit-records${qs ? `?${qs}` : ''}`, { method: 'GET' });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new AuditApiError(0, 'NETWORK', 'Network error. Please try again.');
  }

  if (!res.ok) {
    let body: { error?: string; code?: string; fieldErrors?: Record<string, string> } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* non-JSON error body */
    }
    throw new AuditApiError(
      res.status,
      body.code || 'UNKNOWN_ERROR',
      body.error || `Request failed with status ${res.status}`,
      body.fieldErrors
    );
  }

  const data = (await res.json()) as Partial<AuditPage>;
  return {
    records: data.records ?? [],
    hasMore: Boolean(data.hasMore),
    nextCursor: data.nextCursor ?? null,
  };
}

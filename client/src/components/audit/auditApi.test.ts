import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthRequiredError } from '../../config/authFetch';
import { AuditApiError, fetchAuditRecords } from './auditApi';

vi.mock('../../config/authFetch', async () => {
  const actual = await vi.importActual<typeof import('../../config/authFetch')>(
    '../../config/authFetch'
  );
  return { ...actual, authFetch: vi.fn() };
});

import { authFetch } from '../../config/authFetch';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('fetchAuditRecords (US-028 / #259)', () => {
  beforeEach(() => {
    vi.mocked(authFetch).mockReset();
  });

  it('requests the read-only endpoint with GET and no params by default', async () => {
    vi.mocked(authFetch).mockResolvedValue(json({ status: 'ok', records: [], hasMore: false, nextCursor: null }));
    await fetchAuditRecords();
    expect(authFetch).toHaveBeenCalledWith('/api/admin/audit-records', { method: 'GET' });
  });

  it('sends limit and cursor', async () => {
    vi.mocked(authFetch).mockResolvedValue(json({ records: [{ id: 'a' }], hasMore: true, nextCursor: 'c2' }));
    const page = await fetchAuditRecords({ limit: 25, cursor: 'c1' });
    expect(authFetch).toHaveBeenCalledWith('/api/admin/audit-records?limit=25&cursor=c1', { method: 'GET' });
    expect(page).toEqual({ records: [{ id: 'a' }], hasMore: true, nextCursor: 'c2' });
  });

  it('defaults missing fields to an empty page', async () => {
    vi.mocked(authFetch).mockResolvedValue(json({ status: 'ok' }));
    expect(await fetchAuditRecords()).toEqual({ records: [], hasMore: false, nextCursor: null });
  });

  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN_ROLE'],
    [400, 'VALIDATION_ERROR'],
    [500, 'UNKNOWN_ERROR'],
  ])('throws AuditApiError with status %i and the server code', async (status, code) => {
    vi.mocked(authFetch).mockResolvedValue(json({ error: 'nope', code }, status));
    await expect(fetchAuditRecords()).rejects.toMatchObject({
      name: 'AuditApiError',
      status,
      code,
      message: 'nope',
    });
  });

  it('carries field errors from a 400', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      json({ error: 'Validation failed.', code: 'VALIDATION_ERROR', fieldErrors: { limit: 'bad' } }, 400)
    );
    await expect(fetchAuditRecords()).rejects.toMatchObject({ fieldErrors: { limit: 'bad' } });
  });

  it('copes with a non-JSON error body', async () => {
    vi.mocked(authFetch).mockResolvedValue(new Response('<html>502</html>', { status: 502 }));
    await expect(fetchAuditRecords()).rejects.toMatchObject({ status: 502, code: 'UNKNOWN_ERROR' });
  });

  it('maps network failures to NETWORK and rethrows AuthRequiredError', async () => {
    vi.mocked(authFetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetchAuditRecords()).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
    vi.mocked(authFetch).mockRejectedValueOnce(new AuthRequiredError());
    await expect(fetchAuditRecords()).rejects.toBeInstanceOf(AuthRequiredError);
    expect(new AuditApiError(0, 'X')).toBeInstanceOf(Error);
  });

  it('only ever issues GET requests (the audit trail has no write API)', async () => {
    vi.mocked(authFetch).mockImplementation(async () => json({ records: [] }));
    await fetchAuditRecords({ limit: 1 });
    await fetchAuditRecords({ cursor: 'x' });
    for (const call of vi.mocked(authFetch).mock.calls) {
      expect((call[1] as RequestInit).method).toBe('GET');
    }
  });
  describe('filters (US-028 / #260)', () => {
    it('sends actor, action type, category and date filters as query parameters', async () => {
      vi.mocked(authFetch).mockImplementation(async () => json({ records: [] }));
      await fetchAuditRecords({
        limit: 25,
        actor: '123e4567-e89b-42d3-a456-426614174000',
        actionType: 'account_suspend',
        category: 'account',
        from: '2026-11-01',
        to: '2026-11-03',
      });
      const url = new URL(String(vi.mocked(authFetch).mock.calls[0][0]), 'http://x');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        limit: '25',
        actor: '123e4567-e89b-42d3-a456-426614174000',
        actionType: 'account_suspend',
        category: 'account',
        from: '2026-11-01',
        to: '2026-11-03',
      });
    });

    it('leaves empty and whitespace-only filters out entirely', async () => {
      vi.mocked(authFetch).mockImplementation(async () => json({ records: [] }));
      await fetchAuditRecords({ limit: 25, actor: '', actionType: '   ', category: '', from: '', to: '' });
      expect(vi.mocked(authFetch).mock.calls[0][0]).toBe('/api/admin/audit-records?limit=25');
    });

    it('combines filters with a paging cursor and encodes special characters', async () => {
      vi.mocked(authFetch).mockImplementation(async () => json({ records: [] }));
      await fetchAuditRecords({ cursor: 'a+b/c=', actionType: 'x&y=z' });
      const url = new URL(String(vi.mocked(authFetch).mock.calls[0][0]), 'http://x');
      expect(url.searchParams.get('cursor')).toBe('a+b/c=');
      expect(url.searchParams.get('actionType')).toBe('x&y=z');
      expect([...url.searchParams.keys()].sort()).toEqual(['actionType', 'cursor']);
    });
  });
});

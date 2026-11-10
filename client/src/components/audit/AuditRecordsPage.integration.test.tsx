/**
 * US-028 / #264 — client integration: the real audit page, real filter validation and real
 * API client, talking to a fake backend that mimics the Express contract. Only the network
 * (authFetch) is replaced, so the URLs, methods and error handling are exercised for real.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditRecordsPage } from './AuditRecordsPage';
import type { AuditRecord } from './auditTypes';

vi.mock('../../config/authFetch', async () => {
  const actual = await vi.importActual<typeof import('../../config/authFetch')>('../../config/authFetch');
  return { ...actual, authFetch: vi.fn() };
});

import { authFetch, AuthRequiredError } from '../../config/authFetch';

const ADMIN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const TYPES = ['moderation_warn', 'moderation_hide', 'account_suspend', 'event_approve'];
const categoryOf = (t: string) => (t.startsWith('moderation_') ? 'moderation' : t.startsWith('account_') ? 'account' : 'event');

/** 60 records, newest first, spread over 6 days (10 per day). */
const DATA: AuditRecord[] = Array.from({ length: 60 }, (_, i) => {
  const day = 6 - Math.floor(i / 10); // Nov 6 down to Nov 1
  const type = TYPES[i % 4];
  return {
    id: `00000000-0000-4000-8000-${String(60 - i).padStart(12, '0')}`,
    actorId: i % 2 ? ADMIN_B : ADMIN_A,
    actionType: type,
    category: categoryOf(type) as AuditRecord['category'],
    targetType: 'team',
    targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    reason: `Reason ${60 - i}`,
    outcome: 'Applied',
    safeStateSummary: {},
    createdAt: `2026-11-0${day}T${String(23 - (i % 10)).padStart(2, '0')}:00:00.000000Z`,
  };
});

interface Backend {
  calls: Array<{ method: string; url: string }>;
  fail: ((url: URL) => Response | Error | null) | null;
  handler: (input: unknown, init?: RequestInit) => Promise<Response>;
}

function createBackend(): Backend {
  const backend: Backend = {
    calls: [],
    fail: null,
    handler: async (input, init) => {
      const url = new URL(String(input), 'http://api.test');
      const method = (init?.method ?? 'GET').toUpperCase();
      backend.calls.push({ method, url: `${url.pathname}${url.search}` });

      const injected = backend.fail?.(url);
      if (injected instanceof Error) throw injected;
      if (injected) return injected;

      const p = url.searchParams;
      const limit = Number(p.get('limit') ?? 25);
      const from = p.get('from') ? `${p.get('from')}T00:00:00.000000Z` : null;
      const to = p.get('to') ? `${p.get('to')}T23:59:59.999999Z` : null;
      const matching = DATA.filter(
        (r) =>
          (!p.get('actor') || r.actorId === p.get('actor')) &&
          (!p.get('actionType') || r.actionType === p.get('actionType')) &&
          (!p.get('category') || r.category === p.get('category')) &&
          (!from || r.createdAt >= from) &&
          (!to || r.createdAt <= to)
      );
      const start = p.get('cursor') ? Number(Buffer.from(p.get('cursor')!, 'base64url').toString()) : 0;
      const records = matching.slice(start, start + limit);
      const more = start + limit < matching.length;
      return json({
        status: 'ok',
        records,
        count: records.length,
        hasMore: more,
        nextCursor: more ? Buffer.from(String(start + limit)).toString('base64url') : null,
      });
    },
  };
  return backend;
}

describe('AuditRecordsPage against the API contract (US-028 / #264)', () => {
  let backend: Backend;

  beforeEach(() => {
    backend = createBackend();
    vi.mocked(authFetch).mockReset();
    vi.mocked(authFetch).mockImplementation((input, init) => backend.handler(input, init as RequestInit));
  });

  const open = async () => {
    render(<AuditRecordsPage now={Date.parse('2026-11-30T00:00:00Z')} />);
    await screen.findByTestId('audit-page');
  };
  const type = (id: string, value: string) => fireEvent.change(screen.getByTestId(id), { target: { value } });
  const apply = () => fireEvent.click(screen.getByTestId('audit-filter-apply'));
  const urls = () => backend.calls.map((c) => c.url);
  const rows = () => screen.queryAllByTestId(/^audit-row-/);

  // ------------------------------------------------------------------ happy path
  it('loads the newest 25 records with a plain GET and no filters', async () => {
    await open();
    expect(urls()).toEqual(['/api/admin/audit-records?limit=25']);
    expect(rows()).toHaveLength(25);
    expect(screen.getByTestId('audit-count')).toHaveTextContent('Showing records 1–25 — more available.');
  });

  it('applies actor + action type + category + dates: the right request and only the matching rows', async () => {
    await open();
    type('audit-filter-actor', ADMIN_A.toUpperCase());
    type('audit-filter-actionType', 'moderation_warn');
    type('audit-filter-category', 'moderation');
    type('audit-filter-from', '2026-11-02');
    type('audit-filter-to', '2026-11-05');
    apply();

    await waitFor(() => expect(urls()).toHaveLength(2));
    expect(urls()[1]).toBe(
      `/api/admin/audit-records?limit=25&actor=${ADMIN_A}&actionType=moderation_warn&category=moderation&from=2026-11-02&to=2026-11-05`
    );
    const shown = rows();
    expect(shown.length).toBeGreaterThan(0);
    for (const row of shown) {
      expect(within(row).getByTestId('audit-cell-actor')).toHaveTextContent(ADMIN_A);
      expect(within(row).getByTestId('audit-cell-action')).toHaveTextContent('Warn');
      const when = within(row).getByTestId('audit-cell-time').getAttribute('datetime')!;
      expect(when >= '2026-11-02T00:00:00' && when <= '2026-11-05T23:59:59.999999Z').toBe(true);
    }
    expect(screen.getByTestId('audit-active-filters')).toHaveTextContent(/Actor aaaaaaaa/);
  });

  it('pages with the server cursor and keeps the applied filters (and the page size) on every page', async () => {
    await open();
    type('audit-filter-category', 'moderation');
    apply();
    await waitFor(() => expect(urls()).toHaveLength(2));
    expect(rows()).toHaveLength(25); // 30 moderation records exist

    fireEvent.click(screen.getByTestId('audit-page-next'));
    await waitFor(() => expect(urls()).toHaveLength(3));
    expect(urls()[2]).toMatch(/^\/api\/admin\/audit-records\?limit=25&cursor=[\w-]+&category=moderation$/);
    expect(rows()).toHaveLength(5);
    expect(screen.getByTestId('audit-page-indicator')).toHaveTextContent('Page 2');
    expect(screen.getByTestId('audit-page-next')).toBeDisabled();

    fireEvent.change(screen.getByTestId('audit-page-size'), { target: { value: '50' } });
    await waitFor(() => expect(urls()).toHaveLength(4));
    expect(urls()[3]).toBe('/api/admin/audit-records?limit=50&category=moderation');
    expect(rows()).toHaveLength(30);
  });

  it('clearing the filters sends a plain request again', async () => {
    await open();
    type('audit-filter-actionType', 'account_suspend');
    apply();
    await waitFor(() => expect(urls()).toHaveLength(2));
    fireEvent.click(screen.getByTestId('audit-filter-clear'));
    await waitFor(() => expect(urls()).toHaveLength(3));
    expect(urls()[2]).toBe('/api/admin/audit-records?limit=25');
    expect(screen.getByTestId('audit-filter-actionType')).toHaveValue('');
  });

  it('shows the dedicated empty state when nothing matches, then recovers when cleared', async () => {
    await open();
    type('audit-filter-actionType', 'no_such_action');
    apply();
    expect(await screen.findByTestId('audit-empty-filtered')).toHaveTextContent('No records match these filters.');
    fireEvent.click(screen.getByTestId('audit-empty-clear'));
    await waitFor(() => expect(rows()).toHaveLength(25));
  });

  // ------------------------------------------------------------- invalid input
  it('never sends a request for invalid filters, and loses nothing the user typed', async () => {
    await open();
    const before = backend.calls.length;
    type('audit-filter-actor', 'not-a-uuid');
    type('audit-filter-actionType', 'BAD TYPE');
    type('audit-filter-category', 'event');
    apply();

    expect(await screen.findByTestId('audit-filter-actor-error')).toBeInTheDocument();
    expect(screen.getByTestId('audit-filter-actionType-error')).toBeInTheDocument();
    expect(backend.calls.length).toBe(before);
    expect(screen.getByTestId('audit-filter-actor')).toHaveValue('not-a-uuid');
    expect(screen.getByTestId('audit-filter-actionType')).toHaveValue('BAD TYPE');
    expect(screen.getByTestId('audit-filter-category')).toHaveValue('event');
    expect(rows()).toHaveLength(25); // table untouched
  });

  it('a server-side 400 is mapped onto the right field, keeping the rows and the typed values', async () => {
    await open();
    backend.fail = (url) =>
      url.searchParams.get('actionType') === 'moderation_warn'
        ? json({ error: 'Validation failed.', code: 'VALIDATION_ERROR', fieldErrors: { actionType: 'Rejected by the server.' } }, 400)
        : null;
    type('audit-filter-actionType', 'moderation_warn');
    apply();

    expect(await screen.findByTestId('audit-filter-actionType-error')).toHaveTextContent('Rejected by the server.');
    expect(screen.getByTestId('audit-filter-actionType')).toHaveValue('moderation_warn');
    expect(rows()).toHaveLength(25);
    expect(screen.queryByTestId('audit-active-filters')).not.toBeInTheDocument(); // not applied
  });

  // ---------------------------------------------------------------- access
  it.each([
    [() => json({ error: 'forbidden', code: 'FORBIDDEN_ROLE' }, 403), /only platform administrators/i],
    [() => json({ error: 'unauth', code: 'UNAUTHORIZED' }, 401), /session has expired/i],
    [() => json({ error: 'suspended', code: 'ACCOUNT_SUSPENDED' }, 403), /only platform administrators/i],
  ])('a refused first load shows access denied with no data and no retry loop (%#)', async (make, matcher) => {
    backend.fail = () => make();
    render(<AuditRecordsPage />);
    const denied = await screen.findByTestId('audit-denied');
    expect(within(denied).getByRole('alert')).toHaveTextContent(matcher);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audit-filters')).not.toBeInTheDocument();
    expect(backend.calls).toHaveLength(1);
  });

  it('losing access while filtering or paging shows access denied and drops every row', async () => {
    await open();
    backend.fail = (url) => (url.searchParams.has('cursor') ? json({ code: 'FORBIDDEN_ROLE' }, 403) : null);
    fireEvent.click(screen.getByTestId('audit-page-next'));
    expect(await screen.findByTestId('audit-denied')).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
  });

  it('a signed-out user (no Firebase session) is told to sign in', async () => {
    backend.fail = () => new AuthRequiredError();
    render(<AuditRecordsPage />);
    expect(await screen.findByTestId('audit-denied')).toHaveTextContent(/sign in as an administrator/i);
  });

  // --------------------------------------------------------------- failures
  it('a network failure while applying filters keeps the rows, the old filters and what was typed', async () => {
    await open();
    type('audit-filter-category', 'moderation');
    apply();
    await waitFor(() => expect(urls()).toHaveLength(2));

    backend.fail = () => new TypeError('Failed to fetch');
    type('audit-filter-actionType', 'moderation_hide');
    apply();

    expect(await screen.findByTestId('audit-inline-error')).toHaveTextContent(/network error/i);
    expect(rows()).toHaveLength(25);
    expect(screen.getByTestId('audit-filter-actionType')).toHaveValue('moderation_hide');
    expect(screen.getByTestId('audit-active-filters')).toHaveTextContent('Category Moderation');
    expect(screen.getByTestId('audit-active-filters')).not.toHaveTextContent('moderation_hide');

    backend.fail = null; // the server is back
    apply();
    await waitFor(() => expect(screen.queryByTestId('audit-inline-error')).not.toBeInTheDocument());
    expect(screen.getByTestId('audit-active-filters')).toHaveTextContent('moderation_hide');
  });

  it('a non-JSON server error (bad gateway) becomes a readable message, not a crash', async () => {
    await open();
    backend.fail = () => new Response('<html>502 Bad Gateway</html>', { status: 502 });
    fireEvent.click(screen.getByTestId('audit-refresh'));
    expect(await screen.findByTestId('audit-inline-error')).toHaveTextContent(/status 502/i);
    expect(rows()).toHaveLength(25);
  });

  it('a failed first load offers Retry, and Retry loads the data', async () => {
    backend.fail = () => new TypeError('Failed to fetch');
    render(<AuditRecordsPage />);
    const error = await screen.findByTestId('audit-error');
    backend.fail = null;
    fireEvent.click(within(error).getByRole('button', { name: /retry/i }));
    expect(await screen.findByTestId('audit-page')).toBeInTheDocument();
    expect(rows()).toHaveLength(25);
  });

  // ------------------------------------------------------------- read-only
  it('only ever sends GET requests, however the page is used', async () => {
    await open();
    // Page size first, while all 60 records (more than one page) are showing.
    fireEvent.change(screen.getByTestId('audit-page-size'), { target: { value: '50' } });
    await waitFor(() => expect(urls()).toHaveLength(2));
    fireEvent.click(screen.getByTestId('audit-page-next'));
    await waitFor(() => expect(urls()).toHaveLength(3));
    type('audit-filter-actionType', 'account_suspend');
    apply();
    await waitFor(() => expect(urls()).toHaveLength(4));
    fireEvent.click(screen.getByTestId('audit-refresh'));
    await waitFor(() => expect(urls()).toHaveLength(5));
    fireEvent.click(screen.getByTestId('audit-filter-clear'));
    await waitFor(() => expect(urls()).toHaveLength(6));
    expect(backend.calls.every((c) => c.method === 'GET')).toBe(true);
    expect(backend.calls.every((c) => c.url.startsWith('/api/admin/audit-records'))).toBe(true);
  });
});

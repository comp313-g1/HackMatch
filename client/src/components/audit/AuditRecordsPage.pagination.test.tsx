/**
 * US-028 / #261 — empty state and pagination for no or many results.
 * Covers: next/previous with a cached history, page size, boundaries (first/last/exact-fit/empty),
 * focus and accessibility, and failure handling that never loses the page on screen.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditRecordsPage } from './AuditRecordsPage';
import type { AuditPage, AuditRecord } from './auditTypes';

vi.mock('./auditApi', async () => {
  const actual = await vi.importActual<typeof import('./auditApi')>('./auditApi');
  return { ...actual, fetchAuditRecords: vi.fn() };
});

import { AuditApiError, AuthRequiredError, fetchAuditRecords } from './auditApi';

function rec(id: string): AuditRecord {
  return {
    id,
    actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    actionType: 'moderation_warn',
    category: 'moderation',
    targetType: 'team',
    targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    reason: `Reason ${id}`,
    outcome: 'Applied',
    safeStateSummary: {},
    createdAt: '2026-11-03T10:00:00.000000Z',
  };
}

const recs = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => rec(`${prefix}${i + 1}`));
const pg = (records: AuditRecord[], nextCursor: string | null = null): AuditPage => ({
  records,
  hasMore: nextCursor !== null,
  nextCursor,
});

const rows = () => screen.queryAllByTestId(/^audit-row-/);
const next = () => screen.getByTestId('audit-page-next');
const prev = () => screen.getByTestId('audit-page-prev');
const indicator = () => screen.getByTestId('audit-page-indicator');
const calls = () => vi.mocked(fetchAuditRecords).mock.calls.map((c) => c[0]);

describe('AuditRecordsPage pagination (US-028 / #261)', () => {
  beforeEach(() => {
    vi.mocked(fetchAuditRecords).mockReset();
  });

  /** Renders with `first` as page 1 and waits for it. */
  async function renderPaged(first: AuditPage = pg(recs('a', 25), 'c1')) {
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(first);
    render(<AuditRecordsPage />);
    await screen.findByTestId('audit-page');
  }

  // ------------------------------------------------------------- no results
  it('no results: shows the empty state and no pagination controls', async () => {
    await renderPaged(pg([]));
    expect(screen.getByTestId('audit-empty')).toHaveTextContent(/no administrative action records yet/i);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audit-pagination')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audit-count')).not.toBeInTheDocument();
  });

  it('a few results (one short page): no pagination controls, plain count', async () => {
    await renderPaged(pg(recs('a', 3)));
    expect(rows()).toHaveLength(3);
    expect(screen.queryByTestId('audit-pagination')).not.toBeInTheDocument();
    expect(screen.getByTestId('audit-count')).toHaveTextContent('Showing 3 records.');
  });

  // ----------------------------------------------------------- many results
  it('many results: first page shows controls, a range, and "more available"', async () => {
    await renderPaged();
    expect(rows()).toHaveLength(25);
    expect(screen.getByRole('navigation', { name: /pagination/i })).toBeInTheDocument();
    expect(indicator()).toHaveTextContent('Page 1');
    expect(prev()).toBeDisabled();
    expect(next()).toBeEnabled();
    expect(screen.getByTestId('audit-count')).toHaveTextContent('Showing records 1–25 — more available.');
    expect(screen.getByTestId('audit-page-size')).toHaveValue('25');
    expect(calls()).toEqual([{ limit: 25 }]);
  });

  it('Next fetches with the server cursor and shows the right page and range', async () => {
    await renderPaged();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('b', 25), 'c2'));
    fireEvent.click(next());

    expect(await screen.findByTestId('audit-row-b1')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-row-a1')).not.toBeInTheDocument(); // replaced, not appended
    expect(rows()).toHaveLength(25);
    expect(calls().at(-1)).toEqual({ limit: 25, cursor: 'c1' });
    expect(indicator()).toHaveTextContent('Page 2');
    expect(prev()).toBeEnabled();
    expect(screen.getByTestId('audit-count')).toHaveTextContent('Showing records 26–50 — more available.');
  });

  it('walks to the last page: partial range, Next disabled, no "more available"', async () => {
    await renderPaged();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('b', 25), 'c2'));
    fireEvent.click(next());
    await screen.findByTestId('audit-row-b1');
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('c', 3)));
    fireEvent.click(next());

    expect(await screen.findByTestId('audit-row-c3')).toBeInTheDocument();
    expect(rows()).toHaveLength(3);
    expect(indicator()).toHaveTextContent('Page 3');
    expect(next()).toBeDisabled();
    expect(prev()).toBeEnabled();
    const count = screen.getByTestId('audit-count');
    expect(count).toHaveTextContent('Showing records 51–53.');
    expect(count).not.toHaveTextContent(/more available/i);
  });

  it('Previous shows the cached page without any new request, and Next reuses the cache too', async () => {
    await renderPaged();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('b', 25), 'c2'));
    fireEvent.click(next());
    await screen.findByTestId('audit-row-b1');
    expect(fetchAuditRecords).toHaveBeenCalledTimes(2);

    fireEvent.click(prev());
    expect(await screen.findByTestId('audit-row-a1')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-row-b1')).not.toBeInTheDocument();
    expect(indicator()).toHaveTextContent('Page 1');
    expect(prev()).toBeDisabled();

    fireEvent.click(next());
    expect(await screen.findByTestId('audit-row-b1')).toBeInTheDocument();
    expect(fetchAuditRecords).toHaveBeenCalledTimes(2); // still only the initial load + one Next
  });

  it('shows exactly the same rows when you come back to a page', async () => {
    await renderPaged();
    const before = rows().map((r) => r.getAttribute('data-testid'));
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('b', 25), 'c2'));
    fireEvent.click(next());
    await screen.findByTestId('audit-row-b1');
    fireEvent.click(prev());
    await screen.findByTestId('audit-row-a1');
    expect(rows().map((r) => r.getAttribute('data-testid'))).toEqual(before);
  });

  it('renders a full 100-row page (largest page size) without trouble', async () => {
    await renderPaged(pg(recs('big', 100), 'c1'));
    expect(rows()).toHaveLength(100);
    expect(screen.getByTestId('audit-count')).toHaveTextContent('Showing records 1–100');
  });

  // --------------------------------------------------------------- page size
  it('changing the page size reloads from page 1 with the new limit and keeps applied filters', async () => {
    await renderPaged();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('f', 25), 'cf'));
    fireEvent.change(screen.getByTestId('audit-filter-category'), { target: { value: 'moderation' } });
    fireEvent.click(screen.getByTestId('audit-filter-apply'));
    await screen.findByTestId('audit-row-f1');
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('g', 25), 'cg'));
    fireEvent.click(next());
    await screen.findByTestId('audit-row-g1');
    expect(indicator()).toHaveTextContent('Page 2');

    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('h', 50), 'ch'));
    fireEvent.change(screen.getByTestId('audit-page-size'), { target: { value: '50' } });

    expect(await screen.findByTestId('audit-row-h1')).toBeInTheDocument();
    expect(calls().at(-1)).toEqual({ limit: 50, category: 'moderation' }); // no cursor: back to the newest page
    expect(indicator()).toHaveTextContent('Page 1');
    expect(rows()).toHaveLength(50);
    expect(screen.getByTestId('audit-page-size')).toHaveValue('50');
    expect(screen.getByTestId('audit-count')).toHaveTextContent('Showing records 1–50');
  });

  it('the largest page size sends limit=100 (server maximum)', async () => {
    await renderPaged();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('x', 100), 'cx'));
    fireEvent.change(screen.getByTestId('audit-page-size'), { target: { value: '100' } });
    await screen.findByTestId('audit-row-x100');
    expect(calls().at(-1)).toEqual({ limit: 100 });
  });

  it('page numbers and ranges use the chosen page size', async () => {
    await renderPaged();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('h', 50), 'ch'));
    fireEvent.change(screen.getByTestId('audit-page-size'), { target: { value: '50' } });
    await screen.findByTestId('audit-row-h1');
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('i', 50), 'ci'));
    fireEvent.click(next());
    await screen.findByTestId('audit-row-i1');
    expect(screen.getByTestId('audit-count')).toHaveTextContent('Showing records 51–100');
  });

  it('a failed page-size change keeps the old size, the page on screen and an explanation', async () => {
    await renderPaged();
    vi.mocked(fetchAuditRecords).mockRejectedValueOnce(new AuditApiError(0, 'NETWORK'));
    fireEvent.change(screen.getByTestId('audit-page-size'), { target: { value: '100' } });

    expect(await screen.findByTestId('audit-inline-error')).toHaveTextContent(/network error/i);
    expect(screen.getByTestId('audit-page-size')).toHaveValue('25');
    expect(rows()).toHaveLength(25);
    expect(indicator()).toHaveTextContent('Page 1');
  });

  it('ignores a page size the server would not accept', async () => {
    await renderPaged();
    // jsdom lets us force a value that is not among the options.
    const select = screen.getByTestId('audit-page-size') as HTMLSelectElement;
    const option = document.createElement('option');
    option.value = '500';
    select.appendChild(option);
    fireEvent.change(select, { target: { value: '500' } });
    expect(fetchAuditRecords).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------- boundary cases
  it('an exact fit that ends on a full page shows no extra empty page', async () => {
    await renderPaged(pg(recs('a', 25), 'c1')); // server says more, but there is nothing after it
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg([]));
    fireEvent.click(next());

    expect(await screen.findByTestId('audit-inline-error')).toHaveTextContent(/no more records/i);
    expect(rows()).toHaveLength(25); // never moved to an empty page 2; the current page stays
    // That is now known to be the only page, so there is nothing left to page through.
    expect(screen.queryByTestId('audit-pagination')).not.toBeInTheDocument();
    expect(screen.getByTestId('audit-count')).toHaveTextContent('Showing 25 records.');
    expect(screen.getByTestId('audit-count')).not.toHaveTextContent(/more available/i);
    expect(fetchAuditRecords).toHaveBeenCalledTimes(2);
  });

  it('exactly one full page and no more: no pagination controls', async () => {
    await renderPaged(pg(recs('a', 25)));
    expect(screen.queryByTestId('audit-pagination')).not.toBeInTheDocument();
    expect(screen.getByTestId('audit-count')).toHaveTextContent('Showing 25 records.');
  });

  it('ignores a cursor when the server reports no further page', async () => {
    await renderPaged({ records: recs('a', 5), hasMore: false, nextCursor: 'stale' });
    expect(screen.queryByTestId('audit-pagination')).not.toBeInTheDocument();
  });

  it('does not offer Next when "more" is claimed but there is no cursor to fetch it with', async () => {
    await renderPaged({ records: recs('a', 25), hasMore: true, nextCursor: null });
    expect(screen.queryByTestId('audit-pagination')).not.toBeInTheDocument();
    expect(screen.getByTestId('audit-count')).not.toHaveTextContent(/more available/i);
    expect(fetchAuditRecords).toHaveBeenCalledTimes(1);
  });

  // ------------------------------------------------------ refresh and filters
  it('Refresh from a later page returns to the newest page and clears the cache', async () => {
    await renderPaged();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('b', 25), 'c2'));
    fireEvent.click(next());
    await screen.findByTestId('audit-row-b1');

    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('n', 25), 'cn1'));
    fireEvent.click(screen.getByTestId('audit-refresh'));
    await screen.findByTestId('audit-row-n1');
    expect(calls().at(-1)).toEqual({ limit: 25 });
    expect(indicator()).toHaveTextContent('Page 1');

    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('m', 25), 'cn2'));
    fireEvent.click(next());
    await screen.findByTestId('audit-row-m1');
    expect(calls().at(-1)).toEqual({ limit: 25, cursor: 'cn1' }); // fresh cursor, not the stale cache
  });

  it('a failed Refresh keeps the current page and its position', async () => {
    await renderPaged();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('b', 25), 'c2'));
    fireEvent.click(next());
    await screen.findByTestId('audit-row-b1');

    vi.mocked(fetchAuditRecords).mockRejectedValueOnce(new AuditApiError(500, 'X', 'Server hiccup'));
    fireEvent.click(screen.getByTestId('audit-refresh'));

    expect(await screen.findByTestId('audit-inline-error')).toHaveTextContent(/server hiccup/i);
    expect(screen.getByTestId('audit-row-b1')).toBeInTheDocument();
    expect(indicator()).toHaveTextContent('Page 2');
  });

  it('filtering when empty results come back shows the "no matches" state without pagination', async () => {
    await renderPaged();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg([]));
    fireEvent.change(screen.getByTestId('audit-filter-actionType'), { target: { value: 'no_such_action' } });
    fireEvent.click(screen.getByTestId('audit-filter-apply'));
    expect(await screen.findByTestId('audit-empty-filtered')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-pagination')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------- failures
  it('a failed Next keeps the current page, explains where you are, and can be retried', async () => {
    await renderPaged();
    vi.mocked(fetchAuditRecords).mockRejectedValueOnce(new AuditApiError(0, 'NETWORK'));
    fireEvent.click(next());

    const err = await screen.findByTestId('audit-inline-error');
    expect(err).toHaveTextContent(/network error/i);
    expect(err).toHaveTextContent(/still on page 1/i);
    expect(rows()).toHaveLength(25);
    expect(screen.getByTestId('audit-row-a1')).toBeInTheDocument();
    expect(next()).toBeEnabled();

    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('b', 25)));
    fireEvent.click(next());
    expect(await screen.findByTestId('audit-row-b1')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-inline-error')).not.toBeInTheDocument();
    expect(calls().at(-1)).toEqual({ limit: 25, cursor: 'c1' }); // same cursor on the retry
  });

  it('shows the server message for a failed Next (500)', async () => {
    await renderPaged();
    vi.mocked(fetchAuditRecords).mockRejectedValueOnce(new AuditApiError(500, 'X', 'Database is busy'));
    fireEvent.click(next());
    expect(await screen.findByTestId('audit-inline-error')).toHaveTextContent(/database is busy/i);
  });

  it('an expired or invalid cursor (400) asks the admin to refresh instead of showing a raw error', async () => {
    await renderPaged();
    vi.mocked(fetchAuditRecords).mockRejectedValueOnce(
      new AuditApiError(400, 'VALIDATION_ERROR', 'Validation failed.', { cursor: 'cursor is invalid.' })
    );
    fireEvent.click(next());
    const err = await screen.findByTestId('audit-inline-error');
    expect(err).toHaveTextContent(/no longer available/i);
    expect(err).toHaveTextContent(/refresh/i);
    expect(rows()).toHaveLength(25);
  });

  it.each([
    [new AuditApiError(403, 'FORBIDDEN_ROLE', 'x'), /only platform administrators/i],
    [new AuditApiError(401, 'UNAUTHORIZED', 'x'), /session has expired/i],
    [new AuthRequiredError(), /sign in as an administrator/i],
  ])('losing access while paging shows access denied with no records (%#)', async (err, matcher) => {
    await renderPaged();
    vi.mocked(fetchAuditRecords).mockRejectedValueOnce(err);
    fireEvent.click(next());

    const denied = await screen.findByTestId('audit-denied');
    expect(within(denied).getByRole('alert')).toHaveTextContent(matcher);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audit-pagination')).not.toBeInTheDocument();
  });

  it('losing access while changing the page size also shows access denied', async () => {
    await renderPaged();
    vi.mocked(fetchAuditRecords).mockRejectedValueOnce(new AuditApiError(403, 'FORBIDDEN_ROLE', 'x'));
    fireEvent.change(screen.getByTestId('audit-page-size'), { target: { value: '50' } });
    expect(await screen.findByTestId('audit-denied')).toBeInTheDocument();
  });

  it('does not double-fetch when Next is clicked repeatedly while loading', async () => {
    await renderPaged();
    let resolve!: (p: AuditPage) => void;
    vi.mocked(fetchAuditRecords).mockReturnValueOnce(new Promise((r) => (resolve = r)));
    fireEvent.click(next());
    await waitFor(() => expect(next()).toBeDisabled());
    fireEvent.click(next());
    fireEvent.click(next());
    expect(fetchAuditRecords).toHaveBeenCalledTimes(2); // initial + exactly one Next
    expect(prev()).toBeDisabled();
    expect(screen.getByTestId('audit-page-size')).toBeDisabled();
    expect(screen.getByTestId('audit-refresh')).toBeDisabled();
    expect(rows()).toHaveLength(25); // current page stays visible while loading

    await act(async () => resolve(pg(recs('b', 25), 'c2')));
    expect(await screen.findByTestId('audit-row-b1')).toBeInTheDocument();
    expect(next()).toBeEnabled();
  });

  it('does not crash if the page is closed while the next page is loading', async () => {
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('a', 25), 'c1'));
    const { unmount } = render(<AuditRecordsPage />);
    await screen.findByTestId('audit-page');
    let resolve!: (p: AuditPage) => void;
    vi.mocked(fetchAuditRecords).mockReturnValueOnce(new Promise((r) => (resolve = r)));
    fireEvent.click(next());
    unmount();
    await act(async () => resolve(pg(recs('late', 25))));
    expect(screen.queryByTestId('audit-row-late1')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------- accessibility + focus
  it('moves focus to the results heading after a page change, not on first load', async () => {
    await renderPaged();
    expect(document.activeElement).not.toBe(screen.getByTestId('audit-results-heading'));

    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('b', 25), 'c2'));
    fireEvent.click(next());
    await screen.findByTestId('audit-row-b1');
    expect(screen.getByTestId('audit-results-heading')).toHaveTextContent('Audit records, page 2');
    expect(document.activeElement).toBe(screen.getByTestId('audit-results-heading'));

    fireEvent.click(prev());
    await screen.findByTestId('audit-row-a1');
    expect(document.activeElement).toBe(screen.getByTestId('audit-results-heading'));
  });

  it('moves focus to the results after a page-size change too', async () => {
    await renderPaged();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('h', 50), 'ch'));
    fireEvent.change(screen.getByTestId('audit-page-size'), { target: { value: '50' } });
    await screen.findByTestId('audit-row-h1');
    expect(document.activeElement).toBe(screen.getByTestId('audit-results-heading'));
  });

  it('announces the visible range to screen readers (polite live region)', async () => {
    await renderPaged();
    expect(screen.getByTestId('audit-count')).toHaveAttribute('aria-live', 'polite');
  });

  it('never offers edit or delete while paging (append-only)', async () => {
    await renderPaged();
    const labels = screen.getAllByRole('button').map((b) => b.textContent?.toLowerCase() ?? '');
    expect(labels.some((l) => /edit|delete|remove|redact|undo/.test(l))).toBe(false);
    expect(screen.getByRole('table').querySelector('button, input, select, form')).toBeNull();
  });

  it('every request is a read-only page fetch with only limit, cursor and filter fields', async () => {
    await renderPaged();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg(recs('b', 25), 'c2'));
    fireEvent.click(next());
    await screen.findByTestId('audit-row-b1');
    for (const call of calls()) {
      expect(Object.keys(call ?? {}).every((k) => ['limit', 'cursor', 'actor', 'actionType', 'category', 'from', 'to'].includes(k))).toBe(true);
    }
  });
});

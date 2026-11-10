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

function rec(id: string, overrides: Partial<AuditRecord> = {}): AuditRecord {
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
    ...overrides,
  };
}

const page = (records: AuditRecord[], hasMore = false, nextCursor: string | null = null): AuditPage => ({
  records,
  hasMore,
  nextCursor,
});

describe('AuditRecordsPage (US-028 / #259)', () => {
  const onNavigateAway = vi.fn();

  beforeEach(() => {
    vi.mocked(fetchAuditRecords).mockReset();
    onNavigateAway.mockReset();
  });

  const renderPage = () => render(<AuditRecordsPage onNavigateAway={onNavigateAway} />);

  // ------------------------------------------------------------------ loading
  it('shows a loading state while the first page is requested', async () => {
    let resolve!: (p: AuditPage) => void;
    vi.mocked(fetchAuditRecords).mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage();

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/loading audit records/i);
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await act(async () => resolve(page([rec('a')])));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  // ------------------------------------------------------------------ success
  it('requests the newest page of 25 and renders the records', async () => {
    vi.mocked(fetchAuditRecords).mockResolvedValue(
      page([rec('r2', { createdAt: '2026-11-03T12:00:00Z' }), rec('r1')])
    );
    renderPage();

    expect(await screen.findByTestId('audit-page')).toBeInTheDocument();
    expect(fetchAuditRecords).toHaveBeenCalledWith({ limit: 25 });
    expect(screen.getByRole('heading', { level: 2, name: /audit records/i })).toBeInTheDocument();
    expect(screen.getByTestId('audit-row-r2')).toBeInTheDocument();
    expect(screen.getByTestId('audit-count')).toHaveTextContent('Showing 2 records.');
    expect(screen.getByText(/append-only/i)).toBeInTheDocument();
    // Stated in the page description and in the table caption (screen readers).
    expect(screen.getAllByText(/times are in utc/i)).toHaveLength(2);
    expect(screen.queryByTestId('audit-pagination')).not.toBeInTheDocument(); // one short page: nothing to page
  });

  it('uses the singular for exactly one record (boundary)', async () => {
    vi.mocked(fetchAuditRecords).mockResolvedValue(page([rec('only')]));
    renderPage();
    expect(await screen.findByTestId('audit-count')).toHaveTextContent('Showing 1 record.');
  });

  // -------------------------------------------------------------------- empty
  it('shows an explicit empty state (no table) when there are no records', async () => {
    vi.mocked(fetchAuditRecords).mockResolvedValue(page([]));
    renderPage();
    expect(await screen.findByTestId('audit-empty')).toHaveTextContent(/no administrative action records yet/i);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audit-load-more')).not.toBeInTheDocument();
  });

  // ----------------------------------------------------------- error + retry
  it('shows a retryable error when the first load fails, then recovers', async () => {
    vi.mocked(fetchAuditRecords)
      .mockRejectedValueOnce(new AuditApiError(0, 'NETWORK'))
      .mockResolvedValueOnce(page([rec('back')]));
    renderPage();

    const error = await screen.findByTestId('audit-error');
    expect(within(error).getByRole('alert')).toHaveTextContent(/network error/i);

    fireEvent.click(within(error).getByRole('button', { name: /retry/i }));
    expect(await screen.findByTestId('audit-row-back')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-error')).not.toBeInTheDocument();
  });

  it.each([
    [500, 'The server exploded.', /the server exploded/i],
    [400, 'Validation failed.', /validation failed/i],
  ])('shows the server message for a %i', async (status, message, matcher) => {
    vi.mocked(fetchAuditRecords).mockRejectedValue(new AuditApiError(status, 'X', message));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(matcher);
    expect(screen.queryByTestId('audit-denied')).not.toBeInTheDocument();
  });

  it('falls back to a generic message for unexpected errors', async () => {
    vi.mocked(fetchAuditRecords).mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load audit records.');
  });

  // ------------------------------------------------------------ unauthorized
  it.each([
    [new AuditApiError(403, 'FORBIDDEN_ROLE', 'x'), /only platform administrators/i],
    [new AuditApiError(403, 'ACCOUNT_SUSPENDED', 'x'), /only platform administrators/i],
    [new AuditApiError(401, 'UNAUTHORIZED', 'x'), /session has expired/i],
    [new AuthRequiredError(), /sign in as an administrator/i],
  ])('shows access denied (no data, no retry loop) for %#', async (err, matcher) => {
    vi.mocked(fetchAuditRecords).mockRejectedValue(err);
    renderPage();

    const denied = await screen.findByTestId('audit-denied');
    expect(within(denied).getByRole('alert')).toHaveTextContent(matcher);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry|refresh|load/i })).not.toBeInTheDocument();
    expect(fetchAuditRecords).toHaveBeenCalledTimes(1);

    fireEvent.click(within(denied).getByRole('button', { name: /back/i }));
    expect(onNavigateAway).toHaveBeenCalledTimes(1);
  });

  it('never renders record content for a denied caller', async () => {
    vi.mocked(fetchAuditRecords).mockRejectedValue(new AuditApiError(403, 'FORBIDDEN_ROLE', 'x'));
    renderPage();
    await screen.findByTestId('audit-denied');
    expect(screen.queryByText(/Reason/)).not.toBeInTheDocument();
  });

  it('turns a mid-session loss of access into the denied state and drops the stale rows', async () => {
    vi.mocked(fetchAuditRecords)
      .mockResolvedValueOnce(page([rec('a')]))
      .mockRejectedValueOnce(new AuditApiError(403, 'ACCOUNT_SUSPENDED', 'x'));
    renderPage();
    await screen.findByTestId('audit-row-a');

    fireEvent.click(screen.getByTestId('audit-refresh'));

    expect(await screen.findByTestId('audit-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-row-a')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------- load more
  it('refreshes to the newest page and replaces the list', async () => {
    vi.mocked(fetchAuditRecords)
      .mockResolvedValueOnce(page([rec('old')]))
      .mockResolvedValueOnce(page([rec('new'), rec('old')]));
    renderPage();
    await screen.findByTestId('audit-row-old');

    fireEvent.click(screen.getByTestId('audit-refresh'));

    expect(await screen.findByTestId('audit-row-new')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^audit-row-/)).toHaveLength(2);
  });

  it('keeps the existing rows when a refresh fails', async () => {
    vi.mocked(fetchAuditRecords)
      .mockResolvedValueOnce(page([rec('keep')]))
      .mockRejectedValueOnce(new AuditApiError(0, 'NETWORK'));
    renderPage();
    await screen.findByTestId('audit-row-keep');

    fireEvent.click(screen.getByTestId('audit-refresh'));

    expect(await screen.findByTestId('audit-inline-error')).toHaveTextContent(/network error/i);
    expect(screen.getByTestId('audit-row-keep')).toBeInTheDocument();
    expect(screen.getByTestId('audit-refresh')).toBeEnabled();
  });

  it('shows the new empty state if a refresh finds nothing', async () => {
    vi.mocked(fetchAuditRecords)
      .mockResolvedValueOnce(page([rec('a')]))
      .mockResolvedValueOnce(page([]));
    renderPage();
    await screen.findByTestId('audit-row-a');
    fireEvent.click(screen.getByTestId('audit-refresh'));
    expect(await screen.findByTestId('audit-empty')).toBeInTheDocument();
  });

  it('disables Refresh while one is in flight so requests never overlap', async () => {
    let resolveSlow!: (p: AuditPage) => void;
    vi.mocked(fetchAuditRecords)
      .mockResolvedValueOnce(page([rec('first')]))
      .mockReturnValueOnce(new Promise((r) => (resolveSlow = r)));
    renderPage();
    await screen.findByTestId('audit-row-first');

    const refresh = screen.getByTestId('audit-refresh');
    fireEvent.click(refresh);
    await waitFor(() => expect(refresh).toBeDisabled());
    expect(refresh).toHaveTextContent(/refreshing/i);
    fireEvent.click(refresh);
    expect(fetchAuditRecords).toHaveBeenCalledTimes(2); // initial load + one refresh
    expect(screen.getByTestId('audit-row-first')).toBeInTheDocument(); // rows stay visible meanwhile

    await act(async () => resolveSlow(page([rec('slow')])));
    expect(await screen.findByTestId('audit-row-slow')).toBeInTheDocument();
    expect(refresh).toBeEnabled();
  });

  // ---------------------------------------------------------------- read-only
  it('offers no way to edit or delete records (append-only, AC 3)', async () => {
    vi.mocked(fetchAuditRecords).mockResolvedValue(page([rec('a'), rec('b')], true, 'c'));
    renderPage();
    await screen.findByTestId('audit-row-a');

    const names = screen.getAllByRole('button').map((b) => b.textContent?.toLowerCase() ?? '');
    expect(names.some((n) => /edit|delete|remove|redact|undo|restore/.test(n))).toBe(false);
    // The only form is the read-only filter/search form; the records themselves have no controls.
    const forms = Array.from(document.querySelectorAll('form'));
    expect(forms).toHaveLength(1);
    expect(forms[0]).toHaveAttribute('role', 'search');
    const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
    expect(
      inputs.every((el) => {
        const id = (el as HTMLElement).id;
        return id.startsWith('audit-filter-') || id === 'audit-page-size';
      })
    ).toBe(true);
    expect(screen.getByRole('table').querySelector('input, textarea, select, form, button')).toBeNull();
  });

  it('issues only read requests', async () => {
    vi.mocked(fetchAuditRecords).mockResolvedValue(page([rec('a')], true, 'c'));
    renderPage();
    await screen.findByTestId('audit-row-a');
    fireEvent.click(screen.getByTestId('audit-page-next'));
    fireEvent.click(screen.getByTestId('audit-refresh'));
    for (const call of vi.mocked(fetchAuditRecords).mock.calls) {
      expect(Object.keys(call[0] ?? {}).sort().every((k) => ['limit', 'cursor'].includes(k))).toBe(true);
    }
  });

  it('does not update state after unmount (no crash on a late response)', async () => {
    let resolve!: (p: AuditPage) => void;
    vi.mocked(fetchAuditRecords).mockReturnValue(new Promise((r) => (resolve = r)));
    const { unmount } = renderPage();
    unmount();
    await act(async () => resolve(page([rec('late')])));
    expect(screen.queryByTestId('audit-row-late')).not.toBeInTheDocument();
  });
});

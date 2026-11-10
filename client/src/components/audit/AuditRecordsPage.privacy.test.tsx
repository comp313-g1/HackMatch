/**
 * US-028 / #263 — retention note and personal-data display on the audit page, across its
 * loading, success, empty, error and access-denied states, paging and filtering.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuditRecordsPage } from './AuditRecordsPage';
import type { AuditPage, AuditRecord } from './auditTypes';

vi.mock('./auditApi', async () => {
  const actual = await vi.importActual<typeof import('./auditApi')>('./auditApi');
  return { ...actual, fetchAuditRecords: vi.fn() };
});

import { AuditApiError, fetchAuditRecords } from './auditApi';

const NOW = Date.parse('2026-11-30T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function rec(id: string, over: Partial<AuditRecord> = {}): AuditRecord {
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
    createdAt: new Date(NOW - DAY).toISOString(),
    ...over,
  };
}

const pg = (records: AuditRecord[], nextCursor: string | null = null): AuditPage => ({
  records,
  hasMore: nextCursor !== null,
  nextCursor,
});

const note = () => screen.getByTestId('audit-retention-note');

describe('AuditRecordsPage retention and pseudonymization (US-028 / #263)', () => {
  beforeEach(() => {
    vi.mocked(fetchAuditRecords).mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const renderPage = async (
    first: AuditPage = pg([rec('a')]),
    props: React.ComponentProps<typeof AuditRecordsPage> = {}
  ) => {
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(first);
    render(<AuditRecordsPage now={NOW} {...props} />);
    await screen.findByTestId('audit-page');
  };

  // -------------------------------------------------------------- retention note
  it('says no retention period is approved yet when nothing is configured (the default)', async () => {
    await renderPage();
    expect(note()).toHaveAttribute('data-retention-status', 'pending');
    expect(note()).toHaveTextContent(/has not been approved yet/i);
    expect(note()).toHaveTextContent(/synthetic demonstration data/i);
    expect(note()).toHaveTextContent(/pseudonym/i);
    expect(note()).toHaveAttribute('role', 'note');
  });

  it('states the approved period from the configuration', async () => {
    vi.stubEnv('VITE_AUDIT_RETENTION_DAYS', '90');
    await renderPage(pg([rec('a')]), {});
    expect(note()).toHaveAttribute('data-retention-status', 'approved');
    expect(note()).toHaveTextContent(/kept for 90 days/i);
  });

  it.each(['', '   ', undefined])('treats an empty setting (%j) as not approved yet', async (value) => {
    vi.stubEnv('VITE_AUDIT_RETENTION_DAYS', value as string);
    await renderPage();
    expect(note()).toHaveAttribute('data-retention-status', 'pending');
  });

  it.each(['abc', '0', '-7', '99999', '12.5', '30 days'])('explains an invalid setting (%j) and marks nothing', async (value) => {
    vi.stubEnv('VITE_AUDIT_RETENTION_DAYS', value);
    await renderPage(pg([rec('old', { createdAt: '2001-01-01T00:00:00Z' })]), {});
    expect(note()).toHaveAttribute('data-retention-status', 'invalid');
    expect(note()).toHaveTextContent(/not valid/i);
    expect(note()).toHaveTextContent(/no records are marked/i);
    expect(screen.queryByTestId('audit-cell-past-retention')).not.toBeInTheDocument();
  });

  it('an explicit policy overrides the configuration', async () => {
    vi.stubEnv('VITE_AUDIT_RETENTION_DAYS', '5');
    await renderPage(pg([rec('a')]), { retentionPolicy: { status: 'approved', days: 7 } });
    expect(note()).toHaveTextContent(/kept for 7 days/);
  });

  // ---------------------------------------------------------- all page states
  it('is shown in the empty state too (nothing to flag, but the policy is still visible)', async () => {
    await renderPage(pg([]));
    expect(screen.getByTestId('audit-empty')).toBeInTheDocument();
    expect(note()).toBeInTheDocument();
  });

  it('is shown in the "no matches" filtered empty state', async () => {
    await renderPage();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg([]));
    fireEvent.change(screen.getByTestId('audit-filter-actionType'), { target: { value: 'no_such_action' } });
    fireEvent.click(screen.getByTestId('audit-filter-apply'));
    expect(await screen.findByTestId('audit-empty-filtered')).toBeInTheDocument();
    expect(note()).toBeInTheDocument();
  });

  it('is not shown while loading, after a first-load error, or when access is denied', async () => {
    let resolve!: (p: AuditPage) => void;
    vi.mocked(fetchAuditRecords).mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { unmount } = render(<AuditRecordsPage now={NOW} />);
    expect(screen.getByTestId('audit-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-retention-note')).not.toBeInTheDocument();
    resolve(pg([]));
    unmount();

    vi.mocked(fetchAuditRecords).mockRejectedValueOnce(new AuditApiError(500, 'X', 'Server hiccup'));
    const second = render(<AuditRecordsPage now={NOW} />);
    expect(await screen.findByTestId('audit-error')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-retention-note')).not.toBeInTheDocument();
    second.unmount();

    vi.mocked(fetchAuditRecords).mockRejectedValueOnce(new AuditApiError(403, 'FORBIDDEN_ROLE', 'x'));
    render(<AuditRecordsPage now={NOW} />);
    expect(await screen.findByTestId('audit-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-retention-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audit-cell-past-retention')).not.toBeInTheDocument();
  });

  it('stays visible when a refresh or page change fails (the page and its note are kept)', async () => {
    await renderPage(pg([rec('a')], 'c1'));
    vi.mocked(fetchAuditRecords).mockRejectedValueOnce(new AuditApiError(0, 'NETWORK'));
    fireEvent.click(screen.getByTestId('audit-page-next'));
    await screen.findByTestId('audit-inline-error');
    expect(note()).toBeInTheDocument();
    expect(screen.getByTestId('audit-row-a')).toBeInTheDocument();
  });

  // ------------------------------------------------------- applied to the rows
  it('flags old rows on the page when a period is approved, and leaves recent ones alone', async () => {
    await renderPage(
      pg([
        rec('recent', { createdAt: new Date(NOW - 2 * DAY).toISOString() }),
        rec('old', { createdAt: new Date(NOW - 200 * DAY).toISOString() }),
      ]),
      { retentionPolicy: { status: 'approved', days: 90 } }
    );
    expect(within(screen.getByTestId('audit-row-old')).getByTestId('audit-cell-past-retention')).toBeInTheDocument();
    expect(within(screen.getByTestId('audit-row-recent')).queryByTestId('audit-cell-past-retention')).not.toBeInTheDocument();
  });

  it('keeps flagging after paging and after applying a filter', async () => {
    await renderPage(pg([rec('p1')], 'c1'), { retentionPolicy: { status: 'approved', days: 30 } });
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg([rec('p2', { createdAt: '2020-01-01T00:00:00Z' })]));
    fireEvent.click(screen.getByTestId('audit-page-next'));
    await screen.findByTestId('audit-row-p2');
    expect(within(screen.getByTestId('audit-row-p2')).getByTestId('audit-cell-past-retention')).toBeInTheDocument();

    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg([rec('f1', { createdAt: '2020-01-01T00:00:00Z' })]));
    fireEvent.change(screen.getByTestId('audit-filter-actionType'), { target: { value: 'moderation_warn' } });
    fireEvent.click(screen.getByTestId('audit-filter-apply'));
    await screen.findByTestId('audit-row-f1');
    expect(within(screen.getByTestId('audit-row-f1')).getByTestId('audit-cell-past-retention')).toBeInTheDocument();
  });

  it('hides contact details on every page, including pages reached by Next and Previous', async () => {
    await renderPage(pg([rec('p1', { reason: 'mail one@example.com' })], 'c1'));
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg([rec('p2', { reason: 'call +1 (555) 123-4567' })]));
    fireEvent.click(screen.getByTestId('audit-page-next'));
    await screen.findByTestId('audit-row-p2');
    expect(screen.getByTestId('audit-row-p2')).toHaveTextContent('[phone removed]');

    fireEvent.click(screen.getByTestId('audit-page-prev'));
    await screen.findByTestId('audit-row-p1');
    expect(screen.getByTestId('audit-row-p1')).toHaveTextContent('[email removed]');
    expect(document.body.innerHTML).not.toMatch(/one@example\.com|555\) 123-4567/);
  });

  it('shows the erased-identity pseudonym for a completed deletion on the page', async () => {
    await renderPage(
      pg([
        rec('del', {
          actionType: 'account_delete',
          category: 'account',
          targetType: 'account',
          targetId: '123e4567-e89b-42d3-a456-426614174000',
          outcome: 'deletion_completed',
          safeStateSummary: { livePiiErased: true },
        }),
      ])
    );
    expect(screen.getByTestId('audit-cell-pseudonym')).toHaveTextContent('Former Member 123e4567');
  });

  it('keeps the records read-only with the new notices in place (append-only)', async () => {
    await renderPage(pg([rec('a', { reason: 'mail jo@example.com' })], 'c1'), {
      retentionPolicy: { status: 'approved', days: 1 },
    });
    expect(screen.getByRole('table').querySelector('button, input, select, textarea, form')).toBeNull();
    const buttons = screen.getAllByRole('button').map((b) => b.textContent?.toLowerCase() ?? '');
    expect(buttons.some((t) => /delete|remove|purge|erase|redact|edit/.test(t))).toBe(false);
  });

  it('the notices do not stop filters, paging or refresh from working', async () => {
    await renderPage(pg([rec('a')], 'c1'));
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg([rec('b')]));
    fireEvent.click(screen.getByTestId('audit-page-next'));
    expect(await screen.findByTestId('audit-row-b')).toBeInTheDocument();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(pg([rec('c')]));
    fireEvent.click(screen.getByTestId('audit-refresh'));
    await waitFor(() => expect(screen.getByTestId('audit-row-c')).toBeInTheDocument());
  });
});

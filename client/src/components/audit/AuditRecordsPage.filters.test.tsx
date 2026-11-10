/**
 * US-028 / #260 — actor, action-type and date filters on the audit records page.
 * Focus: filters reach the API correctly, invalid input is caught without losing anything,
 * and every failure keeps both the typed values and the rows already on screen.
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

const ACTOR = '123e4567-e89b-42d3-a456-426614174000';

function rec(id: string, over: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id,
    actorId: ACTOR,
    actionType: 'moderation_warn',
    category: 'moderation',
    targetType: 'team',
    targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    reason: `Reason ${id}`,
    outcome: 'Applied',
    safeStateSummary: {},
    createdAt: '2026-11-03T10:00:00.000000Z',
    ...over,
  };
}

const page = (records: AuditRecord[], hasMore = false, nextCursor: string | null = null): AuditPage => ({
  records,
  hasMore,
  nextCursor,
});

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
const apply = () => fireEvent.click(screen.getByTestId('audit-filter-apply'));
const lastCall = () => vi.mocked(fetchAuditRecords).mock.calls.at(-1)![0];

describe('AuditRecordsPage filters (US-028 / #260)', () => {
  beforeEach(() => {
    vi.mocked(fetchAuditRecords).mockReset();
  });

  async function renderLoaded(initial: AuditPage = page([rec('a'), rec('b')])) {
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(initial);
    render(<AuditRecordsPage />);
    await screen.findByTestId('audit-page');
  }

  // ----------------------------------------------------------------- success
  it('loads unfiltered first, with the filter form ready', async () => {
    await renderLoaded();
    expect(fetchAuditRecords).toHaveBeenCalledWith({ limit: 25 });
    expect(screen.getByRole('search', { name: /filter audit records/i })).toBeInTheDocument();
    expect(screen.queryByTestId('audit-active-filters')).not.toBeInTheDocument();
    expect(screen.getByTestId('audit-filter-clear')).toBeDisabled();
  });

  it('applies the actor filter and shows only the matching rows', async () => {
    await renderLoaded();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('mine')]));

    type('audit-filter-actor', ACTOR);
    apply();

    expect(await screen.findByTestId('audit-row-mine')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-row-a')).not.toBeInTheDocument();
    expect(lastCall()).toEqual({ limit: 25, actor: ACTOR });
    expect(screen.getByTestId('audit-count')).toHaveTextContent('Showing 1 record matching your filters.');
  });

  it('applies action type, category and an inclusive UTC date range together', async () => {
    await renderLoaded();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('x')]));

    type('audit-filter-actionType', 'account_suspend');
    type('audit-filter-category', 'account');
    type('audit-filter-from', '2026-11-01');
    type('audit-filter-to', '2026-11-03');
    apply();

    await screen.findByTestId('audit-row-x');
    expect(lastCall()).toEqual({
      limit: 25,
      actionType: 'account_suspend',
      category: 'account',
      from: '2026-11-01',
      to: '2026-11-03',
    });
  });

  it('normalizes what is sent (trim, lowercase actor) and tidies the form to match', async () => {
    await renderLoaded();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('x')]));

    type('audit-filter-actor', `  ${ACTOR.toUpperCase()}  `);
    type('audit-filter-actionType', ' moderation_warn ');
    apply();

    await screen.findByTestId('audit-row-x');
    expect(lastCall()).toMatchObject({ actor: ACTOR, actionType: 'moderation_warn' });
    expect(screen.getByTestId('audit-filter-actor')).toHaveValue(ACTOR);
  });

  it('applies on Enter (form submit)', async () => {
    await renderLoaded();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('x')]));
    type('audit-filter-actionType', 'moderation_warn');
    fireEvent.submit(screen.getByRole('search'));
    await screen.findByTestId('audit-row-x');
    expect(lastCall()).toMatchObject({ actionType: 'moderation_warn' });
  });

  it('summarizes the applied filters in words', async () => {
    await renderLoaded();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('x')]));
    type('audit-filter-category', 'moderation');
    type('audit-filter-from', '2026-11-01');
    apply();

    const summary = await screen.findByTestId('audit-active-filters');
    expect(summary).toHaveTextContent('Category Moderation');
    expect(summary).toHaveTextContent('From 2026-11-01 (UTC)');
    expect(summary).not.toHaveTextContent('Actor');
  });

  it('filters by a single day (from == to boundary)', async () => {
    await renderLoaded();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('d')]));
    type('audit-filter-from', '2026-11-03');
    type('audit-filter-to', '2026-11-03');
    apply();
    await screen.findByTestId('audit-row-d');
    expect(lastCall()).toMatchObject({ from: '2026-11-03', to: '2026-11-03' });
  });

  // ------------------------------------------------------------------- empty
  it('shows a distinct "no matches" empty state with a way back, and keeps the filters', async () => {
    await renderLoaded();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([]));
    type('audit-filter-actionType', 'no_such_action');
    apply();

    expect(await screen.findByTestId('audit-empty-filtered')).toHaveTextContent('No records match these filters.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByTestId('audit-filter-actionType')).toHaveValue('no_such_action');
    expect(screen.getByTestId('audit-active-filters')).toHaveTextContent('no_such_action');
    expect(screen.queryByText(/no administrative action records yet/i)).not.toBeInTheDocument();

    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('a')]));
    fireEvent.click(screen.getByTestId('audit-empty-clear'));
    expect(await screen.findByTestId('audit-row-a')).toBeInTheDocument();
    expect(screen.getByTestId('audit-filter-actionType')).toHaveValue('');
  });

  it('shows the original empty state (not "no matches") when nothing is filtered', async () => {
    await renderLoaded(page([]));
    expect(screen.getByTestId('audit-empty')).toHaveTextContent(/no administrative action records yet/i);
    expect(screen.queryByTestId('audit-empty-filtered')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------- invalid input
  /** Real browsers turn a half-typed date into "" and flag validity.badInput; mimic that. */
  const markDateAsHalfTyped = (testId: string) =>
    Object.defineProperty(screen.getByTestId(testId), 'validity', {
      configurable: true,
      value: { badInput: true },
    });

  it.each([['audit-filter-from'], ['audit-filter-to']])(
    'refuses a half-typed %s instead of silently ignoring it (browser reports bad input)',
    async (testId) => {
      await renderLoaded();
      const callsBefore = vi.mocked(fetchAuditRecords).mock.calls.length;
      type('audit-filter-actionType', 'moderation_warn'); // valid input typed alongside
      markDateAsHalfTyped(testId);
      apply();

      expect(await screen.findByTestId(`${testId}-error`)).toHaveTextContent(/complete, real date/i);
      expect(vi.mocked(fetchAuditRecords).mock.calls.length).toBe(callsBefore);
      expect(screen.getByTestId('audit-filter-actionType')).toHaveValue('moderation_warn');
      expect(screen.getByTestId('audit-row-a')).toBeInTheDocument();
    }
  );

  it('a half-typed date does not hide a different error on the same field', async () => {
    await renderLoaded();
    type('audit-filter-from', '2026-11-04');
    type('audit-filter-to', '2026-11-03');
    markDateAsHalfTyped('audit-filter-from');
    apply();
    expect(await screen.findByTestId('audit-filter-from-error')).toHaveTextContent(/must not be after/i);
  });

  it.each([
    ['audit-filter-actor', 'not-a-uuid', 'audit-filter-actor-error', /UUID/],
    ['audit-filter-actionType', 'Account Suspend', 'audit-filter-actionType-error', /lowercase/],
  ])('rejects invalid %s locally: message shown, no request, nothing lost', async (inputId, value, errorId, matcher) => {
    await renderLoaded();
    const callsBefore = vi.mocked(fetchAuditRecords).mock.calls.length;
    type('audit-filter-category', 'event'); // a valid value typed alongside must also survive

    type(inputId, value);
    apply();

    expect(await screen.findByTestId(errorId)).toHaveTextContent(matcher);
    expect(vi.mocked(fetchAuditRecords).mock.calls.length).toBe(callsBefore);
    expect(screen.getByTestId('audit-row-a')).toBeInTheDocument(); // table untouched
    expect(screen.getByTestId('audit-filter-category')).toHaveValue('event'); // other input kept
    expect(screen.queryByTestId('audit-active-filters')).not.toBeInTheDocument();
  });

  it('keeps exactly what the user typed when validation fails (no trimming or rewriting)', async () => {
    await renderLoaded();
    type('audit-filter-actor', '  Not A UUID  ');
    apply();
    await screen.findByTestId('audit-filter-actor-error');
    expect(screen.getByTestId('audit-filter-actor')).toHaveValue('  Not A UUID  ');
  });

  it('rejects a start date after the end date and keeps both dates', async () => {
    await renderLoaded();
    type('audit-filter-from', '2026-11-04');
    type('audit-filter-to', '2026-11-03');
    apply();
    expect(await screen.findByTestId('audit-filter-from-error')).toHaveTextContent(/must not be after/i);
    expect(screen.getByTestId('audit-filter-from')).toHaveValue('2026-11-04');
    expect(screen.getByTestId('audit-filter-to')).toHaveValue('2026-11-03');
    expect(fetchAuditRecords).toHaveBeenCalledTimes(1);
  });

  it('shows all invalid fields at once and clears only the field being corrected', async () => {
    await renderLoaded();
    type('audit-filter-actor', 'bad');
    type('audit-filter-actionType', 'BAD');
    apply();
    await screen.findByTestId('audit-filter-actor-error');
    expect(screen.getByTestId('audit-filter-actionType-error')).toBeInTheDocument();

    type('audit-filter-actor', ACTOR);
    expect(screen.queryByTestId('audit-filter-actor-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('audit-filter-actionType-error')).toBeInTheDocument();
  });

  it('after fixing the errors, applying succeeds', async () => {
    await renderLoaded();
    type('audit-filter-actor', 'bad');
    apply();
    await screen.findByTestId('audit-filter-actor-error');

    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('ok')]));
    type('audit-filter-actor', ACTOR);
    apply();
    expect(await screen.findByTestId('audit-row-ok')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-filter-actor-error')).not.toBeInTheDocument();
  });

  // ------------------------------------------------------------ server errors
  it('maps a server 400 to the right fields, keeping rows, typed values and the old filter', async () => {
    await renderLoaded();
    vi.mocked(fetchAuditRecords).mockRejectedValueOnce(
      new AuditApiError(400, 'VALIDATION_ERROR', 'Validation failed.', {
        actionType: 'Server says no.',
        unknownKey: 'ignored',
      })
    );
    type('audit-filter-actionType', 'moderation_warn');
    apply();

    expect(await screen.findByTestId('audit-filter-actionType-error')).toHaveTextContent('Server says no.');
    expect(screen.getByTestId('audit-inline-error')).toHaveTextContent(/check the highlighted fields/i);
    expect(screen.getByTestId('audit-filter-actionType')).toHaveValue('moderation_warn');
    expect(screen.getByTestId('audit-row-a')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-active-filters')).not.toBeInTheDocument(); // not applied
  });

  it('keeps the previous rows, filters and typed values when applying fails (network)', async () => {
    await renderLoaded();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('filtered')]));
    type('audit-filter-category', 'moderation');
    apply();
    await screen.findByTestId('audit-row-filtered');

    vi.mocked(fetchAuditRecords).mockRejectedValueOnce(new AuditApiError(0, 'NETWORK'));
    type('audit-filter-actionType', 'moderation_hide');
    apply();

    const err = await screen.findByTestId('audit-inline-error');
    expect(err).toHaveTextContent(/network error/i);
    expect(err).toHaveTextContent(/previous results are still shown/i);
    expect(screen.getByTestId('audit-row-filtered')).toBeInTheDocument();
    expect(screen.getByTestId('audit-filter-actionType')).toHaveValue('moderation_hide');
    // The summary still describes the rows actually on screen (category only), plus a hint.
    const summary = screen.getByTestId('audit-active-filters');
    expect(summary).toHaveTextContent('Category Moderation');
    expect(summary).not.toHaveTextContent('moderation_hide');
    expect(summary).toHaveTextContent(/unapplied changes/i);
    expect(screen.getByTestId('audit-filter-apply')).toBeEnabled();
  });

  it('can retry the same filters after a failure', async () => {
    await renderLoaded();
    vi.mocked(fetchAuditRecords).mockRejectedValueOnce(new AuditApiError(500, 'X', 'Server hiccup'));
    type('audit-filter-actionType', 'moderation_warn');
    apply();
    await screen.findByTestId('audit-inline-error');

    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('worked')]));
    apply();
    expect(await screen.findByTestId('audit-row-worked')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-inline-error')).not.toBeInTheDocument();
  });

  // ----------------------------------------------------------- unauthorized
  it.each([
    [new AuditApiError(403, 'FORBIDDEN_ROLE', 'x'), /only platform administrators/i],
    [new AuditApiError(401, 'UNAUTHORIZED', 'x'), /session has expired/i],
    [new AuthRequiredError(), /sign in as an administrator/i],
  ])('losing access while filtering shows access denied and no data (%#)', async (err, matcher) => {
    await renderLoaded();
    vi.mocked(fetchAuditRecords).mockRejectedValueOnce(err);
    type('audit-filter-actionType', 'moderation_warn');
    apply();

    const denied = await screen.findByTestId('audit-denied');
    expect(within(denied).getByRole('alert')).toHaveTextContent(matcher);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audit-filters')).not.toBeInTheDocument();
  });

  // -------------------------------------------------- clear, refresh, paging
  it('clears every filter, resets the form and reloads the unfiltered list', async () => {
    await renderLoaded();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('f')]));
    type('audit-filter-actor', ACTOR);
    type('audit-filter-from', '2026-11-01');
    apply();
    await screen.findByTestId('audit-row-f');

    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('all1'), rec('all2')]));
    fireEvent.click(screen.getByTestId('audit-filter-clear'));

    expect(await screen.findByTestId('audit-row-all2')).toBeInTheDocument();
    expect(lastCall()).toEqual({ limit: 25 });
    for (const id of ['actor', 'actionType', 'category', 'from', 'to']) {
      expect(screen.getByTestId(`audit-filter-${id}`)).toHaveValue('');
    }
    expect(screen.queryByTestId('audit-active-filters')).not.toBeInTheDocument();
  });

  it('clearing only typed-but-unapplied values resets the form without a request', async () => {
    await renderLoaded();
    const calls = vi.mocked(fetchAuditRecords).mock.calls.length;
    type('audit-filter-actor', 'half-typed');
    fireEvent.click(screen.getByTestId('audit-filter-clear'));
    expect(screen.getByTestId('audit-filter-actor')).toHaveValue('');
    expect(vi.mocked(fetchAuditRecords).mock.calls.length).toBe(calls);
  });

  it('clearing also removes validation messages', async () => {
    await renderLoaded();
    type('audit-filter-actor', 'bad');
    apply();
    await screen.findByTestId('audit-filter-actor-error');
    fireEvent.click(screen.getByTestId('audit-filter-clear'));
    expect(screen.queryByTestId('audit-filter-actor-error')).not.toBeInTheDocument();
  });

  it('Next page keeps using the applied filters (not unapplied typing)', async () => {
    await renderLoaded();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('p1')], true, 'cursor-1'));
    type('audit-filter-actionType', 'moderation_warn');
    apply();
    await screen.findByTestId('audit-row-p1');

    type('audit-filter-actionType', 'something_else_unapplied');
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('p2')]));
    fireEvent.click(screen.getByTestId('audit-page-next'));

    expect(await screen.findByTestId('audit-row-p2')).toBeInTheDocument();
    expect(lastCall()).toEqual({ limit: 25, actionType: 'moderation_warn', cursor: 'cursor-1' });
  });

  it('Refresh reloads with the applied filters', async () => {
    await renderLoaded();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('p1')]));
    type('audit-filter-category', 'account');
    apply();
    await screen.findByTestId('audit-row-p1');

    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('p1'), rec('p0')]));
    fireEvent.click(screen.getByTestId('audit-refresh'));
    await screen.findByTestId('audit-row-p0');
    expect(lastCall()).toEqual({ limit: 25, category: 'account' });
  });

  it('replaces the list and returns to page 1 when filters change', async () => {
    await renderLoaded(page([rec('old')], true, 'old-cursor'));
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('old2')]));
    fireEvent.click(screen.getByTestId('audit-page-next'));
    await screen.findByTestId('audit-row-old2');
    expect(screen.getByTestId('audit-page-indicator')).toHaveTextContent('Page 2');

    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('new')], false, null));
    type('audit-filter-actionType', 'moderation_warn');
    apply();

    await screen.findByTestId('audit-row-new');
    expect(screen.queryByTestId('audit-row-old2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audit-pagination')).not.toBeInTheDocument();
    expect(lastCall()).toEqual({ limit: 25, actionType: 'moderation_warn' }); // no leftover cursor
  });

  it('disables Apply while a filter request is in flight so requests never overlap', async () => {
    await renderLoaded();
    let resolve!: (p: AuditPage) => void;
    vi.mocked(fetchAuditRecords).mockReturnValueOnce(new Promise((r) => (resolve = r)));
    type('audit-filter-actionType', 'moderation_warn');
    apply();

    await waitFor(() => expect(screen.getByTestId('audit-filter-apply')).toBeDisabled());
    expect(screen.getByTestId('audit-filter-apply')).toHaveTextContent(/applying/i);
    expect(screen.getByTestId('audit-row-a')).toBeInTheDocument(); // rows stay while loading
    fireEvent.click(screen.getByTestId('audit-filter-apply'));
    expect(fetchAuditRecords).toHaveBeenCalledTimes(2);

    await act(async () => resolve(page([rec('done')])));
    expect(await screen.findByTestId('audit-row-done')).toBeInTheDocument();
    expect(screen.getByTestId('audit-filter-apply')).toBeEnabled();
  });

  it('never sends a request for an unfiltered state containing empty strings', async () => {
    await renderLoaded();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('a')]));
    type('audit-filter-actor', '   ');
    apply();
    await waitFor(() => expect(fetchAuditRecords).toHaveBeenCalledTimes(2));
    expect(lastCall()).toEqual({ limit: 25 });
  });

  it('records stay read-only while filtering (no mutating calls exist)', async () => {
    await renderLoaded();
    vi.mocked(fetchAuditRecords).mockResolvedValueOnce(page([rec('x')]));
    type('audit-filter-actionType', 'moderation_warn');
    apply();
    await screen.findByTestId('audit-row-x');
    expect(screen.getByRole('table').querySelector('button, input, select, textarea, form')).toBeNull();
  });
});

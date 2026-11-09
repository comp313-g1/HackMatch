import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AuditTable } from './AuditTable';
import type { AuditRecord } from './auditTypes';

function record(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    actionType: 'moderation_warn',
    category: 'moderation',
    targetType: 'team',
    targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    reason: 'Repeated spam in pitch',
    outcome: 'Applied',
    safeStateSummary: { caseId: 'case-1', status: 'Resolved' },
    createdAt: '2026-11-03T10:00:00.123456Z',
    ...overrides,
  };
}

describe('AuditTable (US-028 / #259)', () => {
  it('has accessible column headers for every AC 2 field', () => {
    render(<AuditTable records={[record()]} />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Record ID',
      'Actor',
      'Action',
      'Target',
      'Reason',
      'Outcome',
      'Time (UTC)',
    ]);
    expect(screen.getByText(/times are in utc/i)).toBeInTheDocument(); // caption
  });

  it('shows record id, actor, action, target, reason, outcome and UTC time', () => {
    render(<AuditTable records={[record()]} />);
    const row = screen.getByTestId('audit-row-11111111-1111-4111-8111-111111111111');
    expect(within(row).getByTestId('audit-cell-id')).toHaveTextContent('11111111-1111-4111-8111-111111111111');
    expect(within(row).getByTestId('audit-cell-actor')).toHaveTextContent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(within(row).getByTestId('audit-cell-category')).toHaveTextContent('Moderation');
    expect(within(row).getByTestId('audit-cell-action')).toHaveTextContent('Warn');
    expect(within(row).getByText('moderation_warn')).toBeInTheDocument();
    expect(within(row).getByTestId('audit-cell-target-type')).toHaveTextContent('team');
    expect(within(row).getByTestId('audit-cell-target-id')).toHaveTextContent('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    expect(within(row).getByTestId('audit-cell-reason')).toHaveTextContent('Repeated spam in pitch');
    expect(within(row).getByTestId('audit-cell-outcome')).toHaveTextContent('Applied');
    const time = within(row).getByTestId('audit-cell-time');
    expect(time).toHaveTextContent('2026-11-03 10:00:00 UTC');
    expect(time).toHaveAttribute('datetime', '2026-11-03T10:00:00.123456Z');
  });

  it('labels event, moderation and account records distinctly', () => {
    render(
      <AuditTable
        records={[
          record({ id: 'e', category: 'event', actionType: 'event_approve' }),
          record({ id: 'm', category: 'moderation' }),
          record({ id: 'a', category: 'account', actionType: 'account_suspend' }),
        ]}
      />
    );
    const labels = screen.getAllByTestId('audit-cell-category').map((n) => n.textContent);
    expect(labels).toEqual(['Event', 'Moderation', 'Account']);
  });

  it('preserves the order it is given (newest first from the server)', () => {
    render(
      <AuditTable
        records={[
          record({ id: 'new', createdAt: '2026-11-03T12:00:00Z' }),
          record({ id: 'old', createdAt: '2026-11-01T12:00:00Z' }),
        ]}
      />
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveAttribute('data-testid', 'audit-row-new');
    expect(rows[1]).toHaveAttribute('data-testid', 'audit-row-old');
  });

  it('shows the safe state summary on demand, with stable key order', () => {
    render(<AuditTable records={[record({ safeStateSummary: { z: 1, a: 2 } })]} />);
    const pre = screen.getByTestId('audit-cell-summary');
    expect(pre.textContent!.indexOf('"a"')).toBeLessThan(pre.textContent!.indexOf('"z"'));
  });

  it('renders untrusted text as text, never as markup (XSS)', () => {
    const { container } = render(
      <AuditTable
        records={[
          record({
            reason: '<img src=x onerror="alert(1)"><script>alert(2)</script>',
            outcome: '<b>bold</b>',
            safeStateSummary: { note: '<script>alert(3)</script>' },
          }),
        ]}
      />
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByTestId('audit-cell-reason')).toHaveTextContent('<img src=x onerror="alert(1)">');
  });

  it('copes with very long unbroken values and an empty summary', () => {
    const long = 'x'.repeat(4000);
    render(<AuditTable records={[record({ reason: long, safeStateSummary: {} })]} />);
    expect(screen.getByTestId('audit-cell-reason')).toHaveTextContent(long);
    expect(screen.getByTestId('audit-cell-summary')).toHaveTextContent('{}');
    expect(screen.getByTestId('audit-cell-reason')).toHaveClass('break-words');
  });

  it('scrolls horizontally instead of overflowing on narrow screens', () => {
    render(<AuditTable records={[record()]} />);
    expect(screen.getByTestId('audit-table-scroll')).toHaveClass('overflow-x-auto');
  });

  it('is strictly read-only: no buttons, links, inputs or form controls to edit or delete', () => {
    render(<AuditTable records={[record(), record({ id: 'two' })]} />);
    const table = screen.getByRole('table');
    expect(within(table).queryAllByRole('button')).toHaveLength(0);
    expect(within(table).queryAllByRole('link')).toHaveLength(0);
    expect(within(table).queryAllByRole('textbox')).toHaveLength(0);
    expect(table.querySelector('input, textarea, select, form, [contenteditable]')).toBeNull();
    expect(screen.queryByText(/edit|delete|remove/i)).not.toBeInTheDocument();
  });

  it('renders an empty table body without crashing', () => {
    render(<AuditTable records={[]} />);
    expect(screen.getAllByRole('row')).toHaveLength(1); // header only
  });
});

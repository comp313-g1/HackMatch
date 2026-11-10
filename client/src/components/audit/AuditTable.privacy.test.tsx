/**
 * US-028 / #263 — what the audit table shows for personal data (pseudonymization) and for
 * records past an approved retention period.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AuditTable } from './AuditTable';
import type { RetentionPolicy } from './auditRetention';
import type { AuditRecord } from './auditTypes';

const TARGET = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-30T12:00:00Z');

function rec(over: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    actionType: 'moderation_warn',
    category: 'moderation',
    targetType: 'team',
    targetId: TARGET,
    reason: 'Repeated spam in pitch',
    outcome: 'Applied',
    safeStateSummary: {},
    createdAt: '2026-11-29T10:00:00.000000Z',
    ...over,
  };
}

const erasure = (over: Partial<AuditRecord> = {}) =>
  rec({
    id: 'del',
    actionType: 'account_delete',
    category: 'account',
    targetType: 'account',
    outcome: 'deletion_completed',
    safeStateSummary: { livePiiErased: true, profileCleared: true },
    ...over,
  });

describe('AuditTable personal-data display rules (US-028 / #263)', () => {
  describe('free-text reason', () => {
    it('hides an e-mail address and phone number, and says so', () => {
      const { container } = render(
        <AuditTable records={[rec({ reason: 'User jo@example.com asked; phone +1 (555) 123-4567.' })]} />
      );
      const cell = screen.getByTestId('audit-cell-reason');
      expect(cell).toHaveTextContent('User [email removed] asked; phone [phone removed].');
      expect(screen.getByTestId('audit-reason-redacted')).toHaveTextContent(/personal contact details hidden/i);
      // Nowhere in the page, including attributes and the hidden summary, does the raw value appear.
      expect(container.innerHTML).not.toContain('jo@example.com');
      expect(container.innerHTML).not.toContain('555) 123-4567');
    });

    it('shows ordinary reasons exactly as written, with no notice', () => {
      render(<AuditTable records={[rec({ reason: 'Repeated spam in pitch; case 42 on 2026-11-03.' })]} />);
      expect(screen.getByTestId('audit-cell-reason')).toHaveTextContent('Repeated spam in pitch; case 42 on 2026-11-03.');
      expect(screen.queryByTestId('audit-reason-redacted')).not.toBeInTheDocument();
    });

    it('never hides record or participant ids that appear in a reason', () => {
      render(<AuditTable records={[rec({ reason: 'See 11111111-1111-4111-8111-111111111111 for details' })]} />);
      expect(screen.getByTestId('audit-cell-reason')).toHaveTextContent('11111111-1111-4111-8111-111111111111');
      expect(screen.queryByTestId('audit-reason-redacted')).not.toBeInTheDocument();
    });

    it('applies the rule to every row independently', () => {
      render(
        <AuditTable
          records={[
            rec({ id: 'a', reason: 'mail a@x.io' }),
            rec({ id: 'b', reason: 'clean reason' }),
            rec({ id: 'c', reason: 'mail c@y.io' }),
          ]}
        />
      );
      expect(screen.getAllByTestId('audit-reason-redacted')).toHaveLength(2);
      expect(within(screen.getByTestId('audit-row-b')).queryByTestId('audit-reason-redacted')).not.toBeInTheDocument();
    });
  });

  describe('state summary', () => {
    it('hides contact details found in summary values and tells the viewer', () => {
      const { container } = render(
        <AuditTable
          records={[
            rec({
              safeStateSummary: { caseId: 'c1', note: 'reach me at jo@example.com', nested: { tel: 'call 555-123-4567' } },
            }),
          ]}
        />
      );
      const pre = screen.getByTestId('audit-cell-summary');
      expect(pre).toHaveTextContent('[email removed]');
      expect(pre).toHaveTextContent('[phone removed]');
      expect(pre).toHaveTextContent('"caseId": "c1"');
      expect(screen.getByTestId('audit-summary-redacted')).toBeInTheDocument();
      expect(container.innerHTML).not.toContain('jo@example.com');
    });

    it('shows a clean summary unchanged, without a notice', () => {
      render(<AuditTable records={[rec({ safeStateSummary: { caseId: 'c1', status: 'Resolved' } })]} />);
      expect(screen.getByTestId('audit-cell-summary')).toHaveTextContent('"status": "Resolved"');
      expect(screen.queryByTestId('audit-summary-redacted')).not.toBeInTheDocument();
    });
  });

  describe('erased accounts', () => {
    it('shows the roster pseudonym and an "Identity erased" badge for a completed deletion, keeping the ID', () => {
      render(<AuditTable records={[erasure()]} />);
      const cell = screen.getByTestId('audit-cell-erased');
      expect(within(cell).getByTestId('audit-cell-pseudonym')).toHaveTextContent('Former Member cccccccc');
      expect(within(cell).getByText('Identity erased')).toBeInTheDocument();
      expect(screen.getByTestId('audit-cell-target-id')).toHaveTextContent(TARGET);
    });

    it('also recognizes a completed deletion from the summary flag', () => {
      render(<AuditTable records={[erasure({ outcome: 'Applied', safeStateSummary: { livePiiErased: true } })]} />);
      expect(screen.getByTestId('audit-cell-pseudonym')).toBeInTheDocument();
    });

    it.each([
      ['a blocked deletion', erasure({ outcome: 'deletion_blocked_needs_disband', safeStateSummary: { livePiiErased: false } })],
      ['a suspension', rec({ actionType: 'account_suspend', category: 'account', targetType: 'account' })],
      ['a moderation action', rec()],
    ])('does not claim an identity was erased for %s', (_label, record) => {
      render(<AuditTable records={[record]} />);
      expect(screen.queryByTestId('audit-cell-erased')).not.toBeInTheDocument();
      expect(screen.queryByText('Identity erased')).not.toBeInTheDocument();
    });

    it('decides each row from that record alone (consistent whichever page it is on)', () => {
      const { rerender } = render(<AuditTable records={[rec({ id: 'earlier', actionType: 'account_suspend', targetId: TARGET })]} />);
      expect(screen.queryByTestId('audit-cell-erased')).not.toBeInTheDocument();
      rerender(
        <AuditTable
          records={[erasure(), rec({ id: 'earlier', actionType: 'account_suspend', targetId: TARGET })]}
        />
      );
      expect(screen.getAllByTestId('audit-cell-erased')).toHaveLength(1);
      expect(within(screen.getByTestId('audit-row-earlier')).queryByTestId('audit-cell-erased')).not.toBeInTheDocument();
    });

    it('explains the badge for assistive technology and mouse users (title)', () => {
      render(<AuditTable records={[erasure()]} />);
      expect(screen.getByText('Identity erased')).toHaveAttribute('title', expect.stringMatching(/personal data was erased/i));
    });
  });

  describe('retention', () => {
    const approved = (days: number): RetentionPolicy => ({ status: 'approved', days });

    it('marks a record older than the approved period as "Past retention"', () => {
      render(
        <AuditTable
          now={NOW}
          retention={approved(30)}
          records={[rec({ id: 'old', createdAt: new Date(NOW - 31 * DAY).toISOString() })]}
        />
      );
      const badge = within(screen.getByTestId('audit-row-old')).getByTestId('audit-cell-past-retention');
      expect(badge).toHaveTextContent('Past retention');
      expect(badge).toHaveAttribute('title', expect.stringMatching(/never edited or deleted/i));
    });

    it('does not mark records inside the period, including exactly N days old (boundary)', () => {
      render(
        <AuditTable
          now={NOW}
          retention={approved(30)}
          records={[
            rec({ id: 'new', createdAt: new Date(NOW - 1 * DAY).toISOString() }),
            rec({ id: 'edge', createdAt: new Date(NOW - 30 * DAY).toISOString() }),
          ]}
        />
      );
      expect(screen.queryByTestId('audit-cell-past-retention')).not.toBeInTheDocument();
    });

    it('marks just the old rows in a mixed page', () => {
      render(
        <AuditTable
          now={NOW}
          retention={approved(30)}
          records={[
            rec({ id: 'r1', createdAt: new Date(NOW - 1 * DAY).toISOString() }),
            rec({ id: 'r2', createdAt: new Date(NOW - 40 * DAY).toISOString() }),
            rec({ id: 'r3', createdAt: new Date(NOW - 400 * DAY).toISOString() }),
          ]}
        />
      );
      expect(screen.getAllByTestId('audit-cell-past-retention')).toHaveLength(2);
      expect(within(screen.getByTestId('audit-row-r1')).queryByTestId('audit-cell-past-retention')).not.toBeInTheDocument();
    });

    it.each([
      ['pending (no period approved)', { status: 'pending' } as RetentionPolicy],
      ['invalid', { status: 'invalid', raw: 'abc' } as RetentionPolicy],
      ['omitted entirely', undefined],
    ])('marks nothing when the policy is %s', (_label, retention) => {
      render(<AuditTable now={NOW} retention={retention} records={[rec({ createdAt: '2001-01-01T00:00:00Z' })]} />);
      expect(screen.queryByTestId('audit-cell-past-retention')).not.toBeInTheDocument();
    });

    it('never marks a record whose time cannot be read', () => {
      render(<AuditTable now={NOW} retention={approved(1)} records={[rec({ createdAt: 'garbage' })]} />);
      expect(screen.queryByTestId('audit-cell-past-retention')).not.toBeInTheDocument();
    });

    it('keeps the record fully visible and read-only when it is past retention', () => {
      render(
        <AuditTable now={NOW} retention={approved(1)} records={[rec({ id: 'old', createdAt: '2020-01-01T00:00:00Z' })]} />
      );
      expect(screen.getByTestId('audit-row-old')).toHaveTextContent('Repeated spam in pitch');
      expect(screen.getByRole('table').querySelector('button, input, select, form')).toBeNull();
    });
  });
});

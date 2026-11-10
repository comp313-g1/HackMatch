import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AuditFilters, type AuditFiltersProps } from './AuditFilters';
import { EMPTY_AUDIT_FILTERS } from './auditTypes';

function setup(over: Partial<AuditFiltersProps> = {}) {
  const props: AuditFiltersProps = {
    values: EMPTY_AUDIT_FILTERS,
    errors: {},
    busy: false,
    canClear: false,
    onChange: vi.fn(),
    onApply: vi.fn(),
    onClear: vi.fn(),
    ...over,
  };
  render(<AuditFilters {...props} />);
  return props;
}

describe('AuditFilters form (US-028 / #260)', () => {
  it('is a labelled search landmark with a labelled control for every filter', () => {
    setup();
    expect(screen.getByRole('search', { name: /filter audit records/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/actor \(administrator id\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^action type$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^category$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/from \(utc date\)/i)).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText(/to \(utc date\)/i)).toHaveAttribute('type', 'date');
  });

  it('offers category choices and action-type suggestions', () => {
    setup();
    const options = Array.from(screen.getByLabelText(/^category$/i).querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['All', 'Event', 'Moderation', 'Account']);
    const datalist = document.getElementById('audit-action-types')!;
    expect(datalist.querySelectorAll('option').length).toBeGreaterThan(3);
    expect(screen.getByLabelText(/^action type$/i)).toHaveAttribute('list', 'audit-action-types');
  });

  it('shows the values it is given', () => {
    setup({
      values: { actor: 'abc', actionType: 'account_suspend', category: 'account', from: '2026-11-01', to: '2026-11-03' },
    });
    expect(screen.getByTestId('audit-filter-actor')).toHaveValue('abc');
    expect(screen.getByTestId('audit-filter-actionType')).toHaveValue('account_suspend');
    expect(screen.getByTestId('audit-filter-category')).toHaveValue('account');
    expect(screen.getByTestId('audit-filter-from')).toHaveValue('2026-11-01');
    expect(screen.getByTestId('audit-filter-to')).toHaveValue('2026-11-03');
  });

  it('reports each edit through onChange', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByTestId('audit-filter-actor'), { target: { value: 'x' } });
    fireEvent.change(screen.getByTestId('audit-filter-actionType'), { target: { value: 'y' } });
    fireEvent.change(screen.getByTestId('audit-filter-category'), { target: { value: 'event' } });
    fireEvent.change(screen.getByTestId('audit-filter-from'), { target: { value: '2026-01-02' } });
    fireEvent.change(screen.getByTestId('audit-filter-to'), { target: { value: '2026-01-03' } });
    expect(vi.mocked(onChange).mock.calls.map((c) => c[0])).toEqual([
      { actor: 'x' },
      { actionType: 'y' },
      { category: 'event' },
      { from: '2026-01-02' },
      { to: '2026-01-03' },
    ]);
  });

  it('applies on submit (Enter key or button) and never reloads the page', () => {
    const { onApply } = setup();
    const form = screen.getByRole('search');
    const notPrevented = fireEvent.submit(form);
    expect(notPrevented).toBe(false); // default submit was prevented
    fireEvent.click(screen.getByTestId('audit-filter-apply'));
    expect(onApply).toHaveBeenCalledWith({ from: false, to: false });
  });

  it('reports date boxes the browser could not parse (half-typed dates)', () => {
    const { onApply } = setup();
    Object.defineProperty(screen.getByTestId('audit-filter-from'), 'validity', {
      configurable: true,
      value: { badInput: true },
    });
    fireEvent.submit(screen.getByRole('search'));
    expect(onApply).toHaveBeenCalledWith({ from: true, to: false });
  });

  it('clears via the clear button', () => {
    const { onClear } = setup({ canClear: true });
    fireEvent.click(screen.getByTestId('audit-filter-clear'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('disables Clear when there is nothing to clear and everything while busy', () => {
    setup({ canClear: false });
    expect(screen.getByTestId('audit-filter-clear')).toBeDisabled();
  });

  it('shows a busy state', () => {
    setup({ busy: true, canClear: true });
    expect(screen.getByTestId('audit-filter-apply')).toBeDisabled();
    expect(screen.getByTestId('audit-filter-apply')).toHaveTextContent(/applying/i);
    expect(screen.getByTestId('audit-filter-clear')).toBeDisabled();
  });

  it('announces each error beside its field and links it to the control (accessibility)', () => {
    setup({ errors: { actor: 'Bad actor.', from: 'Bad date.' } });
    const actor = screen.getByTestId('audit-filter-actor');
    expect(actor).toHaveAttribute('aria-invalid', 'true');
    expect(actor).toHaveAttribute('aria-describedby', 'audit-filter-actor-error');
    expect(screen.getByTestId('audit-filter-actor-error')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('audit-filter-from-error')).toHaveTextContent('Bad date.');
    expect(screen.getByTestId('audit-filter-to')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByTestId('audit-filter-actionType-error')).not.toBeInTheDocument();
  });

  it('does not use native validation that would block the custom messages', () => {
    setup();
    expect(screen.getByRole('search')).toHaveAttribute('novalidate');
  });
});

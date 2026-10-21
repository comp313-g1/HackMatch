import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AccountsListView } from './AccountsListView';
import type { AdminAccountListItem } from './accountTypes';

const account: AdminAccountListItem = {
  accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  role: 'PART',
  state: 'Active',
  isVerified: true,
  suspendedAt: null,
  suspensionReason: null,
  deactivatedAt: null,
  deactivationReason: null,
  createdAt: '2026-10-18T00:00:00.000Z',
  handle: 'ada',
};

const baseProps = {
  accounts: [] as AdminAccountListItem[],
  listState: 'success' as const,
  listError: null as string | null,
  selectedAccountId: null as string | null,
  searchQ: '',
  stateFilter: '' as const,
  roleFilter: '' as const,
  onSearchQChange: vi.fn(),
  onStateFilterChange: vi.fn(),
  onRoleFilterChange: vi.fn(),
  onApplyFilters: vi.fn(),
  onSelect: vi.fn(),
  onRetry: vi.fn(),
};

describe('AccountsListView (US-027 / #255)', () => {
  it('shows loading state when no rows are available', () => {
    render(<AccountsListView {...baseProps} listState="loading" accounts={[]} />);
    expect(screen.getByTestId('accounts-list-loading')).toHaveTextContent(/Loading accounts/);
  });

  it('shows empty state when filters match nothing', () => {
    render(<AccountsListView {...baseProps} listState="success" accounts={[]} />);
    expect(screen.getByTestId('accounts-list-empty')).toHaveTextContent(/No accounts match/);
  });

  it('shows error and keeps filter draft values', () => {
    render(
      <AccountsListView
        {...baseProps}
        listState="error"
        listError="Server down"
        searchQ="ada"
        stateFilter="Suspended"
        roleFilter="PART"
        accounts={[account]}
      />
    );
    expect(screen.getByTestId('accounts-list-error')).toHaveTextContent(/Server down/);
    expect(screen.getByTestId('accounts-list-error')).toHaveTextContent(/filters/);
    expect(screen.getByTestId('accounts-search-q')).toHaveValue('ada');
    expect(screen.getByTestId('accounts-state-filter')).toHaveValue('Suspended');
    expect(screen.getByTestId('accounts-role-filter')).toHaveValue('PART');
    expect(screen.getByTestId('accounts-list')).toBeInTheDocument();
  });

  it('lists accounts and notifies selection', () => {
    const onSelect = vi.fn();
    render(
      <AccountsListView {...baseProps} accounts={[account]} onSelect={onSelect} />
    );
    fireEvent.click(screen.getByTestId(`account-row-${account.accountId}`));
    expect(onSelect).toHaveBeenCalledWith(account.accountId);
    expect(screen.getByTestId(`account-state-${account.accountId}`)).toHaveTextContent('Active');
  });

  it('applies search, state, and role filters', () => {
    const onApplyFilters = vi.fn();
    const onSearchQChange = vi.fn();
    const onStateFilterChange = vi.fn();
    const onRoleFilterChange = vi.fn();
    render(
      <AccountsListView
        {...baseProps}
        onApplyFilters={onApplyFilters}
        onSearchQChange={onSearchQChange}
        onStateFilterChange={onStateFilterChange}
        onRoleFilterChange={onRoleFilterChange}
      />
    );

    fireEvent.change(screen.getByTestId('accounts-search-q'), {
      target: { value: 'ada' },
    });
    fireEvent.change(screen.getByTestId('accounts-state-filter'), {
      target: { value: 'Active' },
    });
    fireEvent.change(screen.getByTestId('accounts-role-filter'), {
      target: { value: 'PART' },
    });
    fireEvent.click(screen.getByTestId('accounts-search-submit'));

    expect(onSearchQChange).toHaveBeenCalledWith('ada');
    expect(onStateFilterChange).toHaveBeenCalledWith('Active');
    expect(onRoleFilterChange).toHaveBeenCalledWith('PART');
    expect(onApplyFilters).toHaveBeenCalled();
  });
});

import React from 'react';
import type {
  AccountRole,
  AccountState,
  AccountsListState,
  AdminAccountListItem,
} from './accountTypes';

export interface AccountsListViewProps {
  accounts: AdminAccountListItem[];
  listState: AccountsListState;
  listError: string | null;
  selectedAccountId: string | null;
  searchQ: string;
  stateFilter: AccountState | '';
  roleFilter: AccountRole | '';
  onSearchQChange: (value: string) => void;
  onStateFilterChange: (value: AccountState | '') => void;
  onRoleFilterChange: (value: AccountRole | '') => void;
  onApplyFilters: () => void;
  onSelect: (accountId: string) => void;
  onRetry: () => void;
}

/**
 * ADMIN account list with search/state/role filters (US-027 / #255 / AC 1).
 * Loading, empty, error, and success states; selection opens detail + reason forms.
 */
export function AccountsListView({
  accounts,
  listState,
  listError,
  selectedAccountId,
  searchQ,
  stateFilter,
  roleFilter,
  onSearchQChange,
  onStateFilterChange,
  onRoleFilterChange,
  onApplyFilters,
  onSelect,
  onRetry,
}: AccountsListViewProps): React.JSX.Element {
  return (
    <div className="space-y-3" data-testid="accounts-list-view" aria-label="Account list">
      <form
        className="flex flex-wrap gap-2 items-end"
        data-testid="accounts-search-form"
        onSubmit={(e) => {
          e.preventDefault();
          onApplyFilters();
        }}
      >
        <div className="flex-1 min-w-[10rem]">
          <label htmlFor="accounts-q" className="block text-xs font-medium text-forest-900">
            Search
          </label>
          <input
            id="accounts-q"
            data-testid="accounts-search-q"
            type="search"
            value={searchQ}
            onChange={(e) => onSearchQChange(e.target.value)}
            placeholder="Email, name, or handle"
            className="mt-1 block w-full rounded-md border border-cream-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label htmlFor="accounts-state" className="block text-xs font-medium text-forest-900">
            State
          </label>
          <select
            id="accounts-state"
            data-testid="accounts-state-filter"
            value={stateFilter}
            onChange={(e) => onStateFilterChange(e.target.value as AccountState | '')}
            className="mt-1 block rounded-md border border-cream-300 px-2 py-1.5 text-sm"
          >
            <option value="">All</option>
            <option value="Active">Active</option>
            <option value="Suspended">Suspended</option>
            <option value="Deactivated">Deactivated</option>
          </select>
        </div>
        <div>
          <label htmlFor="accounts-role" className="block text-xs font-medium text-forest-900">
            Role
          </label>
          <select
            id="accounts-role"
            data-testid="accounts-role-filter"
            value={roleFilter}
            onChange={(e) => onRoleFilterChange(e.target.value as AccountRole | '')}
            className="mt-1 block rounded-md border border-cream-300 px-2 py-1.5 text-sm"
          >
            <option value="">All</option>
            <option value="PART">PART</option>
            <option value="ADMIN">ADMIN</option>
          </select>
        </div>
        <button
          type="submit"
          data-testid="accounts-search-submit"
          className="px-3 py-1.5 text-xs font-medium border border-cream-300 rounded bg-white hover:bg-cream-50"
        >
          Apply
        </button>
      </form>

      {listState === 'loading' && accounts.length === 0 ? (
        <p role="status" className="text-sm text-ink-muted" data-testid="accounts-list-loading">
          Loading accounts…
        </p>
      ) : null}

      {listState === 'loading' && accounts.length > 0 ? (
        <p role="status" className="text-xs text-ink-muted" data-testid="accounts-list-refreshing">
          Refreshing accounts…
        </p>
      ) : null}

      {listState === 'error' ? (
        <div
          role="alert"
          className="p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md space-y-2"
          data-testid="accounts-list-error"
        >
          <p>{listError || 'Could not load accounts.'}</p>
          <p className="text-xs">Your search filters and previous results were kept when available.</p>
          <button
            type="button"
            onClick={onRetry}
            className="px-2 py-1 text-xs border border-red-200 rounded bg-white"
          >
            Retry
          </button>
        </div>
      ) : null}

      {listState === 'success' && accounts.length === 0 ? (
        <p
          role="status"
          className="p-4 text-sm text-ink-muted border border-dashed border-cream-300 rounded-md"
          data-testid="accounts-list-empty"
        >
          No accounts match these filters.
        </p>
      ) : null}

      {accounts.length > 0 ? (
        <ul
          className="divide-y divide-cream-200 border border-cream-200 rounded-md bg-white"
          data-testid="accounts-list"
        >
          {accounts.map((row) => {
            const selected = row.accountId === selectedAccountId;
            return (
              <li key={row.accountId}>
                <button
                  type="button"
                  data-testid={`account-row-${row.accountId}`}
                  onClick={() => onSelect(row.accountId)}
                  className={`w-full text-left px-3 py-2.5 text-sm hover:bg-cream-50 ${
                    selected ? 'bg-cream-100' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-forest-900">
                      {row.handle ? `@${row.handle}` : row.fullName}
                    </span>
                    <span
                      className="text-xs font-medium text-ink-muted"
                      data-testid={`account-state-${row.accountId}`}
                    >
                      {row.state}
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted truncate">{row.email}</p>
                  <p className="text-xs text-ink-muted">
                    {row.role}
                    {row.isVerified ? ' · verified' : ' · unverified'}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

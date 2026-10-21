import React, { useCallback, useEffect, useState } from 'react';
import {
  AccountsApiError,
  AuthRequiredError,
  deleteAdminAccount,
  fetchAdminAccountDetail,
  fetchAdminAccounts,
  formatCascadeSuccess,
  formatDeletionSuccess,
  probeAdminAccountsAccess,
  suspendAdminAccount,
} from './accountsApi';
import { SuspendAccountForm } from './SuspendAccountForm';
import { DeleteAccountForm } from './DeleteAccountForm';
import type {
  AccountState,
  AccountsAccessState,
  AccountsDetailState,
  AccountsFieldErrors,
  AccountsListState,
  AdminAccountDetail,
  AdminAccountListItem,
} from './accountTypes';

export interface AccountEnforcementPageProps {
  onNavigateAway?: () => void;
}

/**
 * ADMIN account inspection, suspension cascade, and ownership-verified deletion
 * (US-027 / #248–#252). Form values are preserved when validation fails (NR-017).
 */
export function AccountEnforcementPage({
  onNavigateAway,
}: AccountEnforcementPageProps): React.JSX.Element {
  const [accessState, setAccessState] = useState<AccountsAccessState>('loading');
  const [accessError, setAccessError] = useState<string | null>(null);

  const [listState, setListState] = useState<AccountsListState>('loading');
  const [accounts, setAccounts] = useState<AdminAccountListItem[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [stateFilter, setStateFilter] = useState<AccountState | ''>('');
  const [appliedQ, setAppliedQ] = useState('');
  const [appliedState, setAppliedState] = useState<AccountState | ''>('');

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<AccountsDetailState>('idle');
  const [detail, setDetail] = useState<AdminAccountDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [suspending, setSuspending] = useState(false);
  const [suspendFieldErrors, setSuspendFieldErrors] = useState<AccountsFieldErrors>({});
  const [suspendFormError, setSuspendFormError] = useState<string | null>(null);
  const [suspendSuccess, setSuspendSuccess] = useState<string | null>(null);

  const [deleting, setDeleting] = useState(false);
  const [deleteFieldErrors, setDeleteFieldErrors] = useState<AccountsFieldErrors>({});
  const [deleteFormError, setDeleteFormError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);

  const checkAccess = useCallback(async () => {
    setAccessState('loading');
    setAccessError(null);
    try {
      const result = await probeAdminAccountsAccess();
      setAccessState(result === 'granted' ? 'granted' : 'denied');
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setAccessState('denied');
        setAccessError('You need to sign in as an administrator.');
      } else if (err instanceof AccountsApiError) {
        setAccessState('error');
        setAccessError(err.message);
      } else {
        setAccessState('error');
        setAccessError('Could not verify administrator access.');
      }
    }
  }, []);

  const loadList = useCallback(async (filters?: { q?: string; state?: AccountState | '' }) => {
    const q = filters?.q ?? appliedQ;
    const state = filters?.state ?? appliedState;
    setListState('loading');
    setListError(null);
    try {
      const rows = await fetchAdminAccounts({
        ...(q.trim() ? { q: q.trim() } : {}),
        ...(state ? { state } : {}),
      });
      setAccounts(rows);
      setListState('success');
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setListError('You need to sign in to view accounts.');
      } else if (err instanceof AccountsApiError) {
        if (err.status === 403 || err.code === 'FORBIDDEN_ROLE') {
          setAccessState('denied');
        }
        setListError(err.message || 'Could not load accounts.');
      } else {
        setListError('Could not load accounts.');
      }
      setListState('error');
    }
  }, [appliedQ, appliedState]);

  const loadDetail = useCallback(async (accountId: string) => {
    setDetailState('loading');
    setDetailError(null);
    try {
      const data = await fetchAdminAccountDetail(accountId);
      setDetail(data);
      setDetailState('success');
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setDetailError('You need to sign in to view this account.');
      } else if (err instanceof AccountsApiError) {
        setDetailError(err.message || 'Could not load this account.');
      } else {
        setDetailError('Could not load this account.');
      }
      setDetailState('error');
    }
  }, []);

  useEffect(() => {
    void checkAccess();
  }, [checkAccess]);

  useEffect(() => {
    if (accessState === 'granted') {
      void loadList();
    }
  }, [accessState, loadList]);

  const handleSelect = (accountId: string) => {
    setSelectedAccountId(accountId);
    setSuspendFieldErrors({});
    setSuspendFormError(null);
    setSuspendSuccess(null);
    setDeleteFieldErrors({});
    setDeleteFormError(null);
    setDeleteSuccess(null);
    void loadDetail(accountId);
  };

  const handleSuspend = async (input: { reason: string }) => {
    if (!selectedAccountId) return;
    setSuspending(true);
    setSuspendFieldErrors({});
    setSuspendFormError(null);
    setSuspendSuccess(null);
    try {
      const result = await suspendAdminAccount(selectedAccountId, input);
      setSuspendSuccess(formatCascadeSuccess(result));
      setAccounts((prev) =>
        prev.map((a) => (a.accountId === result.account.accountId ? result.account : a))
      );
      setDetail((prev) =>
        prev && prev.account.accountId === result.account.accountId
          ? { ...prev, account: result.account }
          : prev
      );
      void loadDetail(result.account.accountId);
      void loadList();
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setSuspendFormError('You need to sign in as an administrator.');
      } else if (err instanceof AccountsApiError) {
        if (err.errors) setSuspendFieldErrors(err.errors);
        setSuspendFormError(
          err.message || 'Could not suspend the account. Your entered reason was kept.'
        );
      } else {
        setSuspendFormError('Could not suspend the account. Your entered reason was kept.');
      }
    } finally {
      setSuspending(false);
    }
  };

  const handleDelete = async (input: { reason: string; ownershipVerified: true }) => {
    if (!selectedAccountId) return;
    setDeleting(true);
    setDeleteFieldErrors({});
    setDeleteFormError(null);
    setDeleteSuccess(null);
    try {
      const result = await deleteAdminAccount(selectedAccountId, input);
      setDeleteSuccess(formatDeletionSuccess(result));
      setAccounts((prev) =>
        prev.map((a) => (a.accountId === result.account.accountId ? result.account : a))
      );
      setDetail((prev) =>
        prev && prev.account.accountId === result.account.accountId
          ? { ...prev, account: result.account }
          : prev
      );
      void loadDetail(result.account.accountId);
      void loadList();
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setDeleteFormError('You need to sign in as an administrator.');
      } else if (err instanceof AccountsApiError) {
        if (err.errors) setDeleteFieldErrors(err.errors);
        if (err.code === 'UNLOCKED_OWNER_MUST_DISBAND') {
          setDeleteFormError(
            err.message ||
              'Deletion is blocked until the owner disbands unlocked teams. Your entered values were kept.'
          );
        } else {
          setDeleteFormError(
            err.message || 'Could not process deletion. Your entered values were kept.'
          );
        }
      } else {
        setDeleteFormError('Could not process deletion. Your entered values were kept.');
      }
    } finally {
      setDeleting(false);
    }
  };

  if (accessState === 'loading') {
    return (
      <div className="max-w-5xl mx-auto" data-testid="accounts-access-loading">
        <p role="status" className="text-sm text-forest-800">
          Checking administrator access…
        </p>
      </div>
    );
  }

  if (accessState === 'denied') {
    return (
      <div
        className="max-w-lg mx-auto p-6 bg-white rounded-xl border border-cream-200 shadow-sm space-y-3"
        data-testid="accounts-access-denied"
      >
        <h2 className="font-display text-xl font-semibold text-forest-900">Account enforcement</h2>
        <div role="alert" className="p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md">
          {accessError ||
            'Access denied. Only platform administrators can manage accounts.'}
        </div>
        {onNavigateAway ? (
          <button
            type="button"
            onClick={onNavigateAway}
            className="text-sm font-medium text-forest-800 hover:underline"
          >
            ← Back
          </button>
        ) : null}
      </div>
    );
  }

  if (accessState === 'error') {
    return (
      <div
        className="max-w-lg mx-auto p-6 bg-white rounded-xl border border-cream-200 space-y-3"
        data-testid="accounts-access-error"
      >
        <div role="alert" className="text-sm text-red-800">
          {accessError}
        </div>
        <button
          type="button"
          onClick={() => void checkAccess()}
          className="px-3 py-1.5 text-xs font-medium border border-red-200 rounded bg-white hover:bg-red-50"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6" data-testid="account-enforcement-page">
      <header className="space-y-1">
        <h2 className="font-display text-2xl font-semibold text-forest-900">Account enforcement</h2>
        <p className="text-sm text-ink-muted">
          Inspect account status and suspend non-compliant accounts. Credentials, OTPs, and private
          team notes are never shown.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="accounts-list-heading" className="space-y-3">
          <h3 id="accounts-list-heading" className="text-sm font-semibold text-forest-900">
            Accounts
          </h3>

          <form
            className="flex flex-wrap gap-2 items-end"
            data-testid="accounts-search-form"
            onSubmit={(e) => {
              e.preventDefault();
              setAppliedQ(searchQ);
              setAppliedState(stateFilter);
              void loadList({ q: searchQ, state: stateFilter });
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
                onChange={(e) => setSearchQ(e.target.value)}
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
                onChange={(e) => setStateFilter(e.target.value as AccountState | '')}
                className="mt-1 block rounded-md border border-cream-300 px-2 py-1.5 text-sm"
              >
                <option value="">All</option>
                <option value="Active">Active</option>
                <option value="Suspended">Suspended</option>
                <option value="Deactivated">Deactivated</option>
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

          {listState === 'loading' ? (
            <p role="status" className="text-sm text-ink-muted" data-testid="accounts-list-loading">
              Loading accounts…
            </p>
          ) : null}

          {listState === 'error' ? (
            <div
              role="alert"
              className="p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md space-y-2"
              data-testid="accounts-list-error"
            >
              <p>{listError}</p>
              <button
                type="button"
                onClick={() => void loadList()}
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

          {listState === 'success' && accounts.length > 0 ? (
            <ul className="divide-y divide-cream-200 border border-cream-200 rounded-md bg-white" data-testid="accounts-list">
              {accounts.map((row) => {
                const selected = row.accountId === selectedAccountId;
                return (
                  <li key={row.accountId}>
                    <button
                      type="button"
                      data-testid={`account-row-${row.accountId}`}
                      onClick={() => handleSelect(row.accountId)}
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
        </section>

        <section aria-labelledby="account-detail-heading" className="space-y-3">
          <h3 id="account-detail-heading" className="text-sm font-semibold text-forest-900">
            Account detail
          </h3>

          {detailState === 'idle' ? (
            <p
              role="status"
              className="p-4 text-sm text-ink-muted border border-dashed border-cream-300 rounded-md"
              data-testid="account-detail-idle"
            >
              Select an account to inspect status, profile visibility, and relevant listings.
            </p>
          ) : null}

          {detailState === 'loading' ? (
            <p role="status" className="text-sm text-ink-muted" data-testid="account-detail-loading">
              Loading account…
            </p>
          ) : null}

          {detailState === 'error' ? (
            <div
              role="alert"
              className="p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md space-y-2"
              data-testid="account-detail-error"
            >
              <p>{detailError}</p>
              <button
                type="button"
                onClick={() => {
                  if (selectedAccountId) void loadDetail(selectedAccountId);
                }}
                className="px-2 py-1 text-xs border border-red-200 rounded bg-white"
              >
                Retry
              </button>
            </div>
          ) : null}

          {detailState === 'success' && detail ? (
            <div
              className="space-y-3 rounded-md border border-cream-200 bg-white p-4"
              data-testid="account-detail"
            >
              <div className="space-y-1">
                <p className="text-sm font-semibold text-forest-900" data-testid="account-detail-name">
                  {detail.account.fullName}
                </p>
                <p className="text-xs text-ink-muted" data-testid="account-detail-email">
                  {detail.account.email}
                </p>
                <p className="text-xs text-ink-muted">
                  Role: {detail.account.role} · State:{' '}
                  <span data-testid="account-detail-state">{detail.account.state}</span>
                </p>
                {detail.account.suspensionReason ? (
                  <p className="text-xs text-ink-muted" data-testid="account-detail-suspension-reason">
                    Suspension reason: {detail.account.suspensionReason}
                  </p>
                ) : null}
              </div>

              <div
                className="text-xs text-ink-muted border-t border-cream-100 pt-2"
                data-testid="account-privacy-notice"
              >
                {detail.privacy.notice}
              </div>

              {detail.profile ? (
                <div data-testid="account-profile-summary" className="text-xs space-y-0.5">
                  <p className="font-medium text-forest-900">Profile</p>
                  <p>
                    Handle: {detail.profile.handle ? `@${detail.profile.handle}` : '—'} · Moderation:{' '}
                    {detail.profile.moderationStatus}
                  </p>
                  <p>
                    Role: {detail.profile.primaryRole || '—'} · Institution:{' '}
                    {detail.profile.institution || '—'}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-ink-muted" data-testid="account-profile-missing">
                  No profile on file.
                </p>
              )}

              <div data-testid="account-listings">
                <p className="text-xs font-medium text-forest-900 mb-1">Relevant listings</p>
                {detail.relevantListings.length === 0 ? (
                  <p className="text-xs text-ink-muted" data-testid="account-listings-empty">
                    No team memberships or owned listings.
                  </p>
                ) : (
                  <ul className="text-xs space-y-1">
                    {detail.relevantListings.map((listing) => (
                      <li key={listing.teamId} data-testid={`account-listing-${listing.teamId}`}>
                        {listing.teamName} · {listing.membershipRole} · {listing.recruitmentStatus}
                        {listing.lockedAt ? ' · locked' : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          <SuspendAccountForm
            accountId={selectedAccountId}
            accountState={detail?.account.state ?? null}
            submitting={suspending}
            fieldErrors={suspendFieldErrors}
            formError={suspendFormError}
            successNotice={suspendSuccess}
            onSubmit={handleSuspend}
          />

          <DeleteAccountForm
            accountId={selectedAccountId}
            accountState={detail?.account.state ?? null}
            submitting={deleting}
            fieldErrors={deleteFieldErrors}
            formError={deleteFormError}
            successNotice={deleteSuccess}
            onSubmit={handleDelete}
          />
        </section>
      </div>
    </div>
  );
}

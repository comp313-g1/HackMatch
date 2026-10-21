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
import { AccountsListView } from './AccountsListView';
import { AccountDetailView } from './AccountDetailView';
import { SuspendAccountForm } from './SuspendAccountForm';
import { DeleteAccountForm } from './DeleteAccountForm';
import type {
  AccountRole,
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
 * ADMIN account enforcement views + mandatory reason forms
 * (US-027 / #255). Form values are preserved when validation fails (NR-017).
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
  const [roleFilter, setRoleFilter] = useState<AccountRole | ''>('');
  const [appliedQ, setAppliedQ] = useState('');
  const [appliedState, setAppliedState] = useState<AccountState | ''>('');
  const [appliedRole, setAppliedRole] = useState<AccountRole | ''>('');

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

  const loadList = useCallback(
    async (filters?: { q?: string; state?: AccountState | ''; role?: AccountRole | '' }) => {
      const q = filters?.q ?? appliedQ;
      const state = filters?.state ?? appliedState;
      const role = filters?.role ?? appliedRole;
      setListState('loading');
      setListError(null);
      try {
        const rows = await fetchAdminAccounts({
          ...(q.trim() ? { q: q.trim() } : {}),
          ...(state ? { state } : {}),
          ...(role ? { role } : {}),
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
    },
    [appliedQ, appliedState, appliedRole]
  );

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

  const clearEnforcementNotices = () => {
    setSuspendFieldErrors({});
    setSuspendFormError(null);
    setSuspendSuccess(null);
    setDeleteFieldErrors({});
    setDeleteFormError(null);
    setDeleteSuccess(null);
  };

  const handleSelect = (accountId: string) => {
    setSelectedAccountId(accountId);
    clearEnforcementNotices();
    void loadDetail(accountId);
  };

  const handleClearSelection = () => {
    setSelectedAccountId(null);
    setDetail(null);
    setDetailState('idle');
    setDetailError(null);
    clearEnforcementNotices();
  };

  const handleApplyFilters = () => {
    setAppliedQ(searchQ);
    setAppliedState(stateFilter);
    setAppliedRole(roleFilter);
    void loadList({ q: searchQ, state: stateFilter, role: roleFilter });
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
          Inspect account status and suspend or delete non-compliant accounts. Credentials, OTPs,
          and private team notes are never shown. Public ADMIN self-promotion is prohibited.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="accounts-list-heading" className="space-y-3">
          <h3 id="accounts-list-heading" className="text-sm font-semibold text-forest-900">
            Accounts
          </h3>
          <AccountsListView
            accounts={accounts}
            listState={listState}
            listError={listError}
            selectedAccountId={selectedAccountId}
            searchQ={searchQ}
            stateFilter={stateFilter}
            roleFilter={roleFilter}
            onSearchQChange={setSearchQ}
            onStateFilterChange={setStateFilter}
            onRoleFilterChange={setRoleFilter}
            onApplyFilters={handleApplyFilters}
            onSelect={handleSelect}
            onRetry={() => void loadList()}
          />
        </section>

        <section aria-labelledby="account-detail-heading" className="space-y-3">
          <h3 id="account-detail-heading" className="text-sm font-semibold text-forest-900">
            Account detail
          </h3>

          <AccountDetailView
            detail={detail}
            detailState={detailState}
            detailError={detailError}
            onRetry={() => {
              if (selectedAccountId) void loadDetail(selectedAccountId);
            }}
            onClearSelection={handleClearSelection}
          />

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

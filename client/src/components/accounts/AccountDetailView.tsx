import React from 'react';
import type { AccountsDetailState, AdminAccountDetail } from './accountTypes';

export interface AccountDetailViewProps {
  detail: AdminAccountDetail | null;
  detailState: AccountsDetailState;
  detailError: string | null;
  onRetry: () => void;
  onClearSelection?: () => void;
}

/**
 * ADMIN account inspection panel (US-027 / #255 / AC 1).
 * Idle, loading, error, and success states; never shows credentials, OTPs, or private notes.
 */
export function AccountDetailView({
  detail,
  detailState,
  detailError,
  onRetry,
  onClearSelection,
}: AccountDetailViewProps): React.JSX.Element {
  if (detailState === 'idle') {
    return (
      <p
        role="status"
        className="p-4 text-sm text-ink-muted border border-dashed border-cream-300 rounded-md"
        data-testid="account-detail-idle"
      >
        Select an account to inspect status, profile visibility, and relevant listings.
      </p>
    );
  }

  if (detailState === 'loading' && !detail) {
    return (
      <p role="status" className="text-sm text-ink-muted" data-testid="account-detail-loading">
        Loading account…
      </p>
    );
  }

  if (detailState === 'error' && !detail) {
    return (
      <div
        role="alert"
        className="p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md space-y-2"
        data-testid="account-detail-error"
      >
        <p>{detailError || 'Could not load this account.'}</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-2 py-1 text-xs border border-red-200 rounded bg-white"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!detail) {
    return (
      <p role="status" className="text-sm text-ink-muted" data-testid="account-detail-idle">
        Select an account to inspect status, profile visibility, and relevant listings.
      </p>
    );
  }

  return (
    <div
      className="space-y-3 rounded-md border border-cream-200 bg-white p-4"
      data-testid="account-detail"
    >
      {detailState === 'loading' ? (
        <p role="status" className="text-xs text-ink-muted" data-testid="account-detail-refreshing">
          Refreshing account…
        </p>
      ) : null}

      {detailState === 'error' && detailError ? (
        <div
          role="alert"
          className="text-xs text-red-800 space-y-1"
          data-testid="account-detail-inline-error"
        >
          <p>{detailError}</p>
          <button
            type="button"
            onClick={onRetry}
            className="px-2 py-1 text-xs border border-red-200 rounded bg-white"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-forest-900" data-testid="account-detail-name">
            {detail.account.fullName}
          </p>
          {onClearSelection ? (
            <button
              type="button"
              onClick={onClearSelection}
              className="text-xs font-medium text-forest-800 hover:underline"
              data-testid="account-detail-clear"
            >
              Clear
            </button>
          ) : null}
        </div>
        <p className="text-xs text-ink-muted" data-testid="account-detail-email">
          {detail.account.email}
        </p>
        <p className="text-xs text-ink-muted">
          Role: {detail.account.role} · State:{' '}
          <span data-testid="account-detail-state">{detail.account.state}</span>
          {detail.account.isVerified ? ' · verified' : ' · unverified'}
        </p>
        {detail.account.suspensionReason ? (
          <p className="text-xs text-ink-muted" data-testid="account-detail-suspension-reason">
            Suspension reason: {detail.account.suspensionReason}
          </p>
        ) : null}
        {detail.account.deactivationReason ? (
          <p className="text-xs text-ink-muted" data-testid="account-detail-deactivation-reason">
            Deactivation reason: {detail.account.deactivationReason}
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
  );
}

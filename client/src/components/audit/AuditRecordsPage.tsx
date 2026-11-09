import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AuditApiError, AuthRequiredError, fetchAuditRecords } from './auditApi';
import { AuditTable } from './AuditTable';
import { AUDIT_PAGE_SIZE, type AuditRecord } from './auditTypes';

export interface AuditRecordsPageProps {
  onNavigateAway?: () => void;
}

type PageState = 'loading' | 'ready' | 'denied' | 'error';

function describeError(err: unknown, fallback: string): { message: string; denied: boolean } {
  if (err instanceof AuthRequiredError) {
    return { message: 'You need to sign in as an administrator to review audit records.', denied: true };
  }
  if (err instanceof AuditApiError) {
    if (err.status === 401) {
      return { message: 'Your session has expired. Please sign in again.', denied: true };
    }
    if (err.status === 403) {
      return {
        message: 'Access denied. Only platform administrators can review audit records.',
        denied: true,
      };
    }
    if (err.status === 0) {
      return { message: 'Network error. Check your connection and try again.', denied: false };
    }
    return { message: err.message || fallback, denied: false };
  }
  return { message: fallback, denied: false };
}

/**
 * ADMIN audit-record review (US-028 / #259). Read-only table of event, moderation and
 * account action records with loading, empty, error and access-denied states. Records
 * that were already loaded are kept when a later refresh or "load more" fails.
 */
export function AuditRecordsPage({ onNavigateAway }: AuditRecordsPageProps): React.JSX.Element {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const seq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** (Re)loads the newest page. Existing rows stay visible if this fails. */
  const load = useCallback(async (initial: boolean) => {
    const mine = ++seq.current;
    if (initial) setPageState('loading');
    else setRefreshing(true);
    setInlineError(null);
    try {
      const page = await fetchAuditRecords({ limit: AUDIT_PAGE_SIZE });
      if (!mounted.current || mine !== seq.current) return;
      setRecords(page.records);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setMessage(null);
      setPageState('ready');
    } catch (err: unknown) {
      if (!mounted.current || mine !== seq.current) return;
      const { message: text, denied } = describeError(err, 'Could not load audit records.');
      if (denied) {
        setRecords([]);
        setMessage(text);
        setPageState('denied');
      } else if (initial) {
        setMessage(text);
        setPageState('error');
      } else {
        setInlineError(text);
      }
    } finally {
      if (mounted.current && mine === seq.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setInlineError(null);
    try {
      const page = await fetchAuditRecords({ limit: AUDIT_PAGE_SIZE, cursor: nextCursor });
      if (!mounted.current) return;
      setRecords((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...page.records.filter((r) => !seen.has(r.id))];
      });
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (err: unknown) {
      if (!mounted.current) return;
      const { message: text, denied } = describeError(err, 'Could not load more records.');
      if (denied) {
        setRecords([]);
        setMessage(text);
        setPageState('denied');
      } else {
        setInlineError(text);
      }
    } finally {
      if (mounted.current) setLoadingMore(false);
    }
  };

  if (pageState === 'loading') {
    return (
      <div className="max-w-6xl mx-auto" data-testid="audit-loading">
        <p role="status" aria-busy="true" className="text-sm text-forest-800">
          Loading audit records…
        </p>
      </div>
    );
  }

  if (pageState === 'denied') {
    return (
      <div
        className="max-w-lg mx-auto p-6 bg-white rounded-xl border border-cream-200 shadow-sm space-y-3"
        data-testid="audit-denied"
      >
        <h2 className="font-display text-xl font-semibold text-forest-900">Audit records</h2>
        <div role="alert" className="p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md">
          {message}
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

  if (pageState === 'error') {
    return (
      <div
        className="max-w-lg mx-auto p-6 bg-white rounded-xl border border-cream-200 space-y-3"
        data-testid="audit-error"
      >
        <h2 className="font-display text-xl font-semibold text-forest-900">Audit records</h2>
        <div role="alert" className="text-sm text-red-800">
          {message}
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          className="px-3 py-1.5 text-xs font-medium border border-red-200 rounded bg-white hover:bg-red-50"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4" data-testid="audit-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-2xl font-semibold text-forest-900">Audit records</h2>
          <p className="text-sm text-ink-muted">
            Read-only history of event, moderation and account administrative actions, newest first.
            Records are append-only and cannot be edited or deleted. Credentials and private contacts
            are never shown. Times are in UTC.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(false)}
          disabled={refreshing}
          className="px-3 py-1.5 text-xs font-medium border border-cream-300 rounded bg-white hover:bg-cream-50 disabled:opacity-50"
          data-testid="audit-refresh"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {inlineError ? (
        <div
          role="alert"
          className="p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md"
          data-testid="audit-inline-error"
        >
          {inlineError} The records already loaded are still shown.
        </div>
      ) : null}

      {records.length === 0 ? (
        <p
          role="status"
          className="p-4 text-sm text-ink-muted border border-dashed border-cream-300 rounded-md"
          data-testid="audit-empty"
        >
          No administrative action records yet. Moderation, account and event actions will appear
          here once an administrator takes one.
        </p>
      ) : (
        <>
          <p className="text-xs text-ink-muted" data-testid="audit-count" aria-live="polite">
            Showing {records.length} record{records.length === 1 ? '' : 's'}
            {hasMore ? ' — more available' : ''}.
          </p>
          <AuditTable records={records} />
          {hasMore && nextCursor ? (
            <div className="text-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="px-3 py-1.5 text-sm font-medium border border-cream-300 rounded bg-white hover:bg-cream-50 disabled:opacity-50"
                data-testid="audit-load-more"
              >
                {loadingMore ? 'Loading…' : 'Load older records'}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AuditApiError, AuthRequiredError, fetchAuditRecords } from './auditApi';
import { AuditFilters } from './AuditFilters';
import {
  hasActiveAuditFilters,
  normalizeAuditFilters,
  validateAuditFilters,
} from './auditFilterValidation';
import { AuditTable } from './AuditTable';
import {
  AUDIT_CATEGORY_LABELS,
  AUDIT_PAGE_SIZE,
  EMPTY_AUDIT_FILTERS,
  type AuditFilterErrors,
  type AuditFilters as AuditFilterValues,
  type AuditQueryParams,
  type AuditRecord,
} from './auditTypes';

export interface AuditRecordsPageProps {
  onNavigateAway?: () => void;
}

type PageState = 'loading' | 'ready' | 'denied' | 'error';

const INCOMPLETE_DATE_MESSAGE = 'Enter a complete, real date (day, month and year).';

const FILTER_KEYS: Array<keyof AuditFilterValues> = ['actor', 'actionType', 'category', 'from', 'to'];

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

/** Only non-empty filters are sent, so an unfiltered request stays { limit }. */
function toParams(filters: AuditFilterValues, extra: AuditQueryParams = {}): AuditQueryParams {
  const params: AuditQueryParams = { limit: AUDIT_PAGE_SIZE, ...extra };
  for (const key of FILTER_KEYS) {
    if (filters[key]) (params as Record<string, string>)[key] = filters[key];
  }
  return params;
}

function describeFilters(filters: AuditFilterValues): string[] {
  const parts: string[] = [];
  if (filters.actor) parts.push(`Actor ${filters.actor}`);
  if (filters.actionType) parts.push(`Action type ${filters.actionType}`);
  if (filters.category) parts.push(`Category ${AUDIT_CATEGORY_LABELS[filters.category]}`);
  if (filters.from) parts.push(`From ${filters.from} (UTC)`);
  if (filters.to) parts.push(`To ${filters.to} (UTC)`);
  return parts;
}

/**
 * ADMIN audit-record review with actor, action-type and date filters
 * (US-028 / #259, #260). Typed filter values are never discarded on an error, and the
 * rows already shown stay visible if applying a filter, refreshing or paging fails.
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

  /** What the user has typed (may differ from what the table currently shows). */
  const [draft, setDraft] = useState<AuditFilterValues>(EMPTY_AUDIT_FILTERS);
  /** The filters the visible rows were fetched with. */
  const [applied, setApplied] = useState<AuditFilterValues>(EMPTY_AUDIT_FILTERS);
  const [fieldErrors, setFieldErrors] = useState<AuditFilterErrors>({});

  const seq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Loads the newest page for `filters`. On failure the previous rows and the previously
   * applied filters stay in place, so the table and its filter summary never disagree.
   */
  const load = useCallback(async (filters: AuditFilterValues, initial: boolean) => {
    const mine = ++seq.current;
    if (initial) setPageState('loading');
    else setRefreshing(true);
    setInlineError(null);
    try {
      const page = await fetchAuditRecords(toParams(filters));
      if (!mounted.current || mine !== seq.current) return;
      setRecords(page.records);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setApplied(filters);
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
      } else if (err instanceof AuditApiError && err.status === 400 && err.fieldErrors) {
        // The server rejected a filter; show its message beside the field, keep everything typed.
        const mapped: AuditFilterErrors = {};
        for (const key of FILTER_KEYS) {
          if (err.fieldErrors[key]) mapped[key] = err.fieldErrors[key];
        }
        setFieldErrors(mapped);
        setInlineError('Some filters were not accepted. Check the highlighted fields.');
      } else {
        setInlineError(
          `${text} ${hasActiveAuditFilters(filters) ? 'Your filters are kept; ' : ''}the previous results are still shown.`.replace(
            /\s+/g,
            ' '
          )
        );
      }
    } finally {
      if (mounted.current && mine === seq.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(EMPTY_AUDIT_FILTERS, true);
  }, [load]);

  const applyFilters = (incompleteDates: { from: boolean; to: boolean } = { from: false, to: false }) => {
    const result = validateAuditFilters(draft);
    const errors: AuditFilterErrors = { ...result.errors };
    // A half-typed date reads as "" to the app; refuse it instead of silently ignoring it.
    if (incompleteDates.from && !errors.from) errors.from = INCOMPLETE_DATE_MESSAGE;
    if (incompleteDates.to && !errors.to) errors.to = INCOMPLETE_DATE_MESSAGE;
    if (!result.filters || Object.keys(errors).length > 0) {
      // Invalid input: no request, nothing typed is lost, nothing on screen changes.
      setFieldErrors(errors);
      setInlineError(null);
      return;
    }
    setFieldErrors({});
    setDraft(result.filters);
    void load(result.filters, false);
  };

  const clearFilters = () => {
    setDraft(EMPTY_AUDIT_FILTERS);
    setFieldErrors({});
    if (hasActiveAuditFilters(applied)) void load(EMPTY_AUDIT_FILTERS, false);
  };

  const changeDraft = (next: Partial<AuditFilterValues>) => {
    setDraft((prev) => ({ ...prev, ...next }));
    // Editing a field clears only that field's message.
    setFieldErrors((prev) => {
      const copy = { ...prev };
      for (const key of Object.keys(next) as Array<keyof AuditFilterValues>) delete copy[key];
      return copy;
    });
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setInlineError(null);
    try {
      // Always page with the filters the visible rows were fetched with, not unapplied typing.
      const page = await fetchAuditRecords(toParams(applied, { cursor: nextCursor }));
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
        setInlineError(`${text} The records already loaded are still shown.`);
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
          onClick={() => void load(EMPTY_AUDIT_FILTERS, true)}
          className="px-3 py-1.5 text-xs font-medium border border-red-200 rounded bg-white hover:bg-red-50"
        >
          Retry
        </button>
      </div>
    );
  }

  const filtersActive = hasActiveAuditFilters(applied);
  const appliedSummary = describeFilters(applied);
  const draftIsDirty =
    JSON.stringify(normalizeAuditFilters(draft)) !== JSON.stringify(applied) && hasActiveAuditFilters(draft);

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
          onClick={() => void load(applied, false)}
          disabled={refreshing}
          className="px-3 py-1.5 text-xs font-medium border border-cream-300 rounded bg-white hover:bg-cream-50 disabled:opacity-50"
          data-testid="audit-refresh"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <AuditFilters
        values={draft}
        errors={fieldErrors}
        busy={refreshing}
        canClear={hasActiveAuditFilters(draft) || filtersActive}
        onChange={changeDraft}
        onApply={applyFilters}
        onClear={clearFilters}
      />

      {filtersActive ? (
        <p className="text-sm text-ink" data-testid="audit-active-filters">
          <span className="font-medium">Showing records where:</span> {appliedSummary.join(' · ')}
          {draftIsDirty ? (
            <span className="text-ink-muted"> (you have unapplied changes)</span>
          ) : null}
        </p>
      ) : null}

      {inlineError ? (
        <div
          role="alert"
          className="p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md"
          data-testid="audit-inline-error"
        >
          {inlineError}
        </div>
      ) : null}

      {records.length === 0 ? (
        <div
          role="status"
          className="p-4 text-sm text-ink-muted border border-dashed border-cream-300 rounded-md space-y-2"
          data-testid="audit-empty"
        >
          {filtersActive ? (
            <>
              <p data-testid="audit-empty-filtered">No records match these filters.</p>
              <button
                type="button"
                onClick={clearFilters}
                className="text-sm font-medium text-forest-800 hover:underline"
                data-testid="audit-empty-clear"
              >
                Clear filters
              </button>
            </>
          ) : (
            <p>
              No administrative action records yet. Moderation, account and event actions will appear
              here once an administrator takes one.
            </p>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-ink-muted" data-testid="audit-count" aria-live="polite">
            Showing {records.length} record{records.length === 1 ? '' : 's'}
            {filtersActive ? ' matching your filters' : ''}
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

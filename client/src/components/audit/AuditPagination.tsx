import React from 'react';
import { AUDIT_PAGE_SIZES } from './auditTypes';

export interface AuditPaginationProps {
  /** Zero-based index of the page being shown. */
  pageIndex: number;
  pageSize: number;
  hasMore: boolean;
  /** True while a page, refresh or page-size change is loading. */
  busy: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPageSizeChange: (size: number) => void;
}

/**
 * Page navigation for the audit table (US-028 / #261). The server pages by an opaque
 * cursor, so only "previous" and "next" exist (no jump to page N), which is also what keeps
 * paging correct while new records are being appended.
 */
export function AuditPagination({
  pageIndex,
  pageSize,
  hasMore,
  busy,
  onPrevious,
  onNext,
  onPageSizeChange,
}: AuditPaginationProps): React.JSX.Element {
  const buttonClass =
    'rounded-md border border-cream-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-forest disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <nav
      aria-label="Audit records pagination"
      data-testid="audit-pagination"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <div className="flex items-center gap-2">
        <label htmlFor="audit-page-size" className="text-xs font-medium text-forest-900">
          Records per page
        </label>
        <select
          id="audit-page-size"
          data-testid="audit-page-size"
          value={pageSize}
          disabled={busy}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="rounded-md border border-cream-300 bg-white px-2 py-1.5 text-sm disabled:opacity-50"
        >
          {AUDIT_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrevious}
          disabled={busy || pageIndex === 0}
          data-testid="audit-page-prev"
          className={buttonClass}
        >
          ← Previous
        </button>
        <span
          aria-current="page"
          data-testid="audit-page-indicator"
          className="min-w-[4.5rem] text-center text-sm font-semibold text-forest-900"
        >
          Page {pageIndex + 1}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={busy || !hasMore}
          data-testid="audit-page-next"
          className={buttonClass}
        >
          {busy ? 'Loading…' : 'Next →'}
        </button>
      </div>
    </nav>
  );
}

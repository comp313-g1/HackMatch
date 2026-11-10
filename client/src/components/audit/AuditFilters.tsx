import React, { useRef } from 'react';
import {
  AUDIT_CATEGORY_LABELS,
  KNOWN_AUDIT_ACTION_TYPES,
  type AuditCategory,
  type AuditFilterErrors,
  type AuditFilters as AuditFilterValues,
} from './auditTypes';

export interface AuditFiltersProps {
  values: AuditFilterValues;
  errors: AuditFilterErrors;
  /** True while a request for new results is in flight. */
  busy: boolean;
  /** True when there is anything to clear (typed values or applied filters). */
  canClear: boolean;
  onChange: (next: Partial<AuditFilterValues>) => void;
  /**
   * `incompleteDates` flags date boxes the browser could not turn into a date (for example a
   * half-typed date), which would otherwise look like an empty field and be silently ignored.
   */
  onApply: (incompleteDates: { from: boolean; to: boolean }) => void;
  onClear: () => void;
}

const inputClass =
  'mt-1 block w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-forest';

/** Filters by actor, action type and date range (US-028 / #260, AC 4). Values are never altered on error. */
export function AuditFilters({
  values,
  errors,
  busy,
  canClear,
  onChange,
  onApply,
  onClear,
}: AuditFiltersProps): React.JSX.Element {
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  const field = (name: keyof AuditFilterValues) => ({
    'aria-invalid': errors[name] ? (true as const) : undefined,
    'aria-describedby': errors[name] ? `audit-filter-${name}-error` : `audit-filter-${name}-hint`,
    className: `${inputClass} ${errors[name] ? 'border-red-400 bg-red-50' : 'border-cream-300 bg-white'}`,
  });

  const error = (name: keyof AuditFilterValues) =>
    errors[name] ? (
      <p
        id={`audit-filter-${name}-error`}
        role="alert"
        className="mt-1 text-xs text-red-800"
        data-testid={`audit-filter-${name}-error`}
      >
        {errors[name]}
      </p>
    ) : null;

  return (
    <form
      role="search"
      aria-label="Filter audit records"
      data-testid="audit-filters"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onApply({
          from: Boolean(fromRef.current?.validity?.badInput),
          to: Boolean(toRef.current?.validity?.badInput),
        });
      }}
      className="space-y-3 rounded-md border border-cream-200 bg-white p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="sm:col-span-2 lg:col-span-2">
          <label htmlFor="audit-filter-actor" className="block text-xs font-medium text-forest-900">
            Actor (administrator ID)
          </label>
          <input
            id="audit-filter-actor"
            data-testid="audit-filter-actor"
            type="text"
            value={values.actor}
            onChange={(e) => onChange({ actor: e.target.value })}
            placeholder="Paste an Actor ID from the table"
            autoComplete="off"
            spellCheck={false}
            {...field('actor')}
          />
          <p id="audit-filter-actor-hint" className="mt-1 text-xs text-ink-muted">
            Copy it from the Actor column.
          </p>
          {error('actor')}
        </div>

        <div>
          <label htmlFor="audit-filter-actionType" className="block text-xs font-medium text-forest-900">
            Action type
          </label>
          <input
            id="audit-filter-actionType"
            data-testid="audit-filter-actionType"
            type="text"
            list="audit-action-types"
            value={values.actionType}
            onChange={(e) => onChange({ actionType: e.target.value })}
            placeholder="e.g. account_suspend"
            autoComplete="off"
            spellCheck={false}
            {...field('actionType')}
          />
          <datalist id="audit-action-types">
            {KNOWN_AUDIT_ACTION_TYPES.map((type) => (
              <option key={type} value={type} />
            ))}
          </datalist>
          <p id="audit-filter-actionType-hint" className="mt-1 text-xs text-ink-muted">
            Exact match.
          </p>
          {error('actionType')}
        </div>

        <div>
          <label htmlFor="audit-filter-category" className="block text-xs font-medium text-forest-900">
            Category
          </label>
          <select
            id="audit-filter-category"
            data-testid="audit-filter-category"
            value={values.category}
            onChange={(e) => onChange({ category: e.target.value as '' | AuditCategory })}
            {...field('category')}
          >
            <option value="">All</option>
            {(Object.keys(AUDIT_CATEGORY_LABELS) as AuditCategory[]).map((category) => (
              <option key={category} value={category}>
                {AUDIT_CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
          <p id="audit-filter-category-hint" className="mt-1 text-xs text-ink-muted">
            Event, moderation or account.
          </p>
          {error('category')}
        </div>

        <div>
          <label htmlFor="audit-filter-from" className="block text-xs font-medium text-forest-900">
            From (UTC date)
          </label>
          <input
            id="audit-filter-from"
            ref={fromRef}
            data-testid="audit-filter-from"
            type="date"
            value={values.from}
            onChange={(e) => onChange({ from: e.target.value })}
            {...field('from')}
          />
          <p id="audit-filter-from-hint" className="mt-1 text-xs text-ink-muted">
            Includes this day.
          </p>
          {error('from')}
        </div>

        <div>
          <label htmlFor="audit-filter-to" className="block text-xs font-medium text-forest-900">
            To (UTC date)
          </label>
          <input
            id="audit-filter-to"
            ref={toRef}
            data-testid="audit-filter-to"
            type="date"
            value={values.to}
            onChange={(e) => onChange({ to: e.target.value })}
            {...field('to')}
          />
          <p id="audit-filter-to-hint" className="mt-1 text-xs text-ink-muted">
            Includes this day.
          </p>
          {error('to')}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          data-testid="audit-filter-apply"
          className="rounded-md bg-forest px-3 py-1.5 text-sm font-semibold text-white hover:bg-forest-800 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2"
        >
          {busy ? 'Applying…' : 'Apply filters'}
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={busy || !canClear}
          data-testid="audit-filter-clear"
          className="rounded-md border border-cream-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-cream-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-forest"
        >
          Clear filters
        </button>
      </div>
    </form>
  );
}

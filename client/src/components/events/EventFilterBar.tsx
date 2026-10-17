import React from 'react';
import {
  type EventFilters,
  EVENT_FORMATS,
  hasActiveFilters,
} from './eventFilters.js';

export interface EventFilterBarProps {
  values: EventFilters;
  onChange: (next: EventFilters) => void;
  onClear: () => void;
  disabled?: boolean;
}

export function EventFilterBar({
  values,
  onChange,
  onClear,
  disabled = false,
}: EventFilterBarProps): React.JSX.Element {
  const active = hasActiveFilters(values);

  const handleKeywordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({
      ...values,
      keyword: e.target.value,
    });
  };

  const handleFormatChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({
      ...values,
      format: e.target.value,
    });
  };

  const handleTimeStateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({
      ...values,
      timeState: e.target.value as EventFilters['timeState'],
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
  };

  return (
    <form
      role="search"
      aria-label="Filter hackathons"
      onSubmit={handleSubmit}
      className="bg-white border border-cream-200 rounded-lg p-4 sm:p-5 shadow-sm space-y-4"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Keyword Search */}
        <div className="space-y-1.5">
          <label
            htmlFor="event-keyword"
            className="block text-xs font-semibold text-ink-muted uppercase tracking-wider"
          >
            Search Keyword
          </label>
          <input
            id="event-keyword"
            type="search"
            value={values.keyword}
            onChange={handleKeywordChange}
            disabled={disabled}
            placeholder="Search by title or location..."
            className="w-full text-sm rounded-md border border-cream-300 bg-cream-50/50 px-3 py-2 text-ink placeholder:text-ink-muted/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest transition disabled:opacity-50"
          />
        </div>

        {/* Format Select */}
        <div className="space-y-1.5">
          <label
            htmlFor="event-format"
            className="block text-xs font-semibold text-ink-muted uppercase tracking-wider"
          >
            Format
          </label>
          <select
            id="event-format"
            value={values.format}
            onChange={handleFormatChange}
            disabled={disabled}
            className="w-full text-sm rounded-md border border-cream-300 bg-cream-50/50 px-3 py-2 text-ink focus:bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest transition disabled:opacity-50"
          >
            <option value="">All Formats</option>
            {EVENT_FORMATS.map((fmt) => (
              <option key={fmt} value={fmt}>
                {fmt}
              </option>
            ))}
          </select>
        </div>

        {/* Time State Select */}
        <div className="space-y-1.5">
          <label
            htmlFor="event-time-state"
            className="block text-xs font-semibold text-ink-muted uppercase tracking-wider"
          >
            Event Timing
          </label>
          <select
            id="event-time-state"
            value={values.timeState}
            onChange={handleTimeStateChange}
            disabled={disabled}
            className="w-full text-sm rounded-md border border-cream-300 bg-cream-50/50 px-3 py-2 text-ink focus:bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest transition disabled:opacity-50"
          >
            <option value="">All Timeframes</option>
            <option value="upcoming">Upcoming</option>
            <option value="ongoing">Ongoing</option>
            <option value="concluded">Concluded</option>
          </select>
        </div>
      </div>

      {active && (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="text-xs font-medium text-forest-700 hover:text-forest-900 underline focus:outline-none focus:ring-2 focus:ring-forest rounded disabled:opacity-50"
          >
            Clear filters
          </button>
        </div>
      )}
    </form>
  );
}

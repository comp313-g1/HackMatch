import type { TimeState } from './eventTypes.js';

export interface EventFilters {
  keyword: string;
  format: string;
  timeState: '' | TimeState;
}

export const EMPTY_FILTERS: EventFilters = {
  keyword: '',
  format: '',
  timeState: '',
};

export const EVENT_FORMATS = ['In-Person', 'Virtual', 'Hybrid'] as const;

/**
 * Normalizes keyword for client-side search input:
 * Trims leading/trailing whitespace, collapses internal whitespace, and caps length at 100 characters.
 */
export function normalizeKeyword(input: string): string {
  return input.trim().replace(/\s+/g, ' ').slice(0, 100);
}

/**
 * Checks if any non-empty filter criteria is active.
 */
export function hasActiveFilters(filters: EventFilters): boolean {
  return Boolean(
    filters.keyword.trim().length > 0 ||
      filters.format.trim().length > 0 ||
      filters.timeState.trim().length > 0
  );
}

/**
 * Builds URLSearchParams query string from active filter criteria, omitting empty fields.
 */
export function buildEventQuery(filters: EventFilters): string {
  const params = new URLSearchParams();

  const normalizedKey = normalizeKeyword(filters.keyword);
  if (normalizedKey.length > 0) {
    params.set('q', normalizedKey);
  }

  const trimmedFormat = filters.format.trim();
  if (trimmedFormat.length > 0) {
    params.set('format', trimmedFormat);
  }

  const trimmedTimeState = filters.timeState.trim();
  if (trimmedTimeState.length > 0) {
    params.set('timeState', trimmedTimeState);
  }

  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
}

import {
  EMPTY_AUDIT_FILTERS,
  type AuditCategory,
  type AuditFilterErrors,
  type AuditFilters,
} from './auditTypes';

/** Same rules the server enforces (US-028 / #258), so mistakes are caught before a request is sent. */
export const AUDIT_ACTION_TYPE_MAX_LENGTH = 50;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION_TYPE_REGEX = /^[a-z][a-z0-9_]*$/;
const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const CATEGORIES: readonly AuditCategory[] = ['event', 'moderation', 'account'];

/** True only for a real calendar date (rejects 2026-02-30, month 13, etc.). */
export function isRealDate(value: string): boolean {
  const match = DATE_REGEX.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function normalizeAuditFilters(values: AuditFilters): AuditFilters {
  return {
    actor: values.actor.trim().toLowerCase(),
    actionType: values.actionType.trim(),
    category: values.category,
    from: values.from.trim(),
    to: values.to.trim(),
  };
}

export function hasActiveAuditFilters(filters: AuditFilters): boolean {
  return (
    filters.actor !== '' ||
    filters.actionType !== '' ||
    filters.category !== '' ||
    filters.from !== '' ||
    filters.to !== ''
  );
}

/**
 * Validates the filter form. Never changes what the user typed: on failure the caller keeps
 * the raw values and shows these messages next to the fields (NR-017).
 */
export function validateAuditFilters(values: AuditFilters): {
  errors: AuditFilterErrors;
  filters: AuditFilters | null;
} {
  const f = normalizeAuditFilters(values);
  const errors: AuditFilterErrors = {};

  if (f.actor && !UUID_REGEX.test(f.actor)) {
    errors.actor = 'Enter the administrator ID as a UUID (for example 123e4567-e89b-42d3-a456-426614174000).';
  }
  if (f.actionType) {
    if (f.actionType.length > AUDIT_ACTION_TYPE_MAX_LENGTH) {
      errors.actionType = `Action type must be at most ${AUDIT_ACTION_TYPE_MAX_LENGTH} characters.`;
    } else if (!ACTION_TYPE_REGEX.test(f.actionType)) {
      errors.actionType =
        'Use lowercase letters, digits and underscores, starting with a letter (for example account_suspend).';
    }
  }
  if (f.category && !CATEGORIES.includes(f.category)) {
    errors.category = 'Choose event, moderation or account.';
  }
  if (f.from && !isRealDate(f.from)) errors.from = 'Enter a real date as YYYY-MM-DD.';
  if (f.to && !isRealDate(f.to)) errors.to = 'Enter a real date as YYYY-MM-DD.';
  if (f.from && f.to && !errors.from && !errors.to && f.from > f.to) {
    errors.from = 'The start date must not be after the end date.';
  }

  if (Object.keys(errors).length > 0) return { errors, filters: null };
  return { errors: {}, filters: f };
}

export { EMPTY_AUDIT_FILTERS };

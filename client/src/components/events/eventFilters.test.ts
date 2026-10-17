import { describe, it, expect } from 'vitest';
import {
  normalizeKeyword,
  hasActiveFilters,
  buildEventQuery,
  EMPTY_FILTERS,
  type EventFilters,
} from './eventFilters.js';

describe('eventFilters unit tests (US-008 / #73)', () => {
  it('normalizeKeyword trims and collapses whitespace and caps at 100 characters', () => {
    expect(normalizeKeyword('  hackathon   2026  ')).toBe('hackathon 2026');
    const longString = 'x'.repeat(120);
    expect(normalizeKeyword(longString)).toHaveLength(100);
  });

  it('hasActiveFilters detects empty vs populated filters', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ keyword: '   ', format: '', timeState: '' })).toBe(false);
    expect(hasActiveFilters({ keyword: 'ai', format: '', timeState: '' })).toBe(true);
    expect(hasActiveFilters({ keyword: '', format: 'Virtual', timeState: '' })).toBe(true);
    expect(hasActiveFilters({ keyword: '', format: '', timeState: 'upcoming' })).toBe(true);
  });

  it('buildEventQuery builds clean URL query parameters omitting empty fields', () => {
    expect(buildEventQuery(EMPTY_FILTERS)).toBe('');

    const filters: EventFilters = {
      keyword: '  hackathon  toronto ',
      format: 'Hybrid',
      timeState: 'upcoming',
    };
    expect(buildEventQuery(filters)).toBe('?q=hackathon+toronto&format=Hybrid&timeState=upcoming');
  });

  it('buildEventQuery handles partial filters', () => {
    expect(buildEventQuery({ keyword: 'ml', format: '', timeState: '' })).toBe('?q=ml');
    expect(buildEventQuery({ keyword: '', format: 'In-Person', timeState: '' })).toBe(
      '?format=In-Person'
    );
    expect(buildEventQuery({ keyword: '', format: '', timeState: 'concluded' })).toBe(
      '?timeState=concluded'
    );
  });
});

import { describe, it, expect } from 'vitest';
import { formatActionLabel, formatSummary, formatUtcTimestamp } from './auditFormat';

describe('formatUtcTimestamp (US-028 / #259 AC 2: UTC time)', () => {
  it('renders a server timestamp as an unambiguous UTC string', () => {
    expect(formatUtcTimestamp('2026-11-03T10:00:00.123456Z')).toBe('2026-11-03 10:00:00 UTC');
    expect(formatUtcTimestamp('2026-11-03T23:59:59Z')).toBe('2026-11-03 23:59:59 UTC');
  });

  it('never shifts with the viewer\'s time zone', () => {
    const original = process.env.TZ;
    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Auckland']) {
      process.env.TZ = tz;
      expect(formatUtcTimestamp('2026-12-31T23:30:00.000000Z')).toBe('2026-12-31 23:30:00 UTC');
    }
    process.env.TZ = original;
  });

  it('handles midnight and year boundaries', () => {
    expect(formatUtcTimestamp('2026-01-01T00:00:00.000000Z')).toBe('2026-01-01 00:00:00 UTC');
    expect(formatUtcTimestamp('2028-02-29T12:00:00Z')).toBe('2028-02-29 12:00:00 UTC');
  });

  it('shows an unrecognized value as-is instead of hiding it', () => {
    expect(formatUtcTimestamp('not a date')).toBe('not a date');
    expect(formatUtcTimestamp('')).toBe('');
    expect(formatUtcTimestamp('2026-11-03T10:00:00+05:30')).toBe('2026-11-03T10:00:00+05:30');
  });
});

describe('formatActionLabel', () => {
  it('drops the category prefix and humanizes the rest', () => {
    expect(formatActionLabel('moderation_url_disabled')).toBe('Url disabled');
    expect(formatActionLabel('account_suspend')).toBe('Suspend');
    expect(formatActionLabel('event_approve')).toBe('Approve');
  });

  it('keeps unknown shapes readable', () => {
    expect(formatActionLabel('custom')).toBe('Custom');
    expect(formatActionLabel('moderation_')).toBe('moderation_');
    expect(formatActionLabel('')).toBe('');
  });
});

describe('formatSummary', () => {
  it('sorts keys at every depth so output is stable', () => {
    const a = formatSummary({ b: 1, a: { z: 1, y: [{ d: 1, c: 2 }] } });
    const b = formatSummary({ a: { y: [{ c: 2, d: 1 }], z: 1 }, b: 1 });
    expect(a).toBe(b);
    expect(a.indexOf('"a"')).toBeLessThan(a.indexOf('"b"'));
  });

  it('renders an empty summary', () => {
    expect(formatSummary({})).toBe('{}');
  });
});

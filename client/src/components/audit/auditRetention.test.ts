import { describe, it, expect } from 'vitest';
import {
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
  describeRetention,
  isPastRetention,
  readRetentionPolicy,
} from './auditRetention';

describe('readRetentionPolicy (US-028 / #263)', () => {
  it.each([undefined, null, '', '   '])('treats %j as "not approved yet"', (raw) => {
    expect(readRetentionPolicy(raw)).toEqual({ status: 'pending' });
  });

  it.each([
    ['90', 90],
    [' 365 ', 365],
    [30, 30],
    [String(RETENTION_MIN_DAYS), RETENTION_MIN_DAYS],
    [String(RETENTION_MAX_DAYS), RETENTION_MAX_DAYS],
  ])('accepts %j as %i days', (raw, days) => {
    expect(readRetentionPolicy(raw)).toEqual({ status: 'approved', days });
  });

  it.each(['0', '-5', '3651', '99999999', '1.5', '90 days', 'abc', '1e3', '0x10', '+30', '３０', '--', 'NaN', 'Infinity'])(
    'flags %j as invalid instead of guessing',
    (raw) => {
      expect(readRetentionPolicy(raw)).toEqual({ status: 'invalid', raw: raw.trim() });
    }
  );

  it('flags a number outside the allowed range as invalid', () => {
    expect(readRetentionPolicy(0).status).toBe('invalid');
    expect(readRetentionPolicy(RETENTION_MAX_DAYS + 1).status).toBe('invalid');
    expect(readRetentionPolicy(-1).status).toBe('invalid');
  });
});

describe('isPastRetention', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-11-30T12:00:00Z');

  it('is false for a recent record and true for an old one', () => {
    expect(isPastRetention('2026-11-29T12:00:00Z', 30, now)).toBe(false);
    expect(isPastRetention('2025-01-01T00:00:00Z', 30, now)).toBe(true);
  });

  it('treats exactly N days as still within retention, and one second more as past it (boundary)', () => {
    const exactlyN = new Date(now - 30 * DAY).toISOString();
    const justOver = new Date(now - 30 * DAY - 1000).toISOString();
    expect(isPastRetention(exactlyN, 30, now)).toBe(false);
    expect(isPastRetention(justOver, 30, now)).toBe(true);
  });

  it('handles a 1-day policy and a record created in the future', () => {
    expect(isPastRetention(new Date(now - 2 * DAY).toISOString(), 1, now)).toBe(true);
    expect(isPastRetention(new Date(now + DAY).toISOString(), 30, now)).toBe(false);
  });

  it('parses microsecond timestamps from the server', () => {
    expect(isPastRetention('2026-10-01T00:00:00.123456Z', 30, now)).toBe(true);
    expect(isPastRetention('2026-11-29T23:59:59.999999Z', 30, now)).toBe(false);
  });

  it('never claims a record is past retention when its time cannot be read', () => {
    for (const bad of ['', 'not a date', '2026-13-45T99:99:99Z']) {
      expect(isPastRetention(bad, 30, now)).toBe(false);
    }
  });
});

describe('describeRetention', () => {
  it('says plainly that no period has been approved yet', () => {
    const text = describeRetention({ status: 'pending' });
    expect(text).toMatch(/has not been approved yet/i);
    expect(text).toMatch(/synthetic demonstration data/i);
    expect(text).toMatch(/NR-023/);
  });

  it('states the approved period, with correct singular and plural', () => {
    expect(describeRetention({ status: 'approved', days: 90 })).toMatch(/kept for 90 days/);
    expect(describeRetention({ status: 'approved', days: 1 })).toMatch(/kept for 1 day\./);
    expect(describeRetention({ status: 'approved', days: 90 })).toMatch(/never edited or deleted/i);
  });

  it('explains an invalid setting and that nothing is marked', () => {
    const text = describeRetention({ status: 'invalid', raw: 'abc' });
    expect(text).toMatch(/"abc"/);
    expect(text).toMatch(/not valid/i);
    expect(text).toMatch(/no records are marked/i);
    expect(text).toContain(String(RETENTION_MAX_DAYS));
  });
});

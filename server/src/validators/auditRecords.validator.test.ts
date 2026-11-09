import { describe, it, expect, vi } from 'vitest';
import {
  AUDIT_CURSOR_MAX_LENGTH,
  AUDIT_DEFAULT_LIMIT,
  decodeAuditCursor,
  parseAuditDate,
  validateAuditQueryInput,
} from './auditRecords.validator.js';
import { encodeAuditCursor } from '../services/auditRecords.js';

const ID = '11111111-1111-4111-8111-111111111111';

describe('parseAuditDate (US-028 / #258)', () => {
  it('expands a date-only value to the whole inclusive UTC day', () => {
    expect(parseAuditDate('2026-11-03', 'from')).toBe('2026-11-03T00:00:00.000000Z');
    expect(parseAuditDate('2026-11-03', 'to')).toBe('2026-11-03T23:59:59.999999Z');
  });

  it('passes valid timestamps through unchanged', () => {
    for (const ts of ['2026-11-03T10:00:00Z', '2026-11-03T10:00:00.123456Z', '2026-11-03T10:00:00-05:30']) {
      expect(parseAuditDate(ts, 'from')).toBe(ts);
    }
  });

  it('accepts leap days only in leap years', () => {
    expect(parseAuditDate('2028-02-29', 'from')).not.toBeNull();
    expect(parseAuditDate('2026-02-29', 'from')).toBeNull();
    expect(parseAuditDate('1900-02-29', 'from')).toBeNull();
    expect(parseAuditDate('2000-02-29', 'from')).not.toBeNull();
  });

  it.each([
    '2026-13-01', '2026-00-10', '2026-04-31', '2026-11-3', '11/03/2026', 'today', '',
    '2026-11-03T24:00:00Z', '2026-11-03T10:60:00Z', '2026-11-03T10:00:60Z',
    '2026-11-03T10:00:00', '2026-11-03 10:00:00Z', '2026-11-03T10:00:00+24:00',
    '2026-11-03T10:00:00.1234567Z',
  ])('rejects %j', (value) => {
    expect(parseAuditDate(value, 'to')).toBeNull();
  });
});

describe('decodeAuditCursor', () => {
  it('round-trips a database cursor', () => {
    const cursor = { createdAt: '2026-11-03T10:00:00.123456Z', id: ID };
    expect(decodeAuditCursor(encodeAuditCursor(cursor))).toEqual(cursor);
  });

  it('rejects anything that is not exactly [timestamp-with-microseconds, uuid]', () => {
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    for (const bad of [
      enc([]), enc(['2026-11-03T10:00:00Z', ID]), enc(['2026-11-03T10:00:00.123456Z', 'x']),
      enc(['2026-11-03T10:00:00.123456Z', ID, 'extra']), enc({ a: 1 }), 'not-base64!!', '',
    ]) {
      expect(decodeAuditCursor(bad)).toBeNull();
    }
  });

  it('rejects an oversized cursor without decoding it', () => {
    const spy = vi.spyOn(Buffer, 'from');
    expect(decodeAuditCursor('A'.repeat(AUDIT_CURSOR_MAX_LENGTH + 1))).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('validateAuditQueryInput', () => {
  it('applies defaults', () => {
    expect(validateAuditQueryInput({})).toEqual({
      errors: {},
      params: { actorId: null, actionType: null, category: null, from: null, to: null, limit: AUDIT_DEFAULT_LIMIT, cursor: null },
    });
  });

  it('lowercases the actor id and keeps valid filters', () => {
    const { params } = validateAuditQueryInput({
      actor: ID.toUpperCase(), actionType: 'moderation_warn', category: 'moderation', limit: '100',
    });
    expect(params).toMatchObject({ actorId: ID, actionType: 'moderation_warn', category: 'moderation', limit: 100 });
  });

  it('rejects repeated parameters (arrays) and unknown keys', () => {
    const { errors } = validateAuditQueryInput({ limit: ['1', '2'], actor: [ID, ID], nope: 'x' });
    expect(Object.keys(errors).sort()).toEqual(['actor', 'limit', 'nope']);
  });

  it('does not also report "from after to" when a date is already invalid', () => {
    const { errors } = validateAuditQueryInput({ from: '2026-02-30', to: '2026-01-01' });
    expect(errors.from).toMatch(/real date/);
  });

  it('treats equal from/to as valid and from later than to as invalid', () => {
    expect(validateAuditQueryInput({ from: '2026-11-03T10:00:00Z', to: '2026-11-03T10:00:00Z' }).params).not.toBeNull();
    expect(validateAuditQueryInput({ from: '2026-11-04', to: '2026-11-03' }).errors.from).toMatch(/not be after/);
  });
});

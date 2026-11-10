import { describe, it, expect } from 'vitest';
import {
  AUDIT_ACTION_TYPE_MAX_LENGTH,
  hasActiveAuditFilters,
  isRealDate,
  normalizeAuditFilters,
  validateAuditFilters,
} from './auditFilterValidation';
import { EMPTY_AUDIT_FILTERS, type AuditFilters } from './auditTypes';

const ACTOR = '123e4567-e89b-42d3-a456-426614174000';
const f = (over: Partial<AuditFilters> = {}): AuditFilters => ({ ...EMPTY_AUDIT_FILTERS, ...over });

describe('validateAuditFilters (US-028 / #260)', () => {
  it('accepts an empty form (no filters)', () => {
    expect(validateAuditFilters(EMPTY_AUDIT_FILTERS)).toEqual({ errors: {}, filters: EMPTY_AUDIT_FILTERS });
  });

  it('accepts every filter at once', () => {
    const { errors, filters } = validateAuditFilters(
      f({ actor: ACTOR, actionType: 'account_suspend', category: 'account', from: '2026-11-01', to: '2026-11-03' })
    );
    expect(errors).toEqual({});
    expect(filters).toEqual({
      actor: ACTOR,
      actionType: 'account_suspend',
      category: 'account',
      from: '2026-11-01',
      to: '2026-11-03',
    });
  });

  it('trims whitespace and lowercases the actor id', () => {
    const { filters } = validateAuditFilters(f({ actor: `  ${ACTOR.toUpperCase()}  `, actionType: '  moderation_warn ' }));
    expect(filters).toMatchObject({ actor: ACTOR, actionType: 'moderation_warn' });
  });

  it('treats whitespace-only fields as empty', () => {
    expect(validateAuditFilters(f({ actor: '   ', actionType: '  ', from: ' ' })).filters).toEqual(EMPTY_AUDIT_FILTERS);
  });

  describe('actor', () => {
    it.each(['not-a-uuid', '123', ACTOR.slice(0, -1), `${ACTOR}0`, '123e4567-e89b-02d3-a456-426614174000', 'admin@example.com'])(
      'rejects %j',
      (actor) => {
        const { errors, filters } = validateAuditFilters(f({ actor }));
        expect(errors.actor).toMatch(/UUID/);
        expect(filters).toBeNull();
      }
    );
  });

  describe('action type', () => {
    it.each(['Account_Suspend', 'account-suspend', '1abc', 'a b', "x';--", 'moderation_%', '_warn', 'é'])(
      'rejects %j',
      (actionType) => {
        expect(validateAuditFilters(f({ actionType })).errors.actionType).toBeTruthy();
      }
    );

    it('accepts lowercase letters, digits and underscores', () => {
      for (const actionType of ['a', 'moderation_warn', 'x1_2_3']) {
        expect(validateAuditFilters(f({ actionType })).errors).toEqual({});
      }
    });

    it('enforces the 50-character boundary', () => {
      expect(validateAuditFilters(f({ actionType: 'a'.repeat(AUDIT_ACTION_TYPE_MAX_LENGTH) })).errors).toEqual({});
      expect(validateAuditFilters(f({ actionType: 'a'.repeat(AUDIT_ACTION_TYPE_MAX_LENGTH + 1) })).errors.actionType).toMatch(/at most 50/);
    });
  });

  describe('dates', () => {
    it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '11/03/2026', '2026-1-1', 'today', '2026-11-03T10:00:00Z'])(
      'rejects %j',
      (value) => {
        expect(validateAuditFilters(f({ from: value })).errors.from).toMatch(/real date/);
        expect(validateAuditFilters(f({ to: value })).errors.to).toMatch(/real date/);
      }
    );

    it('knows leap days', () => {
      expect(isRealDate('2028-02-29')).toBe(true);
      expect(isRealDate('2000-02-29')).toBe(true);
      expect(isRealDate('2026-02-29')).toBe(false);
      expect(isRealDate('1900-02-29')).toBe(false);
    });

    it('accepts a single day (from == to) and an open-ended range', () => {
      expect(validateAuditFilters(f({ from: '2026-11-03', to: '2026-11-03' })).errors).toEqual({});
      expect(validateAuditFilters(f({ from: '2026-11-03' })).errors).toEqual({});
      expect(validateAuditFilters(f({ to: '2026-11-03' })).errors).toEqual({});
    });

    it('rejects a start date after the end date', () => {
      const { errors } = validateAuditFilters(f({ from: '2026-11-04', to: '2026-11-03' }));
      expect(errors.from).toMatch(/must not be after/);
    });

    it('reports a real-date error instead of an order error when one date is invalid', () => {
      const { errors } = validateAuditFilters(f({ from: '2026-02-30', to: '2026-01-01' }));
      expect(errors.from).toMatch(/real date/);
    });
  });

  it('rejects an unknown category', () => {
    expect(validateAuditFilters(f({ category: 'other' as never })).errors.category).toBeTruthy();
  });

  it('reports every invalid field at once', () => {
    const { errors } = validateAuditFilters(f({ actor: 'x', actionType: 'BAD', from: 'nope', to: '2026-99-99' }));
    expect(Object.keys(errors).sort()).toEqual(['actionType', 'actor', 'from', 'to']);
  });

  it('never mutates the input values', () => {
    const input = f({ actor: `  ${ACTOR.toUpperCase()}  `, actionType: ' BAD ' });
    const snapshot = { ...input };
    validateAuditFilters(input);
    expect(input).toEqual(snapshot);
  });
});

describe('hasActiveAuditFilters / normalizeAuditFilters', () => {
  it('detects any active filter', () => {
    expect(hasActiveAuditFilters(EMPTY_AUDIT_FILTERS)).toBe(false);
    for (const key of ['actor', 'actionType', 'category', 'from', 'to'] as const) {
      expect(hasActiveAuditFilters(f({ [key]: key === 'category' ? 'event' : 'x' }))).toBe(true);
    }
  });

  it('normalizes without validating', () => {
    expect(normalizeAuditFilters(f({ actor: ' ABC ', from: ' 2026-01-01 ' }))).toMatchObject({
      actor: 'abc',
      from: '2026-01-01',
    });
  });
});

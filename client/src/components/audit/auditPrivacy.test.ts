import { describe, it, expect } from 'vitest';
import {
  EMAIL_PLACEHOLDER,
  PHONE_PLACEHOLDER,
  formerMemberLabel,
  isIdentityErasure,
  redactPersonalText,
  redactSummary,
} from './auditPrivacy';

describe('redactPersonalText (US-028 / #263: pseudonymization display)', () => {
  describe('e-mail addresses', () => {
    it.each([
      ['jo@example.com', 1],
      ['JO.SMITH+tag@Mail.Example.CO.UK', 1],
      ['first_last-1@sub.domain.org', 1],
      ['two: a@x.io and b@y.io', 2],
    ])('hides %j', (input, count) => {
      const r = redactPersonalText(input);
      expect(r.redactedCount).toBe(count);
      expect(r.text).not.toMatch(/@\w+\./);
      expect(r.text).toContain(EMAIL_PLACEHOLDER);
    });

    it('keeps the surrounding sentence and trailing punctuation', () => {
      expect(redactPersonalText('Contacted jo@example.com. Done.').text).toBe(`Contacted ${EMAIL_PLACEHOLDER}. Done.`);
      expect(redactPersonalText('(jo@example.com)').text).toBe(`(${EMAIL_PLACEHOLDER})`);
    });

    it.each(['@handle', 'a @ b', 'user@localhost', 'price@5', 'x@y', 'see you @ noon', '@@'])(
      'does not touch %j (not an e-mail address)',
      (input) => {
        expect(redactPersonalText(input)).toEqual({ text: input, redactedCount: 0 });
      }
    );

    it('also hides the address inside a URL with credentials', () => {
      const r = redactPersonalText('https://user:secret@host.example.com/path');
      expect(r.text).not.toContain('secret@host.example.com');
      expect(r.redactedCount).toBe(1);
    });
  });

  describe('phone numbers', () => {
    it.each([
      '+1 (555) 123-4567',
      '+44 20 7946 0958',
      '+91 98765 43210',
      '(555) 123-4567',
      '555-123-4567',
      '555.123.4567',
      '555 123 4567',
    ])('hides %j', (phone) => {
      const r = redactPersonalText(`Call ${phone} today`);
      expect(r.text).toBe(`Call ${PHONE_PLACEHOLDER} today`);
      expect(r.redactedCount).toBe(1);
    });

    it.each([
      '2026-11-03',
      '2026-11-03T10:00:00.123456Z',
      '10:00:00',
      'case 1234567',
      'ticket #12345',
      '1731492000000',
      'v1.2.3',
      '10.0.0.1',
      '$1,234,567',
      '1-2-3',
      '12 34 56',
      'room 101',
    ])('does not hide %j (id, date, time or number that is not a phone)', (input) => {
      expect(redactPersonalText(input)).toEqual({ text: input, redactedCount: 0 });
    });
  });

  describe('record and participant ids are never hidden', () => {
    it.each([
      '11111111-1111-4111-8111-111111111111', // all digits: looks like a phone number to a naive rule
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '123e4567-e89b-42d3-a456-426614174000',
    ])('keeps %s intact', (uuid) => {
      expect(redactPersonalText(`Account ${uuid} was suspended`)).toEqual({
        text: `Account ${uuid} was suspended`,
        redactedCount: 0,
      });
    });

    it('hides a phone number written right next to an id without hiding the id', () => {
      const id = '11111111-1111-4111-8111-111111111111';
      const r = redactPersonalText(`${id} called from 555-123-4567`);
      expect(r.text).toBe(`${id} called from ${PHONE_PLACEHOLDER}`);
    });
  });

  it('counts every hidden item across e-mail and phone', () => {
    const r = redactPersonalText('jo@example.com / +1 555 123 4567 / (555) 123-4567');
    expect(r.redactedCount).toBe(3);
  });

  it('returns identical text and a zero count when there is nothing to hide', () => {
    const text = 'Repeated spam in pitch; see case 42 on 2026-11-03.';
    expect(redactPersonalText(text)).toEqual({ text, redactedCount: 0 });
    expect(redactPersonalText('')).toEqual({ text: '', redactedCount: 0 });
  });

  it('is idempotent: redacting already-redacted text changes nothing', () => {
    const once = redactPersonalText('jo@example.com and 555-123-4567');
    expect(redactPersonalText(once.text)).toEqual({ text: once.text, redactedCount: 0 });
  });

  it('handles very long input quickly (no pathological backtracking)', () => {
    const inputs = [
      'a'.repeat(100_000),
      `${'a'.repeat(100_000)}@`,
      `${'a.'.repeat(50_000)}@x`,
      `+${' '.repeat(100_000)}`,
      `+1${' 1'.repeat(50_000)}`,
      '(555) '.repeat(20_000),
    ];
    const started = performance.now();
    for (const input of inputs) redactPersonalText(input);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('handles unusual characters without throwing', () => {
    for (const text of ['\u0000\u0001', '😀 jo@example.com 😀', '\n\njo@example.com\n', 'ｊｏ＠ｅｘａｍｐｌｅ．ｃｏｍ']) {
      expect(() => redactPersonalText(text)).not.toThrow();
    }
    expect(redactPersonalText('😀 jo@example.com 😀').text).toBe(`😀 ${EMAIL_PLACEHOLDER} 😀`);
  });
});

describe('redactSummary', () => {
  it('hides contact details in string values at any depth, leaving keys and other values alone', () => {
    const r = redactSummary({
      caseId: 'c-1',
      count: 3,
      flag: true,
      nothing: null,
      note: 'reach me at jo@example.com',
      nested: { list: ['ok', 'call 555-123-4567'], deep: { text: 'x@y.io' } },
    });
    expect(r.redactedCount).toBe(3);
    expect(r.value).toEqual({
      caseId: 'c-1',
      count: 3,
      flag: true,
      nothing: null,
      note: `reach me at ${EMAIL_PLACEHOLDER}`,
      nested: { list: ['ok', `call ${PHONE_PLACEHOLDER}`], deep: { text: EMAIL_PLACEHOLDER } },
    });
  });

  it('does not mutate its input', () => {
    const input = { note: 'jo@example.com', nested: { a: ['b@c.io'] } };
    const copy = JSON.parse(JSON.stringify(input));
    redactSummary(input);
    expect(input).toEqual(copy);
  });

  it('copes with an empty summary', () => {
    expect(redactSummary({})).toEqual({ value: {}, redactedCount: 0 });
  });
});

describe('formerMemberLabel / isIdentityErasure', () => {
  it('builds the same stable label rosters use for an erased account', () => {
    expect(formerMemberLabel('123e4567-e89b-42d3-a456-426614174000')).toBe('Former Member 123e4567');
    expect(formerMemberLabel('cccccccc-cccc-4ccc-8ccc-cccccccccccc')).toBe('Former Member cccccccc');
  });

  it('is stable: the same id always gives the same label, and different ids differ', () => {
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    expect(formerMemberLabel(a)).toBe(formerMemberLabel(a));
    expect(formerMemberLabel(a)).not.toBe(formerMemberLabel(b));
  });

  it('recognizes a completed deletion by outcome or by the summary flag', () => {
    expect(isIdentityErasure({ actionType: 'account_delete', outcome: 'deletion_completed', safeStateSummary: {} })).toBe(true);
    expect(isIdentityErasure({ actionType: 'account_delete', outcome: 'x', safeStateSummary: { livePiiErased: true } })).toBe(true);
  });

  it.each([
    [{ actionType: 'account_delete', outcome: 'deletion_blocked_needs_disband', safeStateSummary: {} }],
    [{ actionType: 'account_delete', outcome: 'Applied', safeStateSummary: { livePiiErased: false } }],
    [{ actionType: 'account_suspend', outcome: 'deletion_completed', safeStateSummary: { livePiiErased: true } }],
    [{ actionType: 'moderation_warn', outcome: 'Applied', safeStateSummary: {} }],
  ])('does not treat %j as an erasure', (record) => {
    expect(isIdentityErasure(record)).toBe(false);
  });

  it('tolerates a missing summary', () => {
    expect(isIdentityErasure({ actionType: 'account_delete', outcome: 'Applied', safeStateSummary: undefined as never })).toBe(false);
  });
});

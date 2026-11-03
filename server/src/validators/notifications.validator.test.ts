import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_DEFAULT_LIMIT,
  decodeNotificationCursor,
  validateNotificationListQueryInput,
} from './notifications.validator.js';
import { encodeNotificationCursor } from '../services/notifications.js';

const ID = '11111111-1111-4111-8111-111111111111';

describe('notifications.validator (US-021 / #199)', () => {
  it('applies defaults when no query is given', () => {
    const { errors, query } = validateNotificationListQueryInput({});
    expect(errors).toEqual({});
    expect(query).toEqual({
      limit: NOTIFICATION_DEFAULT_LIMIT,
      cursor: null,
      unreadOnly: false,
      category: null,
    });
  });

  it('round-trips a cursor', () => {
    const cursor = { createdAt: '2026-11-03T10:00:00.123456+00:00', id: ID };
    expect(decodeNotificationCursor(encodeNotificationCursor(cursor))).toEqual(cursor);
  });

  it('rejects cursors that could inject filter syntax', () => {
    const evil = Buffer.from(
      JSON.stringify(['2026-11-03T10:00:00Z",id.gt.0,x.eq."', ID]),
      'utf8'
    ).toString('base64url');
    expect(decodeNotificationCursor(evil)).toBeNull();
    expect(decodeNotificationCursor('%%%')).toBeNull();
    expect(
      decodeNotificationCursor(Buffer.from(JSON.stringify(['2026-11-03T10:00:00Z', 'nope'])).toString('base64url'))
    ).toBeNull();
  });

  it('rejects array-valued and unknown parameters', () => {
    const { errors } = validateNotificationListQueryInput({ limit: ['1', '2'], foo: 'x' });
    expect(errors.limit).toBeTruthy();
    expect(errors.foo).toBeTruthy();
  });
});

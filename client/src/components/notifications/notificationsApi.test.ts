import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthRequiredError } from '../../config/authFetch';
import {
  NotificationsApiError,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './notificationsApi';

vi.mock('../../config/authFetch', async () => {
  const actual = await vi.importActual<typeof import('../../config/authFetch')>(
    '../../config/authFetch'
  );
  return { ...actual, authFetch: vi.fn() };
});

import { authFetch } from '../../config/authFetch';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('notificationsApi (US-021 / #200)', () => {
  beforeEach(() => {
    vi.mocked(authFetch).mockReset();
  });

  it('lists notifications with query params', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      json({ status: 'ok', notifications: [{ id: 'a' }], unreadCount: 3, nextCursor: 'c2' })
    );
    const page = await listNotifications({ limit: 20, cursor: 'c1', unreadOnly: true });
    expect(authFetch).toHaveBeenCalledWith('/api/notifications?limit=20&cursor=c1&unread=true', {
      method: 'GET',
    });
    expect(page).toEqual({ notifications: [{ id: 'a' }], unreadCount: 3, nextCursor: 'c2' });
  });

  it('defaults missing fields to an empty page', async () => {
    vi.mocked(authFetch).mockResolvedValue(json({ status: 'ok' }));
    expect(await listNotifications()).toEqual({
      notifications: [],
      unreadCount: 0,
      nextCursor: null,
    });
    expect(authFetch).toHaveBeenCalledWith('/api/notifications', { method: 'GET' });
  });

  it('marks one read via PATCH with an encoded id', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      json({ status: 'ok', notification: { id: 'x' }, alreadyRead: false, unreadCount: 1 })
    );
    const result = await markNotificationRead('a/b');
    expect(authFetch).toHaveBeenCalledWith('/api/notifications/a%2Fb/read', { method: 'PATCH' });
    expect(result.unreadCount).toBe(1);
  });

  it('marks all read via POST', async () => {
    vi.mocked(authFetch).mockResolvedValue(json({ status: 'ok', markedCount: 4, unreadCount: 0 }));
    expect(await markAllNotificationsRead()).toMatchObject({ markedCount: 4, unreadCount: 0 });
    expect(authFetch).toHaveBeenCalledWith('/api/notifications/read-all', { method: 'POST' });
  });

  it('throws NotificationsApiError with the server code', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      json({ error: 'Notification not found.', code: 'NOTIFICATION_NOT_FOUND' }, 404)
    );
    await expect(markNotificationRead('x')).rejects.toMatchObject({
      name: 'NotificationsApiError',
      status: 404,
      code: 'NOTIFICATION_NOT_FOUND',
      message: 'Notification not found.',
    });
  });

  it('handles non-JSON error bodies', async () => {
    vi.mocked(authFetch).mockResolvedValue(new Response('boom', { status: 502 }));
    await expect(listNotifications()).rejects.toMatchObject({ status: 502, code: 'UNKNOWN_ERROR' });
  });

  it('maps network failures to NETWORK and rethrows AuthRequiredError', async () => {
    vi.mocked(authFetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(listNotifications()).rejects.toMatchObject({ status: 0, code: 'NETWORK' });

    vi.mocked(authFetch).mockRejectedValueOnce(new AuthRequiredError());
    await expect(listNotifications()).rejects.toBeInstanceOf(AuthRequiredError);
    expect(new NotificationsApiError(0, 'NETWORK')).toBeInstanceOf(Error);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { NotificationHub, type NotificationEvent } from './notificationHub.js';

const event = (id: string, unreadCount = 1): NotificationEvent => ({
  unreadCount,
  notification: {
    id,
    type: 'team_invitation',
    category: 'invitation',
    message: 'hello',
    teamId: null,
    eventId: null,
    requestId: null,
    submissionId: null,
    readAt: null,
    createdAt: '2026-11-03T12:00:00.000Z',
  },
});

describe('NotificationHub (US-021 / #198)', () => {
  it('delivers only to the recipient (cross-user isolation)', () => {
    const hub = new NotificationHub();
    const alice = vi.fn();
    const bob = vi.fn();
    hub.subscribe('alice', alice);
    hub.subscribe('bob', bob);

    const delivered = hub.publish('alice', event('n1'));

    expect(delivered).toBe(1);
    expect(alice).toHaveBeenCalledWith(event('n1'));
    expect(bob).not.toHaveBeenCalled();
  });

  it('fans out to every connection of the same participant', () => {
    const hub = new NotificationHub();
    const tabA = vi.fn();
    const tabB = vi.fn();
    hub.subscribe('alice', tabA);
    hub.subscribe('alice', tabB);

    expect(hub.publish('alice', event('n1'))).toBe(2);
    expect(tabA).toHaveBeenCalledTimes(1);
    expect(tabB).toHaveBeenCalledTimes(1);
  });

  it('returns 0 when the recipient is offline', () => {
    expect(new NotificationHub().publish('nobody', event('n1'))).toBe(0);
  });

  it('stops delivering after unsubscribe, which is idempotent', () => {
    const hub = new NotificationHub();
    const listener = vi.fn();
    const unsubscribe = hub.subscribe('alice', listener);

    unsubscribe();
    unsubscribe();

    expect(hub.publish('alice', event('n1'))).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    expect(hub.subscriberCount('alice')).toBe(0);
  });

  it('isolates a throwing subscriber from the others', () => {
    const hub = new NotificationHub();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const healthy = vi.fn();
    hub.subscribe('alice', () => {
      throw new Error('socket closed');
    });
    hub.subscribe('alice', healthy);

    expect(hub.publish('alice', event('n1'))).toBe(1);
    expect(healthy).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('allows a subscriber to unsubscribe while handling an event', () => {
    const hub = new NotificationHub();
    const second = vi.fn();
    const unsubscribe = hub.subscribe('alice', () => unsubscribe());
    hub.subscribe('alice', second);

    expect(hub.publish('alice', event('n1'))).toBe(2);
    expect(hub.subscriberCount('alice')).toBe(1);
  });
});

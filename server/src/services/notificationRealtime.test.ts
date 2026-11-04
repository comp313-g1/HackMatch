import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParticipantNotification } from '../db/types.js';
import { NotificationHub } from './notificationHub.js';
import { resetDeliveryMemory } from './notifications.js';
import { startNotificationRealtimeBridge } from './notificationRealtime.js';

const ALICE = '11111111-1111-4111-8111-111111111111';

const stored: ParticipantNotification = {
  id: 'n-1',
  participant_id: ALICE,
  team_id: null,
  event_id: null,
  request_id: null,
  submission_id: null,
  type: 'team_application_submitted',
  category: 'application',
  message: 'New application received.',
  created_at: '2026-11-03T12:00:00.000Z',
  read_at: null,
};

function fakeClient() {
  let onInsert: ((payload: { new: unknown }) => void) | undefined;
  const channel = {
    on: vi.fn((_type: string, _filter: unknown, cb: (payload: { new: unknown }) => void) => {
      onInsert = cb;
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn().mockResolvedValue('ok'),
  };
  return {
    client: client as unknown as SupabaseClient,
    raw: client,
    channel,
    emit: (row: unknown) => onInsert?.({ new: row }),
  };
}

describe('notification Realtime bridge (US-021 / #198)', () => {
  beforeEach(() => {
    resetDeliveryMemory();
  });

  it('listens for INSERTs on participant_notifications', () => {
    const { client, channel } = fakeClient();

    startNotificationRealtimeBridge({ client, hub: new NotificationHub() });

    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'participant_notifications' },
      expect.any(Function)
    );
    expect(channel.subscribe).toHaveBeenCalled();
  });

  it('pushes a SQL-produced notification to the online recipient', async () => {
    const { client, emit } = fakeClient();
    const hub = new NotificationHub();
    const received = vi.fn();
    hub.subscribe(ALICE, received);
    const repository = { create: vi.fn(), countUnread: vi.fn().mockResolvedValue(2) };

    startNotificationRealtimeBridge({ client, hub, repository });
    emit(stored);

    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1));
    expect(received).toHaveBeenCalledWith({
      unreadCount: 2,
      notification: expect.objectContaining({ id: 'n-1', category: 'application' }),
    });
  });

  it('ignores malformed payloads', () => {
    const { client, emit } = fakeClient();
    const hub = new NotificationHub();
    const received = vi.fn();
    hub.subscribe(ALICE, received);
    const repository = { create: vi.fn(), countUnread: vi.fn() };

    startNotificationRealtimeBridge({ client, hub, repository });
    emit({ id: 'n-2' });
    emit(null);

    expect(received).not.toHaveBeenCalled();
    expect(repository.countUnread).not.toHaveBeenCalled();
  });

  it('removes the channel on stop', async () => {
    const { client, raw, channel } = fakeClient();

    const bridge = startNotificationRealtimeBridge({ client, hub: new NotificationHub() });
    await bridge.stop();

    expect(raw.removeChannel).toHaveBeenCalledWith(channel);
  });
});

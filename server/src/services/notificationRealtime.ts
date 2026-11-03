/**
 * US-021 / #198 live delivery of notifications written by any producer.
 *
 * Recruitment alerts are inserted by SQL lifecycle functions, never by Node, so
 * the service cannot publish them at write time. Supabase Realtime streams every
 * INSERT on participant_notifications (migration 0045 adds the table to the
 * publication) and each row is handed to deliverStoredNotification(). The
 * service-role connection bypasses RLS; routing to the recipient is done by the
 * hub, keyed on participant_id.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../db/client.js';
import type { ParticipantNotification } from '../db/types.js';
import { deliverStoredNotification, type NotificationServiceDeps } from './notifications.js';

export interface NotificationRealtimeBridge {
  stop: () => Promise<void>;
}

export interface NotificationRealtimeDeps extends NotificationServiceDeps {
  client?: SupabaseClient;
}

const CHANNEL_NAME = 'participant-notifications';

function isNotificationRow(value: unknown): value is ParticipantNotification {
  const row = value as Partial<ParticipantNotification> | null;
  return (
    !!row &&
    typeof row.id === 'string' &&
    typeof row.participant_id === 'string' &&
    typeof row.type === 'string' &&
    typeof row.message === 'string'
  );
}

export function startNotificationRealtimeBridge(
  deps: NotificationRealtimeDeps = {}
): NotificationRealtimeBridge {
  const client = deps.client ?? getSupabaseClient();

  const channel = client
    .channel(CHANNEL_NAME)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'participant_notifications' },
      (payload) => {
        if (!isNotificationRow(payload.new)) return;
        void deliverStoredNotification(payload.new, deps);
      }
    )
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log('[NOTIFICATIONS] Realtime bridge subscribed.');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(`[NOTIFICATIONS] Realtime bridge ${status}:`, err?.message ?? '');
      }
    });

  return {
    stop: async () => {
      await client.removeChannel(channel);
    },
  };
}

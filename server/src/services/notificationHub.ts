/**
 * US-021 / #198 in-process notification fan-out.
 *
 * Transport-neutral on purpose (NR-004: "transport is implementation-neutral"):
 * the later Express task attaches an SSE or WebSocket connection by calling
 * subscribe() for the authenticated participant and forwarding events. The hub
 * only ever routes an event to the participant it belongs to, so a connection
 * can never receive another account's notifications (FR-063).
 */

import type { NotificationCategory } from '../db/notificationModel.js';

export interface NotificationView {
  id: string;
  type: string;
  category: NotificationCategory;
  message: string;
  teamId: string | null;
  eventId: string | null;
  requestId: string | null;
  submissionId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationEvent {
  notification: NotificationView;
  /** Recipient's unread total after this notification, for the bell badge. */
  unreadCount: number;
}

export type NotificationListener = (event: NotificationEvent) => void;

export class NotificationHub {
  private readonly listeners = new Map<string, Set<NotificationListener>>();

  /** Returns an idempotent unsubscribe function. */
  subscribe(participantId: string, listener: NotificationListener): () => void {
    let set = this.listeners.get(participantId);
    if (!set) {
      set = new Set();
      this.listeners.set(participantId, set);
    }
    set.add(listener);

    return () => {
      const current = this.listeners.get(participantId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(participantId);
    };
  }

  /** Delivers to the recipient's live subscribers; returns how many received it. */
  publish(participantId: string, event: NotificationEvent): number {
    const set = this.listeners.get(participantId);
    if (!set) return 0;

    let delivered = 0;
    for (const listener of [...set]) {
      try {
        listener(event);
        delivered += 1;
      } catch (err) {
        // One broken connection must not block the others or the producer.
        console.warn('[NOTIFICATIONS] subscriber threw while handling an event:', err);
      }
    }
    return delivered;
  }

  subscriberCount(participantId: string): number {
    return this.listeners.get(participantId)?.size ?? 0;
  }
}

export const notificationHub = new NotificationHub();

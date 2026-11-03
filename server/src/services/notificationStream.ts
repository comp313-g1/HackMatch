/**
 * US-021 / #202 Server-Sent Events transport for live notifications (NR-004).
 *
 * Bridges the in-process NotificationHub to one browser connection. The hub only
 * routes events to the participant they belong to, so a stream can never carry
 * another account's alerts (FR-063).
 *
 * Auth is checked once, when the stream opens. To keep a long-lived connection
 * from outliving a revoked token or a newly suspended account, every stream is
 * closed after a bounded lifetime and the client reconnects (and re-authenticates).
 */

import type { Request, Response } from 'express';
import {
  notificationHub,
  type NotificationEvent,
  type NotificationHub,
} from './notificationHub.js';

export const STREAM_HEARTBEAT_MS = 25_000;
export const STREAM_MAX_LIFETIME_MS = 15 * 60_000;
export const STREAM_MAX_PER_PARTICIPANT = 5;
/** Reconnect delay hint (ms) sent to the client. */
export const STREAM_RETRY_MS = 3_000;

export interface NotificationStreamOptions {
  hub?: NotificationHub;
  heartbeatMs?: number;
  maxLifetimeMs?: number;
  maxPerParticipant?: number;
}

export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Opens an SSE stream for the participant. Returns false (after sending a 429)
 * when the participant already has the maximum number of open streams.
 */
export function openNotificationStream(
  req: Request,
  res: Response,
  participantId: string,
  options: NotificationStreamOptions = {}
): boolean {
  const hub = options.hub ?? notificationHub;
  const heartbeatMs = options.heartbeatMs ?? STREAM_HEARTBEAT_MS;
  const maxLifetimeMs = options.maxLifetimeMs ?? STREAM_MAX_LIFETIME_MS;
  const maxPerParticipant = options.maxPerParticipant ?? STREAM_MAX_PER_PARTICIPANT;

  if (hub.subscriberCount(participantId) >= maxPerParticipant) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(429).json({
      error: 'Too many open notification streams. Close another tab and try again.',
      code: 'TOO_MANY_STREAMS',
    });
    return false;
  }

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Disable proxy buffering so events are delivered immediately.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`retry: ${STREAM_RETRY_MS}\n${formatSseEvent('ready', {})}`);

  let closed = false;
  const unsubscribe = hub.subscribe(participantId, (event: NotificationEvent) => {
    if (!closed) res.write(formatSseEvent('notification', event));
  });

  const heartbeat = setInterval(() => {
    if (!closed) res.write(': keep-alive\n\n');
  }, heartbeatMs);

  const lifetime = setTimeout(() => {
    if (closed) return;
    // Tell the client this is a planned rotation, not an error.
    res.write(formatSseEvent('reconnect', {}));
    close();
    res.end();
  }, maxLifetimeMs);

  function close(): void {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    unsubscribe();
  }

  req.on('close', close);
  res.on('close', close);
  res.on('error', close);
  return true;
}

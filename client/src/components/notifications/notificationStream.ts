import { authFetch, AuthRequiredError } from '../../config/authFetch';
import type { NotificationView } from './notificationTypes';

/**
 * US-021 / #202 live notification stream (Server-Sent Events over fetch).
 *
 * EventSource cannot send the Firebase `Authorization` header, so the stream is
 * read from a fetch() response body instead. The connection reconnects with
 * exponential backoff; callers fall back to polling whenever it is not connected.
 */

export interface NotificationStreamEvent {
  notification: NotificationView;
  unreadCount: number;
}

export type StreamStatus = 'connecting' | 'connected' | 'reconnecting' | 'unavailable';

export interface NotificationStreamHandlers {
  onStatus: (status: StreamStatus) => void;
  onNotification: (event: NotificationStreamEvent) => void;
}

export interface NotificationStreamOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injection seam for tests. */
  fetchStream?: (path: string, init: RequestInit) => Promise<Response>;
}

export interface SseFrame {
  event: string;
  data: string;
}

/**
 * Splits buffered text into complete SSE frames. Comment lines (": keep-alive")
 * and `retry:` hints are ignored; incomplete trailing text is returned as `rest`.
 */
export function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop() ?? '';
  const frames: SseFrame[] = [];

  for (const block of blocks) {
    let event = 'message';
    const data: string[] = [];
    let hasField = false;
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') {
        event = value;
        hasField = true;
      } else if (field === 'data') {
        data.push(value);
        hasField = true;
      }
    }
    if (hasField) frames.push({ event, data: data.join('\n') });
  }
  return { frames, rest };
}

function isStreamEvent(value: unknown): value is NotificationStreamEvent {
  const v = value as Partial<NotificationStreamEvent> | null;
  return (
    !!v &&
    typeof v.unreadCount === 'number' &&
    !!v.notification &&
    typeof v.notification.id === 'string' &&
    typeof v.notification.message === 'string'
  );
}

/** Opens the stream and keeps it open; returns a function that stops it. */
export function connectNotificationStream(
  handlers: NotificationStreamHandlers,
  options: NotificationStreamOptions = {}
): () => void {
  const baseDelay = options.baseDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 30_000;
  const open = options.fetchStream ?? ((path, init) => authFetch(path, init));

  let stopped = false;
  let controller: AbortController | null = null;
  let wake: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, ms);
    });

  async function run(): Promise<void> {
    let attempt = 0;
    while (!stopped) {
      handlers.onStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      controller = new AbortController();
      let planned = false;

      try {
        const res = await open('/api/notifications/stream', {
          method: 'GET',
          headers: { Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (!res.ok) {
          // Not permitted / not deployed: stop trying; polling takes over.
          if (res.status === 403 || res.status === 404) {
            handlers.onStatus('unavailable');
            return;
          }
          throw new Error(`Stream request failed with status ${res.status}`);
        }
        if (!res.body) throw new Error('Stream response has no body');

        handlers.onStatus('connected');
        attempt = 0;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSseFrames(buffer);
          buffer = parsed.rest;
          for (const frame of parsed.frames) {
            if (frame.event === 'reconnect') {
              planned = true;
            } else if (frame.event === 'notification') {
              try {
                const payload: unknown = JSON.parse(frame.data);
                if (isStreamEvent(payload)) handlers.onNotification(payload);
              } catch {
                /* ignore a malformed frame; the next poll/reconnect reconciles */
              }
            }
          }
        }
      } catch (err: unknown) {
        if (stopped) return;
        if (err instanceof AuthRequiredError) {
          handlers.onStatus('unavailable');
          return;
        }
      }

      if (stopped) return;
      attempt = planned ? 0 : attempt + 1;
      handlers.onStatus('reconnecting');
      const delay = planned
        ? 250
        : Math.min(baseDelay * 2 ** (attempt - 1), maxDelay) + Math.random() * 250;
      await wait(delay);
    }
  }

  void run();

  return () => {
    stopped = true;
    controller?.abort();
    if (timer) clearTimeout(timer);
    wake?.();
  };
}

import { authFetch, AuthRequiredError } from '../../config/authFetch';
import { parseSseFrames } from '../notifications/notificationStream';
import { conversationBasePath, conversationIdOf } from './chatApi';
import type { ChatConversationTarget, ChatTypingEvent } from './chatTypes';

/**
 * US-035 / #408 — typing events for ONE conversation (Server-Sent Events over fetch).
 *
 * Same transport as the notification stream: EventSource cannot send the Firebase
 * bearer token, so the response body is read from fetch(). The server sends no event
 * history, so every (re)connection starts empty: `onConnected` is the signal to drop
 * whatever the previous connection showed. Planned 15-minute rotations reconnect
 * quickly; failures back off exponentially. A refused stream (feature disabled, no
 * access, signed out) stops for good and reports why.
 */

/** #404 / #407: the server's expiry, used until the stream's `ready` event says otherwise. */
export const DEFAULT_TYPING_EXPIRY_MS = 6_000;

export interface TypingStreamHandlers {
  /** A connection is live; `typingExpiryMs` comes from the server's ready event. */
  onConnected: (typingExpiryMs: number) => void;
  onTyping: (event: ChatTypingEvent) => void;
  /** The current connection dropped; a reconnect will follow. */
  onDisconnected: () => void;
  /** The stream will not be retried (e.g. FEATURE_DISABLED, no access, signed out). */
  onUnavailable: (code: string) => void;
}

export interface TypingStreamOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injection seam for tests. */
  fetchStream?: (path: string, init: RequestInit) => Promise<Response>;
}

async function readCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { code?: unknown };
    return typeof body.code === 'string' ? body.code : `HTTP_${res.status}`;
  } catch {
    return `HTTP_${res.status}`;
  }
}

/** Accepts only well-formed events for exactly this conversation. */
function toTypingEvent(value: unknown, target: ChatConversationTarget): ChatTypingEvent | null {
  const v = (value ?? {}) as Record<string, unknown>;
  const typist = (v.typist ?? {}) as Record<string, unknown>;
  if (
    v.conversationType !== target.kind ||
    typeof v.conversationId !== 'string' ||
    v.conversationId.toLowerCase() !== conversationIdOf(target).toLowerCase() ||
    typeof v.typing !== 'boolean' ||
    !(typist.handle === null || typeof typist.handle === 'string')
  ) {
    return null;
  }
  return {
    conversationType: target.kind,
    conversationId: v.conversationId,
    typist: { handle: typist.handle as string | null },
    typing: v.typing,
    ...(typeof v.expiresAt === 'string' ? { expiresAt: v.expiresAt } : {}),
  };
}

function expiryFrom(data: string): number {
  try {
    const ms = (JSON.parse(data) as { typingExpiryMs?: unknown }).typingExpiryMs;
    return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_TYPING_EXPIRY_MS;
  } catch {
    return DEFAULT_TYPING_EXPIRY_MS;
  }
}

/** Opens the conversation's typing stream and keeps it open; returns a function that stops it. */
export function connectTypingStream(
  target: ChatConversationTarget,
  handlers: TypingStreamHandlers,
  options: TypingStreamOptions = {}
): () => void {
  const baseDelay = options.baseDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 30_000;
  const open = options.fetchStream ?? ((path, init) => authFetch(path, init));
  const path = `${conversationBasePath(target)}/typing/stream`;

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
      controller = new AbortController();
      let planned = false;
      let connected = false;

      try {
        const res = await open(path, {
          method: 'GET',
          headers: { Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (!res.ok) {
          // A feature that is off, or a conversation the caller may not read, is not retried.
          if (res.status === 401 || res.status === 403 || res.status === 404) {
            if (!stopped) handlers.onUnavailable(await readCode(res));
            return;
          }
          throw new Error(`Typing stream request failed with status ${res.status}`);
        }
        if (!res.body) throw new Error('Typing stream response has no body');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done || stopped) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSseFrames(buffer);
          buffer = parsed.rest;
          for (const frame of parsed.frames) {
            if (stopped) return;
            if (frame.event === 'ready') {
              connected = true;
              attempt = 0;
              handlers.onConnected(expiryFrom(frame.data));
            } else if (frame.event === 'reconnect') {
              planned = true;
            } else if (frame.event === 'typing' && connected) {
              try {
                const event = toTypingEvent(JSON.parse(frame.data), target);
                if (event) handlers.onTyping(event);
              } catch {
                /* ignore a malformed frame; expiry clears anything stale */
              }
            }
          }
        }
      } catch (err: unknown) {
        if (stopped) return;
        if (err instanceof AuthRequiredError) {
          handlers.onUnavailable('AUTH_REQUIRED');
          return;
        }
      }

      if (stopped) return;
      handlers.onDisconnected();
      attempt = planned ? 0 : attempt + 1;
      const delay = planned ? 250 : Math.min(baseDelay * 2 ** (attempt - 1), maxDelay) + Math.random() * 250;
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

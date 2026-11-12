import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatApiError, signalChatTyping, conversationIdOf } from './chatApi';
import { useChatCapabilities } from './ChatCapabilitiesContext';
import type { ChatConversationTarget, ChatTypingEvent } from './chatTypes';
import { connectTypingStream, DEFAULT_TYPING_EXPIRY_MS } from './typingStream';

/**
 * US-035 / #408 — typing indicators for the ONE conversation currently on screen,
 * shared by public forums, private team chat, and direct messages.
 *
 * Inbound: while the server reports typing enabled, one typing stream is open for
 * the active conversation. Each typist is kept in memory with a local expiry of the
 * server-advertised duration (`typingExpiryMs`, default 6 s) measured from when the
 * event ARRIVED, so a missed stop, a dropped stream, or a clock difference with the
 * server can never leave an indicator stuck. A (re)connection starts empty because
 * the server sends no history.
 *
 * Outbound: composer changes send `{ typing: true }` at most once every 2 s; a
 * blank composer, blur, successful send, or leaving the conversation sends a
 * best-effort `{ typing: false }` if a start was sent. Failures never touch the
 * composer or message sending: FEATURE_DISABLED turns typing off for the session,
 * 429 pauses signals for Retry-After, a refusal stops signals for this conversation,
 * and network/server errors are simply dropped (the server expiry is the safety net).
 *
 * Changing conversation, signing out, or switching account closes the stream and
 * discards all state. Nothing is written to storage or URLs.
 */

/** #404: at most one "typing" signal per conversation every 2 s. */
export const TYPING_SIGNAL_INTERVAL_MS = 2_000;
/** Fallback pause when a 429 carries no usable Retry-After. */
const DEFAULT_TYPING_PAUSE_SECONDS = 10;

interface Typist {
  key: string;
  handle: string | null;
  expiresAt: number;
}

interface OutboundState {
  lastSentAt: number | null;
  sentTyping: boolean;
  pausedUntil: number;
  stopped: boolean;
}

export interface ConversationTyping {
  /** True when typing indicators are active for this conversation. */
  enabled: boolean;
  /** Current typists' handles (display data only). */
  typists: Array<string | null>;
  onComposerChange: (value: string) => void;
  onComposerBlur: () => void;
  onMessageSent: () => void;
}

function conversationKey(target: ChatConversationTarget | null): string | null {
  return target ? `${target.kind}:${conversationIdOf(target).toLowerCase()}` : null;
}

function applyEvent(previous: Typist[], event: ChatTypingEvent, now: number, expiryMs: number): Typist[] {
  const key = event.typist.handle ?? '';
  const existing = previous.find((typist) => typist.key === key);
  if (!event.typing) return existing ? previous.filter((typist) => typist.key !== key) : previous;
  const expiresAt = now + expiryMs;
  // A repeated pulse refreshes only this typist's own expiry and never adds a second entry.
  return existing
    ? previous.map((typist) => (typist.key === key ? { ...typist, expiresAt } : typist))
    : [...previous, { key, handle: event.typist.handle, expiresAt }];
}

export function useConversationTyping(target: ChatConversationTarget | null): ConversationTyping {
  const { typingEnabled, markTypingUnavailable, sessionKey } = useChatCapabilities();
  const key = conversationKey(target);
  const active = typingEnabled && key !== null;
  const [typists, setTypists] = useState<Typist[]>([]);

  // The latest target object for callbacks; effects are keyed by its stable string key.
  const targetRef = useRef<ChatConversationTarget | null>(target);
  const expiryMsRef = useRef(DEFAULT_TYPING_EXPIRY_MS);
  const outbound = useRef<OutboundState>({ lastSentAt: null, sentTyping: false, pausedUntil: 0, stopped: true });
  useEffect(() => {
    targetRef.current = target;
  });
  // Read by effect cleanups, which run after the render that changed the session.
  const sessionRef = useRef(sessionKey);
  sessionRef.current = sessionKey;

  // Inbound stream: exactly one, for the active conversation and session.
  useEffect(() => {
    setTypists([]);
    const current = targetRef.current;
    if (!active || !current) return;
    expiryMsRef.current = DEFAULT_TYPING_EXPIRY_MS;
    // A callback that arrives after this connection was replaced must change nothing.
    let alive = true;
    const stop = connectTypingStream(current, {
      onConnected: (expiryMs) => {
        if (!alive) return;
        expiryMsRef.current = expiryMs;
        setTypists([]); // no history: a fresh connection shows only future events
      },
      onTyping: (event) => {
        if (!alive) return;
        setTypists((previous) => applyEvent(previous, event, Date.now(), expiryMsRef.current));
      },
      onDisconnected: () => undefined, // local expiry clears anything left over
      onUnavailable: (code) => {
        if (!alive) return;
        setTypists([]);
        if (code === 'FEATURE_DISABLED') markTypingUnavailable();
      },
    });
    return () => {
      alive = false;
      stop();
      setTypists([]);
    };
  }, [active, key, sessionKey, markTypingUnavailable]);

  // Local expiry: one timer for the soonest expiry; removal at exactly expiresAt.
  useEffect(() => {
    if (typists.length === 0) return;
    const soonest = Math.min(...typists.map((typist) => typist.expiresAt));
    const timer = setTimeout(() => {
      setTypists((previous) => {
        const now = Date.now();
        const kept = previous.filter((typist) => typist.expiresAt > now);
        return kept.length === previous.length ? previous : kept;
      });
    }, Math.max(0, soonest - Date.now()));
    return () => clearTimeout(timer);
  }, [typists]);

  // Outbound state is per conversation and session; leaving sends a best-effort stop.
  useEffect(() => {
    const state: OutboundState = { lastSentAt: null, sentTyping: false, pausedUntil: 0, stopped: !active };
    outbound.current = state;
    const current = targetRef.current;
    const startedSession = sessionKey;
    return () => {
      const alreadyStopped = state.stopped; // disabled or refused: nothing to stop
      state.stopped = true;
      // Never send the previous conversation's stop under a different account (or none).
      if (!alreadyStopped && state.sentTyping && current && sessionRef.current === startedSession) {
        void signalChatTyping(current, false).catch(() => undefined);
      }
    };
  }, [active, key, sessionKey]);

  const send = useCallback(
    (typing: boolean): void => {
      const state = outbound.current;
      const current = targetRef.current;
      if (state.stopped || !current || Date.now() < state.pausedUntil) return;
      state.lastSentAt = typing ? Date.now() : null;
      state.sentTyping = typing;
      signalChatTyping(current, typing).catch((error: unknown) => {
        if (outbound.current !== state || !(error instanceof ChatApiError)) return;
        if (error.code === 'FEATURE_DISABLED') {
          state.stopped = true;
          markTypingUnavailable();
        } else if (error.status === 429) {
          state.pausedUntil = Date.now() + (error.retryAfterSeconds ?? DEFAULT_TYPING_PAUSE_SECONDS) * 1000;
        } else if (error.status === 401 || error.status === 403 || error.status === 404) {
          state.stopped = true; // not allowed here (e.g. blocked, removed): stop asking
        }
        // Network and 5xx errors are dropped; the next keystroke after the interval tries again.
      });
    },
    [markTypingUnavailable]
  );

  const stopTyping = useCallback((): void => {
    if (outbound.current.sentTyping) send(false);
  }, [send]);

  const onComposerChange = useCallback(
    (value: string): void => {
      if (!active) return;
      if (value.trim() === '') {
        stopTyping();
        return;
      }
      const { lastSentAt } = outbound.current;
      if (lastSentAt === null || Date.now() - lastSentAt >= TYPING_SIGNAL_INTERVAL_MS) send(true);
    },
    [active, send, stopTyping]
  );

  return {
    enabled: active,
    typists: typists.map((typist) => typist.handle),
    onComposerChange,
    onComposerBlur: stopTyping,
    onMessageSent: stopTyping,
  };
}

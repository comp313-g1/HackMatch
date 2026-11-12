/* eslint-disable react-refresh/only-export-components -- provider and its matching hook are one API. */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchChatCapabilities } from './chatApi';
import type { ChatReactionCode } from './chatTypes';

/**
 * US-035 / #406 — one session-scoped answer to "may this session use reactions?".
 *
 * The server decides (GET /api/chat/capabilities); the browser never reads the
 * feature flag itself. Everything here lives in React memory only and is thrown
 * away when the authenticated session changes. A failed or missing answer means
 * "no reactions": text chat never depends on it.
 */

export interface ChatReactionCapabilityValue {
  /** True only after the server confirmed reactions for this session. */
  reactionsEnabled: boolean;
  allowedReactions: ChatReactionCode[];
  /** Epoch ms until which reaction changes are paused after a 429, or null. */
  rateLimitedUntil: number | null;
  /** A reaction route answered FEATURE_DISABLED: stop offering reactions everywhere. */
  markReactionsUnavailable: () => void;
  /** A reaction route answered 429: pause reaction changes for this many seconds. */
  noteRateLimited: (retryAfterSeconds: number) => void;
}

const disabledValue: ChatReactionCapabilityValue = {
  reactionsEnabled: false,
  allowedReactions: [],
  rateLimitedUntil: null,
  markReactionsUnavailable: () => undefined,
  noteRateLimited: () => undefined,
};

const ChatCapabilitiesContext = createContext<ChatReactionCapabilityValue>(disabledValue);

export interface ChatCapabilitiesProviderProps {
  /** Firebase UID or another stable per-session key. Never rendered or sent as data. */
  sessionKey: string | null;
  enabled: boolean;
  children: React.ReactNode;
}

/** Fallback pause when a 429 carries no usable Retry-After. */
const DEFAULT_RATE_LIMIT_SECONDS = 10;

export function ChatCapabilitiesProvider({
  sessionKey,
  enabled,
  children,
}: ChatCapabilitiesProviderProps): React.JSX.Element {
  const [allowedReactions, setAllowedReactions] = useState<ChatReactionCode[]>([]);
  const [reactionsEnabled, setReactionsEnabled] = useState(false);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const current = ++requestId.current;
    // A new session never inherits the previous session's answer or pause.
    setReactionsEnabled(false);
    setAllowedReactions([]);
    setRateLimitedUntil(null);
    if (!enabled || !sessionKey) return;

    fetchChatCapabilities()
      .then((capabilities) => {
        if (current !== requestId.current) return;
        setReactionsEnabled(capabilities.reactions.enabled);
        setAllowedReactions(capabilities.reactions.allowedReactions);
      })
      .catch(() => {
        // Fail closed: no reaction controls; text chat is unaffected.
      });
  }, [enabled, sessionKey]);

  // Lift the pause when Retry-After has elapsed.
  useEffect(() => {
    if (rateLimitedUntil === null) return;
    const timer = setTimeout(() => setRateLimitedUntil(null), Math.max(0, rateLimitedUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [rateLimitedUntil]);

  const markReactionsUnavailable = useCallback(() => {
    setReactionsEnabled(false);
    setAllowedReactions([]);
  }, []);

  const noteRateLimited = useCallback((retryAfterSeconds: number) => {
    const seconds =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : DEFAULT_RATE_LIMIT_SECONDS;
    setRateLimitedUntil(Date.now() + seconds * 1000);
  }, []);

  const value = useMemo<ChatReactionCapabilityValue>(
    () =>
      enabled && sessionKey
        ? { reactionsEnabled, allowedReactions, rateLimitedUntil, markReactionsUnavailable, noteRateLimited }
        : disabledValue,
    [enabled, sessionKey, reactionsEnabled, allowedReactions, rateLimitedUntil, markReactionsUnavailable, noteRateLimited]
  );

  return <ChatCapabilitiesContext.Provider value={value}>{children}</ChatCapabilitiesContext.Provider>;
}

export function useChatReactionCapability(): ChatReactionCapabilityValue {
  return useContext(ChatCapabilitiesContext);
}

/* eslint-disable react-refresh/only-export-components -- provider and its matching hook are one API. */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AuthRequiredError,
  ChatApiError,
  fetchChatUnreadSummary,
  markChatConversationRead as markChatConversationReadRequest,
} from './chatApi';
import type {
  ChatUnreadConversationType,
  ChatUnreadCountView,
  ChatUnreadSummary,
  MarkChatConversationReadInput,
  MarkChatConversationReadResult,
} from './chatTypes';

export type ChatUnreadLoadState =
  | 'disabled'
  | 'loading'
  | 'refreshing'
  | 'ready'
  | 'error';

interface ChatUnreadSnapshot {
  sessionKey: string | null;
  summary: ChatUnreadSummary;
  loadState: ChatUnreadLoadState;
  error: string | null;
  announcement: string;
}

export interface ChatUnreadContextValue extends ChatUnreadSummary {
  enabled: boolean;
  loadState: ChatUnreadLoadState;
  error: string | null;
  announcement: string;
  refresh: () => Promise<void>;
  getCount: (
    conversationType: ChatUnreadConversationType,
    conversationId: string
  ) => ChatUnreadCountView | undefined;
  markRead: (
    input: MarkChatConversationReadInput
  ) => Promise<MarkChatConversationReadResult>;
}

export interface ChatUnreadProviderProps {
  /** Firebase UID or another stable per-session identifier. Never rendered or sent as data. */
  sessionKey: string | null;
  enabled: boolean;
  children: React.ReactNode;
}

const EMPTY_SUMMARY: ChatUnreadSummary = {
  counts: [],
  totalUnreadCount: 0,
  totalUnreadMentionCount: 0,
};

function describeUnreadError(error: unknown): string {
  if (error instanceof AuthRequiredError) {
    return 'Please sign in again to refresh chat activity.';
  }
  if (error instanceof ChatApiError) {
    if (error.status === 401) return 'Your session expired. Please sign in again.';
    if (error.status === 403) return 'Chat activity is unavailable for this account.';
  }
  return 'Could not refresh chat activity. Previously confirmed badges were kept.';
}

function summarizeCounts(counts: ChatUnreadCountView[]): ChatUnreadSummary {
  return {
    counts,
    totalUnreadCount: counts.reduce((total, item) => total + item.unreadCount, 0),
    totalUnreadMentionCount: counts.reduce(
      (total, item) => total + item.unreadMentionCount,
      0
    ),
  };
}

const disabledValue: ChatUnreadContextValue = {
  ...EMPTY_SUMMARY,
  enabled: false,
  loadState: 'disabled',
  error: null,
  announcement: '',
  refresh: async () => undefined,
  getCount: () => undefined,
  markRead: async () => {
    throw new ChatApiError(
      403,
      'CHAT_UNREAD_DISABLED',
      undefined,
      undefined,
      'Chat activity is unavailable for this session.'
    );
  },
};

const ChatUnreadContext = createContext<ChatUnreadContextValue>(disabledValue);

/**
 * US-034 / #402 — one session-scoped source for channel, team-chat, DM and
 * navigation badges. PostgreSQL remains authoritative; this cache is discarded
 * immediately when the authenticated session key changes.
 */
export function ChatUnreadProvider({
  sessionKey,
  enabled,
  children,
}: ChatUnreadProviderProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ChatUnreadSnapshot>({
    sessionKey: null,
    summary: EMPTY_SUMMARY,
    loadState: 'disabled',
    error: null,
    announcement: '',
  });
  const requestSequence = useRef(0);
  const currentSessionKey = useRef(sessionKey);
  currentSessionKey.current = sessionKey;

  const loadForSession = useCallback(
    async (preserveConfirmedCounts: boolean): Promise<void> => {
      if (!enabled || !sessionKey) return;
      const requestSessionKey = sessionKey;
      const sequence = ++requestSequence.current;

      setSnapshot((current) => ({
        sessionKey: requestSessionKey,
        summary:
          preserveConfirmedCounts && current.sessionKey === requestSessionKey
            ? current.summary
            : EMPTY_SUMMARY,
        loadState:
          preserveConfirmedCounts && current.sessionKey === requestSessionKey
            ? 'refreshing'
            : 'loading',
        error: null,
        announcement: '',
      }));

      try {
        const summary = await fetchChatUnreadSummary();
        if (
          sequence !== requestSequence.current ||
          currentSessionKey.current !== requestSessionKey
        ) {
          return;
        }
        setSnapshot({
          sessionKey: requestSessionKey,
          summary,
          loadState: 'ready',
          error: null,
          announcement: 'Chat activity refreshed.',
        });
      } catch (error: unknown) {
        if (
          sequence !== requestSequence.current ||
          currentSessionKey.current !== requestSessionKey
        ) {
          return;
        }
        setSnapshot((current) => ({
          sessionKey: requestSessionKey,
          summary:
            preserveConfirmedCounts && current.sessionKey === requestSessionKey
              ? current.summary
              : EMPTY_SUMMARY,
          loadState: 'error',
          error: describeUnreadError(error),
          announcement: '',
        }));
      }
    },
    [enabled, sessionKey]
  );

  useEffect(() => {
    requestSequence.current += 1;
    if (!enabled || !sessionKey) {
      setSnapshot({
        sessionKey: null,
        summary: EMPTY_SUMMARY,
        loadState: 'disabled',
        error: null,
        announcement: '',
      });
      return;
    }

    void loadForSession(false);
    return () => {
      requestSequence.current += 1;
    };
  }, [enabled, sessionKey, loadForSession]);

  const refresh = useCallback(async (): Promise<void> => {
    await loadForSession(true);
  }, [loadForSession]);

  const markRead = useCallback(
    async (
      input: MarkChatConversationReadInput
    ): Promise<MarkChatConversationReadResult> => {
      if (!enabled || !sessionKey) return disabledValue.markRead(input);
      const requestSessionKey = sessionKey;
      const result = await markChatConversationReadRequest(input);

      // Never apply one account's late response to a different signed-in account.
      if (currentSessionKey.current !== requestSessionKey) return result;

      setSnapshot((current) => {
        if (current.sessionKey !== requestSessionKey) return current;
        const existing = current.summary.counts.find(
          (item) =>
            item.conversationType === result.conversationType &&
            item.conversationId === result.conversationId
        );
        const nextCount: ChatUnreadCountView = {
          conversationType: result.conversationType,
          conversationId: result.conversationId,
          unreadCount: result.unreadCount,
          unreadMentionCount: result.unreadMentionCount,
        };
        const counts = existing
          ? current.summary.counts.map((item) =>
              item.conversationType === result.conversationType &&
              item.conversationId === result.conversationId
                ? nextCount
                : item
            )
          : [...current.summary.counts, nextCount];
        return {
          sessionKey: requestSessionKey,
          summary: summarizeCounts(counts),
          loadState: 'ready',
          error: null,
          announcement: 'Unread chat activity updated.',
        };
      });

      // Reconcile aggregate counts and remove conversations that became inaccessible.
      void loadForSession(true);
      return result;
    },
    [enabled, sessionKey, loadForSession]
  );

  const value = useMemo<ChatUnreadContextValue>(() => {
    const activeSnapshot =
      enabled && sessionKey && snapshot.sessionKey === sessionKey
        ? snapshot
        : {
            sessionKey,
            summary: EMPTY_SUMMARY,
            loadState:
              enabled && sessionKey ? ('loading' as const) : ('disabled' as const),
            error: null,
            announcement: '',
          };
    const getCount = (
      conversationType: ChatUnreadConversationType,
      conversationId: string
    ): ChatUnreadCountView | undefined =>
      activeSnapshot.summary.counts.find(
        (item) =>
          item.conversationType === conversationType &&
          item.conversationId === conversationId
      );

    return {
      ...activeSnapshot.summary,
      enabled: Boolean(enabled && sessionKey),
      loadState: activeSnapshot.loadState,
      error: activeSnapshot.error,
      announcement: activeSnapshot.announcement,
      refresh,
      getCount,
      markRead,
    };
  }, [snapshot, enabled, sessionKey, refresh, markRead]);

  return <ChatUnreadContext.Provider value={value}>{children}</ChatUnreadContext.Provider>;
}

export function useChatUnread(): ChatUnreadContextValue {
  return useContext(ChatUnreadContext);
}


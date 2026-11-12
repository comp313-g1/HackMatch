import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AuthRequiredError,
  ChatApiError,
  listTeamChatMessages,
  openTeamChat,
  sendTeamChatMessage,
} from './chatApi';
import type {
  ChatFieldErrors,
  ChatMessageView,
  ChatReactionSummary,
  TeamChatChannelView,
} from './chatTypes';
import { MessageReactions } from './MessageReactions';
import { ChatActivityBadge, ChatUnreadStatus } from './ChatUnreadBadge';
import { useChatUnread } from './ChatUnreadContext';

const MESSAGE_MAX_LENGTH = 4000;

const inputClass =
  'w-full px-3 py-2 border rounded-md shadow-sm text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest disabled:bg-cream-100 disabled:text-ink-muted';
const primaryButtonClass =
  'inline-flex items-center justify-center rounded-md bg-forest px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 disabled:opacity-50';

export interface TeamChatViewProps {
  teamId: string;
  teamName?: string;
}

function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function isAccessDenied(error: unknown): boolean {
  if (error instanceof AuthRequiredError) return true;
  if (!(error instanceof ChatApiError)) return false;
  if (error.status === 401) return true;
  return error.status === 403 && error.code !== 'TEAM_CHANNEL_READ_ONLY';
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ChatApiError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function latestMessage(messages: ChatMessageView[]): ChatMessageView | null {
  return messages.reduce<ChatMessageView | null>((latest, message) => {
    if (!latest) return message;
    const byTime = Date.parse(message.createdAt) - Date.parse(latest.createdAt);
    return byTime > 0 || (byTime === 0 && message.id.localeCompare(latest.id) > 0)
      ? message
      : latest;
  }, null);
}

/**
 * US-031 / #383 — confirmed-member private team chat view.
 *
 * It uses the member-gated #381 endpoints and deliberately keeps its state separate from
 * the US-030 public forum page. Draft text is cleared only after a successful send.
 */
export function TeamChatView({
  teamId,
  teamName,
}: TeamChatViewProps): React.JSX.Element {
  const unread = useChatUnread();
  const unreadEnabled = unread.enabled;
  const markRead = unread.markRead;
  const refreshUnread = unread.refresh;
  const [opened, setOpened] = useState(false);
  const [channel, setChannel] = useState<TeamChatChannelView | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const [draft, setDraft] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ChatFieldErrors>({});
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [readStateError, setReadStateError] = useState<string | null>(null);
  const loadRequestId = useRef(0);
  const sendRequestId = useRef(0);

  // US-035 / #406: a confirmed reaction change updates only that message's reactions.
  const updateMessageReactions = useCallback(
    (messageId: string, reactions: ChatReactionSummary[]) =>
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))),
    []
  );

  // Never retain private content or a draft for a previously selected team.
  useEffect(() => {
    loadRequestId.current += 1;
    sendRequestId.current += 1;
    setOpened(false);
    setChannel(null);
    setMessages([]);
    setLoading(false);
    setLoadError(null);
    setAccessDenied(false);
    setDraft('');
    setFieldErrors({});
    setSendError(null);
    setSendSuccess(null);
    setSending(false);
    setReadStateError(null);
  }, [teamId]);

  const loadChat = useCallback(async (): Promise<void> => {
    const requestId = ++loadRequestId.current;
    setOpened(true);
    setLoading(true);
    setLoadError(null);
    setAccessDenied(false);
    setReadStateError(null);
    // Clear before authorization completes so another team's private content can never flash.
    setChannel(null);
    setMessages([]);

    try {
      const [loadedChannel, loadedMessages] = await Promise.all([
        openTeamChat(teamId),
        listTeamChatMessages(teamId),
      ]);
      if (requestId !== loadRequestId.current) return;
      setChannel(loadedChannel);
      setMessages(loadedMessages);
      const latest = latestMessage(loadedMessages);
      if (unreadEnabled && latest) {
        try {
          await markRead({
            conversationType: 'channel',
            conversationId: loadedChannel.id,
            messageId: latest.id,
          });
        } catch {
          if (requestId === loadRequestId.current) {
            setReadStateError(
              'Team messages loaded, but unread activity could not be updated. Existing badges were kept.'
            );
          }
        }
      }
    } catch (error: unknown) {
      if (requestId !== loadRequestId.current) return;
      setChannel(null);
      setMessages([]);
      if (isAccessDenied(error)) {
        setAccessDenied(true);
        if (unreadEnabled) void refreshUnread();
      } else {
        setLoadError(errorMessage(error, 'Could not load team chat. Please try again.'));
      }
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [teamId, unreadEnabled, markRead, refreshUnread]);

  const handleSend = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    if (sending || !channel) return;

    setFieldErrors({});
    setSendError(null);
    setSendSuccess(null);

    const nextErrors: ChatFieldErrors = {};
    if (!draft.trim()) {
      nextErrors.body = 'Message is required.';
    } else if (draft.length > MESSAGE_MAX_LENGTH) {
      nextErrors.body = `Message must be ${MESSAGE_MAX_LENGTH} characters or fewer.`;
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setSending(true);
    const requestId = ++sendRequestId.current;
    try {
      // Keep the exact local draft until the server confirms success.
      const message = await sendTeamChatMessage(teamId, { body: draft });
      if (requestId !== sendRequestId.current) return;
      setMessages((current) => [...current, message]);
      setDraft('');
      setFieldErrors({});
      setSendSuccess('Message sent.');
      if (unreadEnabled) void refreshUnread();
    } catch (error: unknown) {
      if (requestId !== sendRequestId.current) return;
      if (isAccessDenied(error)) {
        setChannel(null);
        setMessages([]);
        setAccessDenied(true);
        if (unreadEnabled) void refreshUnread();
      } else if (error instanceof ChatApiError) {
        setFieldErrors(error.errors ?? {});
        setSendError(error.message || 'Could not send message.');
      } else {
        setSendError(errorMessage(error, 'Could not send message. Please try again.'));
      }
      // Intentionally do not change `draft` on any failure.
    } finally {
      if (requestId === sendRequestId.current) setSending(false);
    }
  };

  return (
    <section
      aria-labelledby="team-chat-heading"
      className="rounded-xl border border-cream-200 bg-white p-5 shadow-sm"
      data-testid="team-chat-view"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3
            id="team-chat-heading"
            className="font-display text-lg font-semibold text-forest-900"
          >
            <span className="inline-flex items-center">
              Team chat
              {channel && (() => {
                const count = unread.getCount('channel', channel.id);
                return (
                  <ChatActivityBadge
                    unreadCount={count?.unreadCount ?? 0}
                    mentionCount={count?.unreadMentionCount ?? 0}
                    label="Team chat"
                  />
                );
              })()}
            </span>
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            Private messages for confirmed {teamName ? `${teamName} ` : ''}team members.
          </p>
        </div>
        {!opened ? (
          <button type="button" onClick={() => void loadChat()} className={primaryButtonClass}>
            Open team chat
          </button>
        ) : (
          <div className="flex flex-wrap gap-2">
            {channel && (
              <button
                type="button"
                onClick={() => void loadChat()}
                disabled={loading || sending}
                className="rounded-md border border-cream-300 px-3 py-2 text-xs font-semibold text-forest-800 hover:bg-cream-50 disabled:opacity-50"
              >
                Refresh messages
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpened(false)}
              className="rounded-md border border-cream-300 px-3 py-2 text-xs font-semibold text-ink-muted hover:bg-cream-50"
            >
              Close
            </button>
          </div>
        )}
      </div>

      <div className="mt-2">
        <ChatUnreadStatus />
      </div>

      {opened && (
        <div className="mt-5" aria-live="polite">
          {loading ? (
            <div
              role="status"
              aria-busy="true"
              className="rounded-md border border-cream-200 bg-cream-50 p-8 text-center text-sm text-ink-muted"
            >
              Loading private team chat…
            </div>
          ) : accessDenied ? (
            <div
              role="alert"
              data-testid="team-chat-access-denied"
              className="rounded-md border border-amber-200 bg-amber-50 p-5 text-amber-900"
            >
              <h4 className="font-semibold">Team chat access denied</h4>
              <p className="mt-1 text-sm">
                Private team chat is available only to active, confirmed members of this team.
              </p>
            </div>
          ) : loadError ? (
            <div
              role="alert"
              data-testid="team-chat-load-error"
              className="rounded-md border border-red-200 bg-red-50 p-5 text-red-900"
            >
              <h4 className="font-semibold">Could not load team chat</h4>
              <p className="mt-1 text-sm">{loadError}</p>
              <button
                type="button"
                onClick={() => void loadChat()}
                className="mt-3 rounded-md bg-forest px-3 py-2 text-xs font-semibold text-white hover:bg-forest-800"
              >
                Retry
              </button>
            </div>
          ) : channel ? (
            <div className="space-y-4">
              <div className="border-b border-cream-200 pb-3">
                <h4 className="font-semibold text-forest-900">{channel.title}</h4>
                <p className="mt-1 text-xs text-ink-muted">{channel.description}</p>
              </div>

              {readStateError && (
                <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  {readStateError}
                </p>
              )}

              {messages.length === 0 ? (
                <div
                  role="status"
                  data-testid="team-chat-empty"
                  className="rounded-md border border-dashed border-cream-300 p-8 text-center text-sm text-ink-muted"
                >
                  No team messages yet. Start the conversation below.
                </div>
              ) : (
                <ul className="max-h-80 space-y-3 overflow-y-auto pr-1" aria-label="Team messages">
                  {messages.map((message) => (
                    <li
                      key={message.id}
                      data-testid="team-chat-message"
                      className="rounded-md border border-cream-100 bg-cream-50/80 px-3 py-2"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-forest-900">
                          {message.authorHandle || 'participant'}
                        </span>
                        <time
                          dateTime={message.createdAt}
                          className="whitespace-nowrap text-xs text-ink-muted"
                        >
                          {formatMessageTime(message.createdAt)}
                        </time>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">
                        {message.body}
                      </p>
                      <MessageReactions
                        target={{ kind: 'team', teamId }}
                        messageId={message.id}
                        reactions={message.reactions}
                        onReactionsChange={updateMessageReactions}
                      />
                    </li>
                  ))}
                </ul>
              )}

              <form
                onSubmit={handleSend}
                noValidate
                className="space-y-2 border-t border-cream-200 pt-4"
                data-testid="team-chat-composer"
              >
                <label htmlFor="team-chat-message" className="block text-sm font-medium text-forest-900">
                  Message
                </label>
                <textarea
                  id="team-chat-message"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={sending}
                  rows={3}
                  maxLength={MESSAGE_MAX_LENGTH}
                  aria-invalid={Boolean(fieldErrors.body)}
                  aria-describedby={fieldErrors.body ? 'team-chat-message-error' : undefined}
                  placeholder="Write a private team message…"
                  className={`${inputClass} ${fieldErrors.body ? 'border-red-400' : 'border-cream-300'}`}
                />
                <div className="flex items-center justify-between gap-3 text-xs text-ink-muted">
                  <span>{draft.length}/{MESSAGE_MAX_LENGTH}</span>
                </div>
                {fieldErrors.body && (
                  <p id="team-chat-message-error" role="alert" className="text-xs text-red-700">
                    {fieldErrors.body}
                  </p>
                )}
                {sendError && (
                  <p role="alert" className="text-xs text-red-700">
                    {sendError}
                  </p>
                )}
                {sendSuccess && (
                  <p role="status" className="text-xs text-forest-800">
                    {sendSuccess}
                  </p>
                )}
                <button type="submit" disabled={sending} className={primaryButtonClass}>
                  {sending ? 'Sending…' : 'Send message'}
                </button>
              </form>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

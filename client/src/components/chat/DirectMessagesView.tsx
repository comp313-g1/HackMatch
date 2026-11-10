import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AuthRequiredError,
  ChatApiError,
  getDirectMessageThread,
  listDirectMessageThreads,
  sendDirectMessage,
} from './chatApi';
import type {
  ChatFieldErrors,
  DirectMessageThreadView,
  DirectMessageView,
} from './chatTypes';
import { ChatActivityBadge } from './ChatUnreadBadge';
import { useChatUnread } from './ChatUnreadContext';

const MESSAGE_MAX_LENGTH = 4000;

const inputClass =
  'w-full px-3 py-2 border rounded-md shadow-sm text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest disabled:bg-cream-100 disabled:text-ink-muted';
const primaryButtonClass =
  'inline-flex items-center justify-center rounded-md bg-forest px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 disabled:opacity-50';

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ChatApiError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function isAccessDenied(error: unknown): boolean {
  if (error instanceof AuthRequiredError) return true;
  return error instanceof ChatApiError && (error.status === 401 || error.status === 403);
}

function sortMessages(messages: DirectMessageView[]): DirectMessageView[] {
  return [...messages].sort((left, right) => {
    const byTime = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    return byTime || left.id.localeCompare(right.id);
  });
}

/**
 * US-032 / #389 — one-to-one direct-message inbox, thread, and composer.
 *
 * Private thread contents are cleared before each authorization-sensitive load. Drafts are
 * retained per thread and are removed only after the server confirms a successful send.
 */
export function DirectMessagesView(): React.JSX.Element {
  const unread = useChatUnread();
  const unreadEnabled = unread.enabled;
  const markRead = unread.markRead;
  const refreshUnread = unread.refresh;
  const [threads, setThreads] = useState<DirectMessageThreadView[]>([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [inboxAccessDenied, setInboxAccessDenied] = useState(false);

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<DirectMessageThreadView | null>(null);
  const [messages, setMessages] = useState<DirectMessageView[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadAccessDenied, setThreadAccessDenied] = useState(false);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<ChatFieldErrors>({});
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [readStateError, setReadStateError] = useState<string | null>(null);

  const inboxRequestId = useRef(0);
  const threadRequestId = useRef(0);
  const sendRequestId = useRef(0);

  const draft = selectedThreadId ? drafts[selectedThreadId] ?? '' : '';

  const loadInbox = useCallback(async (): Promise<void> => {
    const requestId = ++inboxRequestId.current;
    setInboxLoading(true);
    setInboxError(null);
    setInboxAccessDenied(false);
    try {
      const loadedThreads = await listDirectMessageThreads();
      if (requestId !== inboxRequestId.current) return;
      setThreads(loadedThreads);
    } catch (error: unknown) {
      if (requestId !== inboxRequestId.current) return;
      setThreads([]);
      setSelectedThreadId(null);
      setSelectedThread(null);
      setMessages([]);
      if (isAccessDenied(error)) {
        setInboxAccessDenied(true);
        if (unreadEnabled) void refreshUnread();
      } else {
        setInboxError(errorMessage(error, 'Could not load direct messages. Please try again.'));
      }
    } finally {
      if (requestId === inboxRequestId.current) setInboxLoading(false);
    }
  }, [unreadEnabled, refreshUnread]);

  useEffect(() => {
    void loadInbox();
    return () => {
      inboxRequestId.current += 1;
      threadRequestId.current += 1;
      sendRequestId.current += 1;
    };
  }, [loadInbox]);

  const loadThread = useCallback(async (threadId: string): Promise<void> => {
    const requestId = ++threadRequestId.current;
    setSelectedThreadId(threadId);
    setSelectedThread(null);
    setMessages([]);
    setThreadLoading(true);
    setThreadError(null);
    setThreadAccessDenied(false);
    setFieldErrors({});
    setSendError(null);
    setSendSuccess(null);
    setReadStateError(null);

    try {
      const detail = await getDirectMessageThread(threadId);
      if (requestId !== threadRequestId.current) return;
      setSelectedThread(detail.thread);
      const orderedMessages = sortMessages(detail.messages);
      setMessages(orderedMessages);
      const latest = orderedMessages.at(-1);
      if (unreadEnabled && latest) {
        try {
          await markRead({
            conversationType: 'directMessage',
            conversationId: threadId,
            messageId: latest.id,
          });
        } catch {
          if (requestId === threadRequestId.current) {
            setReadStateError(
              'Conversation loaded, but unread activity could not be updated. Existing badges were kept.'
            );
          }
        }
      }
    } catch (error: unknown) {
      if (requestId !== threadRequestId.current) return;
      setSelectedThread(null);
      setMessages([]);
      if (isAccessDenied(error)) {
        setThreadAccessDenied(true);
        if (unreadEnabled) void refreshUnread();
      } else {
        setThreadError(errorMessage(error, 'Could not load this conversation. Please try again.'));
      }
    } finally {
      if (requestId === threadRequestId.current) setThreadLoading(false);
    }
  }, [unreadEnabled, markRead, refreshUnread]);

  const updateDraft = (value: string): void => {
    if (!selectedThreadId) return;
    setDrafts((current) => ({ ...current, [selectedThreadId]: value }));
  };

  const handleSend = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!selectedThreadId || !selectedThread || sending) return;

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

    const submittedDraft = draft;
    const requestId = ++sendRequestId.current;
    setSending(true);
    try {
      const sent = await sendDirectMessage(selectedThreadId, { body: submittedDraft });
      if (requestId !== sendRequestId.current) return;
      setMessages((current) =>
        sortMessages([...current.filter((message) => message.id !== sent.id), sent])
      );
      setDrafts((current) => ({ ...current, [selectedThreadId]: '' }));
      setFieldErrors({});
      setSendSuccess('Message sent.');
      setThreads((current) =>
        current
          .map((thread) =>
            thread.id === selectedThreadId
              ? { ...thread, lastMessage: sent, lastMessageAt: sent.createdAt }
              : thread
          )
          .sort(
            (left, right) =>
              Date.parse(right.lastMessageAt ?? right.updatedAt) -
              Date.parse(left.lastMessageAt ?? left.updatedAt)
          )
      );
      if (unreadEnabled) void refreshUnread();
    } catch (error: unknown) {
      if (requestId !== sendRequestId.current) return;
      if (error instanceof ChatApiError && error.errors) {
        setFieldErrors(error.errors);
      }
      if (error instanceof ChatApiError) {
        const submitted = error.submitted as { body?: unknown } | undefined;
        if (typeof submitted?.body === 'string') updateDraft(submitted.body);
      }
      if (isAccessDenied(error)) {
        setSelectedThread(null);
        setMessages([]);
        setThreadAccessDenied(true);
        if (unreadEnabled) void refreshUnread();
      } else {
        setSendError(errorMessage(error, 'Could not send message. Your draft has been kept.'));
      }
      // Do not clear the draft on validation, authorization, network, or server failure.
    } finally {
      if (requestId === sendRequestId.current) setSending(false);
    }
  };

  return (
    <section aria-labelledby="direct-messages-heading" data-testid="direct-messages-view">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-xl border border-cream-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="direct-messages-heading" className="font-display text-lg font-semibold text-forest-900">
                  Direct messages
                </h2>
                <p className="mt-1 text-xs text-ink-muted">Private one-to-one participant conversations.</p>
              </div>
              {!inboxLoading && !inboxAccessDenied && (
                <button
                  type="button"
                  onClick={() => {
                    void loadInbox();
                    if (unreadEnabled) void refreshUnread();
                  }}
                  className="rounded-md border border-cream-300 px-3 py-2 text-xs font-semibold text-forest-800 hover:bg-cream-50"
                >
                  Refresh inbox
                </button>
              )}
            </div>

            <div className="mt-4" data-testid="dm-inbox">
              {inboxLoading ? (
                <div role="status" aria-busy="true" className="py-8 text-center text-sm text-ink-muted">
                  Loading direct messages…
                </div>
              ) : inboxAccessDenied ? (
                <div role="alert" data-testid="dm-inbox-access-denied" className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  Direct messages are available only to verified, active participants.
                </div>
              ) : inboxError ? (
                <div role="alert" data-testid="dm-inbox-error" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                  <p>{inboxError}</p>
                  <button type="button" onClick={() => void loadInbox()} className="mt-3 rounded-md bg-forest px-3 py-2 text-xs font-semibold text-white">
                    Retry
                  </button>
                </div>
              ) : threads.length === 0 ? (
                <div role="status" data-testid="dm-inbox-empty" className="rounded-md border border-dashed border-cream-300 px-4 py-8 text-center text-sm text-ink-muted">
                  No direct-message conversations yet.
                </div>
              ) : (
                <ul className="divide-y divide-cream-200 overflow-hidden rounded-md border border-cream-200" aria-label="Direct-message conversations">
                  {threads.map((thread) => (
                    <li key={thread.id}>
                      <button
                        type="button"
                        onClick={() => void loadThread(thread.id)}
                        aria-current={selectedThreadId === thread.id ? 'true' : undefined}
                        className={`w-full px-3 py-3 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-forest ${
                          selectedThreadId === thread.id ? 'bg-forest-50' : 'bg-white hover:bg-cream-50'
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="block min-w-0 truncate text-sm font-semibold text-forest-900">
                            {thread.peer.handle || 'Participant'}
                          </span>
                          {(() => {
                            const count = unread.getCount('directMessage', thread.id);
                            return (
                              <ChatActivityBadge
                                unreadCount={count?.unreadCount ?? 0}
                                mentionCount={count?.unreadMentionCount ?? 0}
                                label={`Direct messages with ${thread.peer.handle || 'Participant'}`}
                              />
                            );
                          })()}
                        </span>
                        <span className="mt-1 block truncate text-xs text-ink-muted">
                          {thread.lastMessage?.body || 'No messages yet'}
                        </span>
                        <time dateTime={thread.lastMessageAt ?? thread.updatedAt} className="mt-1 block text-xs text-ink-muted">
                          {formatTimestamp(thread.lastMessageAt ?? thread.updatedAt)}
                        </time>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className="flex min-h-[28rem] flex-col rounded-xl border border-cream-200 bg-white p-4 shadow-sm" data-testid="dm-thread-panel">
            {!selectedThreadId ? (
              <div role="status" className="flex flex-1 items-center justify-center rounded-md border border-dashed border-cream-300 text-sm text-ink-muted">
                Select a conversation to read and send messages.
              </div>
            ) : threadLoading ? (
              <div role="status" aria-busy="true" className="flex flex-1 items-center justify-center text-sm text-ink-muted">
                Loading conversation…
              </div>
            ) : threadAccessDenied ? (
              <div role="alert" data-testid="dm-thread-access-denied" className="rounded-md border border-amber-200 bg-amber-50 p-5 text-amber-900">
                <h3 className="font-semibold">Direct-message access denied</h3>
                <p className="mt-1 text-sm">This private conversation is not available.</p>
                <button type="button" onClick={() => void loadThread(selectedThreadId)} className="mt-3 rounded-md bg-forest px-3 py-2 text-xs font-semibold text-white">
                  Retry
                </button>
              </div>
            ) : threadError ? (
              <div role="alert" data-testid="dm-thread-error" className="rounded-md border border-red-200 bg-red-50 p-5 text-red-900">
                <h3 className="font-semibold">Could not load conversation</h3>
                <p className="mt-1 text-sm">{threadError}</p>
                <button type="button" onClick={() => void loadThread(selectedThreadId)} className="mt-3 rounded-md bg-forest px-3 py-2 text-xs font-semibold text-white">
                  Retry
                </button>
              </div>
            ) : selectedThread ? (
              <>
                <div className="border-b border-cream-200 pb-3">
                  <h3 className="font-display text-lg font-semibold text-forest-900">
                    {selectedThread.peer.handle || 'Participant'}
                  </h3>
                  <p className="mt-1 text-xs text-ink-muted">Private direct-message conversation</p>
                </div>

                {readStateError && (
                  <p role="alert" className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    {readStateError}
                  </p>
                )}

                {messages.length === 0 ? (
                  <div role="status" data-testid="dm-thread-empty" className="my-4 flex flex-1 items-center justify-center rounded-md border border-dashed border-cream-300 p-8 text-center text-sm text-ink-muted">
                    No messages yet. Start the conversation below.
                  </div>
                ) : (
                  <ul className="my-4 max-h-80 flex-1 space-y-3 overflow-y-auto pr-1" aria-label="Direct messages">
                    {messages.map((message) => (
                      <li key={message.id} data-testid="dm-message" className="rounded-md border border-cream-100 bg-cream-50/80 px-3 py-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold text-forest-900">{message.authorHandle || 'Participant'}</span>
                          <time dateTime={message.createdAt} className="whitespace-nowrap text-xs text-ink-muted">
                            {formatTimestamp(message.createdAt)}
                          </time>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{message.body}</p>
                      </li>
                    ))}
                  </ul>
                )}

                <form onSubmit={handleSend} noValidate data-testid="dm-composer" className="space-y-2 border-t border-cream-200 pt-4">
                  <label htmlFor="dm-message-body" className="block text-sm font-medium text-forest-900">Message</label>
                  <textarea
                    id="dm-message-body"
                    value={draft}
                    onChange={(event) => updateDraft(event.target.value)}
                    disabled={sending}
                    rows={3}
                    maxLength={MESSAGE_MAX_LENGTH}
                    aria-invalid={Boolean(fieldErrors.body)}
                    aria-describedby={fieldErrors.body ? 'dm-message-error' : undefined}
                    placeholder="Write a direct message…"
                    className={`${inputClass} ${fieldErrors.body ? 'border-red-400' : 'border-cream-300'}`}
                  />
                  <div className="text-xs text-ink-muted">{draft.length}/{MESSAGE_MAX_LENGTH}</div>
                  {fieldErrors.body && <p id="dm-message-error" role="alert" className="text-xs text-red-700">{fieldErrors.body}</p>}
                  {sendError && <p role="alert" className="text-xs text-red-700">{sendError}</p>}
                  {sendSuccess && <p role="status" className="text-xs text-forest-800">{sendSuccess}</p>}
                  <button type="submit" disabled={sending} className={primaryButtonClass}>
                    {sending ? 'Sending…' : 'Send message'}
                  </button>
                </form>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

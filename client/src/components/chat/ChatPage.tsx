import React, { useEffect, useState } from 'react';
import {
  AuthRequiredError,
  ChatApiError,
  createChatChannel,
  fetchMyPresence,
  listChatChannels,
  listChatMessages,
  sendChatMessage,
  updateMyPresence,
} from './chatApi';
import {
  PRESENCE_STATUSES,
  type ChatChannelView,
  type ChatFieldErrors,
  type ChatMessageView,
  type PresenceStatus,
} from './chatTypes';

export interface ChatPageProps {
  onNavigateToSignIn?: () => void;
  onNavigateAway?: () => void;
}

const inputClass =
  'w-full px-3 py-2 border rounded-md shadow-sm text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest disabled:bg-cream-100 disabled:text-ink-muted';
const primaryBtnClass =
  'inline-flex items-center justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50 transition-colors';

function formatMessageTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function isAccessDenied(err: unknown): boolean {
  if (err instanceof AuthRequiredError) return true;
  if (err instanceof ChatApiError && (err.status === 401 || err.status === 403)) {
    return true;
  }
  return false;
}

/**
 * US-030 / #346 — Chat page: presence status, forum list/create, message thread.
 * Loading / empty / validation / success / error; drafts kept on failure (NR-017).
 */
export function ChatPage({
  onNavigateToSignIn,
  onNavigateAway,
}: ChatPageProps): React.JSX.Element {
  const [presenceStatus, setPresenceStatus] = useState<PresenceStatus>('Invisible');
  const [presenceSaving, setPresenceSaving] = useState(false);
  const [presenceNotice, setPresenceNotice] = useState<string | null>(null);
  const [presenceError, setPresenceError] = useState<string | null>(null);

  const [channels, setChannels] = useState<ChatChannelView[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelsError, setChannelsError] = useState<string | null>(null);

  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  const [titleDraft, setTitleDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [createErrors, setCreateErrors] = useState<ChatFieldErrors>({});
  const [createFormError, setCreateFormError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [messageDraft, setMessageDraft] = useState('');
  const [messageErrors, setMessageErrors] = useState<ChatFieldErrors>({});
  const [messageFormError, setMessageFormError] = useState<string | null>(null);
  const [messageSuccess, setMessageSuccess] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const [accessDenied, setAccessDenied] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const selectedChannel =
    channels.find((c) => c.id === selectedChannelId) ?? null;

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setChannelsLoading(true);
      setChannelsError(null);
      setPageError(null);
      setAccessDenied(false);

      try {
        const [presence, channelList] = await Promise.all([
          fetchMyPresence(),
          listChatChannels(),
        ]);
        if (cancelled) return;
        setPresenceStatus(presence.presenceStatus);
        setChannels(channelList);
      } catch (err: unknown) {
        if (cancelled) return;
        if (isAccessDenied(err)) {
          setAccessDenied(true);
          return;
        }
        setPageError(
          err instanceof Error ? err.message : 'Failed to load chat.'
        );
      } finally {
        if (!cancelled) setChannelsLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedChannelId) {
      setMessages([]);
      setMessagesError(null);
      return;
    }

    let cancelled = false;

    async function loadMessages() {
      setMessagesLoading(true);
      setMessagesError(null);
      try {
        const rows = await listChatMessages(selectedChannelId!);
        if (!cancelled) setMessages(rows);
      } catch (err: unknown) {
        if (cancelled) return;
        if (isAccessDenied(err)) {
          setAccessDenied(true);
          return;
        }
        setMessagesError(
          err instanceof Error ? err.message : 'Failed to load messages.'
        );
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    }

    void loadMessages();
    return () => {
      cancelled = true;
    };
  }, [selectedChannelId]);

  const handlePresenceChange = async (
    next: PresenceStatus
  ): Promise<void> => {
    const previous = presenceStatus;
    setPresenceStatus(next);
    setPresenceSaving(true);
    setPresenceError(null);
    setPresenceNotice(null);
    try {
      const updated = await updateMyPresence(next);
      setPresenceStatus(updated.presenceStatus);
      setPresenceNotice(`Status set to ${updated.presenceStatus}.`);
    } catch (err: unknown) {
      setPresenceStatus(previous);
      if (isAccessDenied(err)) {
        setAccessDenied(true);
        return;
      }
      setPresenceError(
        err instanceof ChatApiError
          ? err.message
          : 'Could not update presence status.'
      );
    } finally {
      setPresenceSaving(false);
    }
  };

  const handleCreateChannel = async (
    e: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    e.preventDefault();
    if (creating) return;

    setCreateSuccess(null);
    setCreateFormError(null);

    const local: ChatFieldErrors = {};
    if (!titleDraft.trim()) local.title = 'title is required.';
    if (!descriptionDraft.trim()) local.description = 'description is required.';
    setCreateErrors(local);
    if (Object.keys(local).length > 0) {
      // Drafts kept in titleDraft / descriptionDraft (NR-017).
      return;
    }

    setCreating(true);
    const payload = {
      title: titleDraft.trim(),
      description: descriptionDraft.trim(),
    };

    try {
      const channel = await createChatChannel(payload);
      setChannels((prev) => [channel, ...prev.filter((c) => c.id !== channel.id)]);
      setSelectedChannelId(channel.id);
      setTitleDraft('');
      setDescriptionDraft('');
      setCreateErrors({});
      setCreateSuccess(`Forum "${channel.title}" created.`);
    } catch (err: unknown) {
      if (isAccessDenied(err)) {
        setAccessDenied(true);
        return;
      }
      if (err instanceof ChatApiError) {
        if (err.errors) setCreateErrors(err.errors);
        // Keep drafts — restore from submitted echo when present.
        const submitted = err.submitted as
          | { title?: string; description?: string }
          | undefined;
        if (submitted && typeof submitted === 'object') {
          if (typeof submitted.title === 'string') setTitleDraft(submitted.title);
          if (typeof submitted.description === 'string') {
            setDescriptionDraft(submitted.description);
          }
        }
        setCreateFormError(err.message);
      } else {
        setCreateFormError('Could not create forum.');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleSendMessage = async (
    e: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    e.preventDefault();
    if (sending || !selectedChannelId) return;

    setMessageSuccess(null);
    setMessageFormError(null);

    const local: ChatFieldErrors = {};
    if (!messageDraft.trim()) local.body = 'body is required.';
    setMessageErrors(local);
    if (Object.keys(local).length > 0) {
      return;
    }

    setSending(true);
    const payload = { body: messageDraft.trim() };

    try {
      const message = await sendChatMessage(selectedChannelId, payload);
      setMessages((prev) => [...prev, message]);
      setMessageDraft('');
      setMessageErrors({});
      setMessageSuccess('Message sent.');
    } catch (err: unknown) {
      if (isAccessDenied(err)) {
        setAccessDenied(true);
        return;
      }
      if (err instanceof ChatApiError) {
        if (err.errors) setMessageErrors(err.errors);
        const submitted = err.submitted as { body?: string } | undefined;
        if (submitted && typeof submitted.body === 'string') {
          setMessageDraft(submitted.body);
        }
        setMessageFormError(err.message);
      } else {
        setMessageFormError('Could not send message.');
      }
    } finally {
      setSending(false);
    }
  };

  if (accessDenied) {
    return (
      <div className="max-w-3xl mx-auto space-y-6" data-testid="chat-access-denied">
        {onNavigateAway && (
          <button
            type="button"
            onClick={onNavigateAway}
            className="inline-flex items-center gap-1 text-sm font-medium text-forest hover:underline"
          >
            ← Back
          </button>
        )}
        <div
          role="alert"
          className="bg-white rounded-xl border border-cream-200 shadow-sm p-8 text-center space-y-4"
        >
          <h2 className="text-xl font-display font-semibold text-forest-900">
            Sign in required for Chat
          </h2>
          <p className="text-sm text-ink-muted max-w-md mx-auto">
            Forums and messaging are available to verified, active participants
            only. Visitors and suspended or unverified accounts cannot use chat.
          </p>
          {onNavigateToSignIn && (
            <button type="button" onClick={onNavigateToSignIn} className={primaryBtnClass}>
              Sign in
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6" data-testid="chat-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-forest-900">
            Chat
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Set your presence, open topic forums, and send messages in-app.
          </p>
        </div>

        <div className="flex flex-col gap-1 min-w-[12rem]" data-testid="presence-picker">
          <label htmlFor="presence-status" className="text-xs font-medium text-ink-muted">
            Presence status
          </label>
          <select
            id="presence-status"
            value={presenceStatus}
            disabled={presenceSaving || channelsLoading}
            onChange={(e) => {
              void handlePresenceChange(e.target.value as PresenceStatus);
            }}
            className={inputClass}
            aria-describedby={
              presenceError
                ? 'presence-error'
                : presenceNotice
                  ? 'presence-success'
                  : undefined
            }
          >
            {PRESENCE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          {presenceSaving && (
            <p className="text-xs text-ink-muted" aria-live="polite">
              Updating status…
            </p>
          )}
          {presenceNotice && (
            <p id="presence-success" role="status" className="text-xs text-forest-800">
              {presenceNotice}
            </p>
          )}
          {presenceError && (
            <p id="presence-error" role="alert" className="text-xs text-red-700">
              {presenceError}
            </p>
          )}
        </div>
      </div>

      {pageError && (
        <div role="alert" className="p-3 text-sm text-red-800 bg-red-50 border border-red-100 rounded-md">
          {pageError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Forums column */}
        <section
          aria-labelledby="forums-heading"
          className="lg:col-span-2 space-y-4"
        >
          <div className="rounded-xl border border-cream-200 bg-white shadow-sm p-4 space-y-4">
            <h2 id="forums-heading" className="font-display text-lg font-semibold text-forest-900">
              Forums
            </h2>

            <form
              onSubmit={handleCreateChannel}
              className="space-y-3"
              noValidate
              data-testid="create-forum-form"
            >
              <div>
                <label htmlFor="forum-title" className="block text-xs font-medium text-ink-muted">
                  Title
                </label>
                <input
                  id="forum-title"
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  disabled={creating}
                  className={`${inputClass} mt-1 ${createErrors.title ? 'border-red-400' : 'border-cream-300'}`}
                  aria-invalid={Boolean(createErrors.title)}
                  maxLength={120}
                />
                {createErrors.title && (
                  <p className="mt-1 text-xs text-red-700" role="alert">
                    {createErrors.title}
                  </p>
                )}
              </div>
              <div>
                <label
                  htmlFor="forum-description"
                  className="block text-xs font-medium text-ink-muted"
                >
                  Description
                </label>
                <textarea
                  id="forum-description"
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  disabled={creating}
                  rows={3}
                  className={`${inputClass} mt-1 ${createErrors.description ? 'border-red-400' : 'border-cream-300'}`}
                  aria-invalid={Boolean(createErrors.description)}
                  maxLength={2000}
                />
                {createErrors.description && (
                  <p className="mt-1 text-xs text-red-700" role="alert">
                    {createErrors.description}
                  </p>
                )}
              </div>
              {createFormError && (
                <p role="alert" className="text-xs text-red-700">
                  {createFormError}
                </p>
              )}
              {createSuccess && (
                <p role="status" className="text-xs text-forest-800">
                  {createSuccess}
                </p>
              )}
              <button type="submit" className={primaryBtnClass} disabled={creating}>
                {creating ? 'Creating…' : 'Create forum'}
              </button>
            </form>

            <div data-testid="forum-list">
              {channelsLoading ? (
                <div
                  role="status"
                  aria-busy="true"
                  className="py-8 text-center text-sm text-ink-muted"
                >
                  Loading forums…
                </div>
              ) : channelsError ? (
                <div role="alert" className="py-4 text-sm text-red-700">
                  {channelsError}
                </div>
              ) : channels.length === 0 ? (
                <div
                  role="status"
                  className="py-8 text-center text-sm text-ink-muted border border-dashed border-cream-300 rounded-md"
                  data-testid="forums-empty"
                >
                  No forums yet. Create one with a title and description.
                </div>
              ) : (
                <ul className="divide-y divide-cream-200 border border-cream-200 rounded-md overflow-hidden">
                  {channels.map((channel) => {
                    const selected = channel.id === selectedChannelId;
                    return (
                      <li key={channel.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedChannelId(channel.id)}
                          aria-current={selected ? 'true' : undefined}
                          className={`w-full text-left px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-inset focus:ring-forest ${
                            selected
                              ? 'bg-forest-50 text-forest-900'
                              : 'bg-white hover:bg-cream-50 text-ink'
                          }`}
                        >
                          <span className="font-semibold block truncate">
                            {channel.title}
                          </span>
                          <span className="text-xs text-ink-muted line-clamp-2">
                            {channel.description}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </section>

        {/* Message thread column */}
        <section
          aria-labelledby="thread-heading"
          className="lg:col-span-3"
        >
          <div className="rounded-xl border border-cream-200 bg-white shadow-sm p-4 min-h-[28rem] flex flex-col">
            <h2 id="thread-heading" className="font-display text-lg font-semibold text-forest-900">
              {selectedChannel ? selectedChannel.title : 'Message thread'}
            </h2>
            {selectedChannel && (
              <p className="mt-1 text-xs text-ink-muted">{selectedChannel.description}</p>
            )}

            <div className="mt-4 flex-1 flex flex-col min-h-0" data-testid="message-thread">
              {!selectedChannelId ? (
                <div
                  role="status"
                  className="flex-1 flex items-center justify-center text-sm text-ink-muted border border-dashed border-cream-300 rounded-md"
                  data-testid="thread-empty-selection"
                >
                  Select a forum to read and send messages.
                </div>
              ) : messagesLoading ? (
                <div
                  role="status"
                  aria-busy="true"
                  className="flex-1 flex items-center justify-center text-sm text-ink-muted"
                >
                  Loading messages…
                </div>
              ) : messagesError ? (
                <div role="alert" className="text-sm text-red-700 py-4">
                  {messagesError}
                </div>
              ) : messages.length === 0 ? (
                <div
                  role="status"
                  className="flex-1 flex items-center justify-center text-sm text-ink-muted border border-dashed border-cream-300 rounded-md"
                  data-testid="messages-empty"
                >
                  No messages yet. Say hello below.
                </div>
              ) : (
                <ul className="flex-1 overflow-y-auto space-y-3 max-h-[22rem] pr-1">
                  {messages.map((message) => (
                    <li
                      key={message.id}
                      className="rounded-md border border-cream-100 bg-cream-50/80 px-3 py-2"
                      data-testid="chat-message"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-forest-900">
                          {message.authorHandle || 'participant'}
                        </span>
                        <time
                          dateTime={message.createdAt}
                          className="text-xs text-ink-muted whitespace-nowrap"
                        >
                          {formatMessageTime(message.createdAt)}
                        </time>
                      </div>
                      <p className="mt-1 text-sm text-ink whitespace-pre-wrap break-words">
                        {message.body}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {selectedChannelId && (
                <form
                  onSubmit={handleSendMessage}
                  className="mt-4 space-y-2 border-t border-cream-200 pt-4"
                  noValidate
                  data-testid="send-message-form"
                >
                  <label htmlFor="message-body" className="sr-only">
                    Message
                  </label>
                  <textarea
                    id="message-body"
                    value={messageDraft}
                    onChange={(e) => setMessageDraft(e.target.value)}
                    disabled={sending}
                    rows={3}
                    placeholder="Write a message…"
                    className={`${inputClass} ${messageErrors.body ? 'border-red-400' : 'border-cream-300'}`}
                    aria-invalid={Boolean(messageErrors.body)}
                    maxLength={4000}
                  />
                  {messageErrors.body && (
                    <p className="text-xs text-red-700" role="alert">
                      {messageErrors.body}
                    </p>
                  )}
                  {messageFormError && (
                    <p role="alert" className="text-xs text-red-700">
                      {messageFormError}
                    </p>
                  )}
                  {messageSuccess && (
                    <p role="status" className="text-xs text-forest-800">
                      {messageSuccess}
                    </p>
                  )}
                  <button type="submit" className={primaryBtnClass} disabled={sending}>
                    {sending ? 'Sending…' : 'Send message'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

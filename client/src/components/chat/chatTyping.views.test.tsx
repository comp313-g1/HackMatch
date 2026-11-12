/**
 * US-035 / #408 — typing indicators inside the forum, team-chat, and direct-message
 * views: the right routes, one stream per open conversation, cleanup on navigation,
 * and no effect on sending, reactions, unread state, or read cursors.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as chatApi from './chatApi';
import { ChatCapabilitiesProvider } from './ChatCapabilitiesContext';
import { ChatUnreadProvider } from './ChatUnreadContext';
import { ChatPage } from './ChatPage';
import { TeamChatView } from './TeamChatView';
import { DirectMessagesView } from './DirectMessagesView';
import {
  CHAT_REACTION_CODES,
  type ChatChannelView,
  type ChatConversationTarget,
  type ChatMessageView,
  type DirectMessageThreadView,
  type TeamChatChannelView,
} from './chatTypes';
import type { TypingStreamHandlers } from './typingStream';

const fake = vi.hoisted(() => ({
  connections: [] as Array<{ target: unknown; handlers: unknown; stop: ReturnType<typeof import('vitest').vi.fn> }>,
}));

vi.mock('./typingStream', async () => {
  const actual = await vi.importActual<typeof import('./typingStream')>('./typingStream');
  const { vi: v } = await import('vitest');
  return {
    ...actual,
    connectTypingStream: v.fn((target: unknown, handlers: unknown) => {
      const connection = { target, handlers, stop: v.fn() };
      fake.connections.push(connection);
      return connection.stop;
    }),
  };
});

vi.mock('./chatApi', async () => {
  const actual = await vi.importActual<typeof import('./chatApi')>('./chatApi');
  return {
    ...actual,
    fetchMyPresence: vi.fn(),
    listChatChannels: vi.fn(),
    listChatMessages: vi.fn(),
    sendChatMessage: vi.fn(),
    openTeamChat: vi.fn(),
    listTeamChatMessages: vi.fn(),
    sendTeamChatMessage: vi.fn(),
    listDirectMessageThreads: vi.fn(),
    getDirectMessageThread: vi.fn(),
    sendDirectMessage: vi.fn(),
    fetchChatUnreadSummary: vi.fn(),
    markChatConversationRead: vi.fn(),
    fetchChatCapabilities: vi.fn(),
    setChatMessageReaction: vi.fn(),
    signalChatTyping: vi.fn(),
  };
});

const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const FORUM_A = id(1);
const FORUM_B = id(2);
const TEAM_A = id(3);
const TEAM_B = id(4);
const THREAD_A = id(5);
const THREAD_B = id(6);
const MESSAGE = id(7);

const forum = (channelId: string, title: string): ChatChannelView => ({
  id: channelId,
  title,
  description: `${title} forum`,
  createdBy: id(9),
  createdAt: '2026-11-12T10:00:00.000Z',
  updatedAt: '2026-11-12T10:00:00.000Z',
});

const message = (channelId: string, overrides: Partial<ChatMessageView> = {}): ChatMessageView => ({
  id: MESSAGE,
  channelId,
  authorId: id(9),
  authorHandle: 'avery',
  body: 'Hello there',
  createdAt: '2026-11-12T10:05:00.000Z',
  reactions: [{ reaction: 'heart', count: 1, reactedByMe: false }],
  ...overrides,
});

const thread = (threadId: string, handle: string): DirectMessageThreadView => ({
  id: threadId,
  peer: { id: id(8), handle },
  createdAt: '2026-11-12T10:00:00.000Z',
  updatedAt: '2026-11-12T10:00:00.000Z',
  lastMessageAt: '2026-11-12T10:05:00.000Z',
});

function withProviders(ui: React.ReactElement): React.ReactElement {
  return (
    <ChatUnreadProvider sessionKey="uid-1" enabled>
      <ChatCapabilitiesProvider sessionKey="uid-1" enabled>
        {ui}
      </ChatCapabilitiesProvider>
    </ChatUnreadProvider>
  );
}

const live = () => fake.connections.filter((c) => c.stop.mock.calls.length === 0);
const handlersOf = (target: ChatConversationTarget) =>
  [...fake.connections].reverse().find((c) => JSON.stringify(c.target) === JSON.stringify(target))!
    .handlers as TypingStreamHandlers;

beforeEach(() => {
  vi.clearAllMocks();
  fake.connections.length = 0;
  vi.mocked(chatApi.fetchChatCapabilities).mockResolvedValue({
    reactions: { enabled: true, allowedReactions: [...CHAT_REACTION_CODES] },
    typing: { enabled: true },
    attachments: { enabled: false },
    voiceVideo: false,
  });
  vi.mocked(chatApi.signalChatTyping).mockResolvedValue(undefined);
  vi.mocked(chatApi.fetchMyPresence).mockResolvedValue({ presenceStatus: 'Online', updatedAt: '2026-11-12T10:00:00.000Z' });
  vi.mocked(chatApi.listChatChannels).mockResolvedValue([forum(FORUM_A, 'Alpha'), forum(FORUM_B, 'Beta')]);
  vi.mocked(chatApi.listChatMessages).mockImplementation(async (channelId: string) => [message(channelId)]);
  vi.mocked(chatApi.listDirectMessageThreads).mockResolvedValue([thread(THREAD_A, 'blake'), thread(THREAD_B, 'casey')]);
  vi.mocked(chatApi.getDirectMessageThread).mockImplementation(async (threadId: string) => ({
    thread: { ...thread(threadId, threadId === THREAD_A ? 'blake' : 'casey') },
    isEmpty: true,
    messages: [],
  }));
  vi.mocked(chatApi.fetchChatUnreadSummary).mockResolvedValue({ counts: [], totalUnreadCount: 0, totalUnreadMentionCount: 0 });
  vi.mocked(chatApi.markChatConversationRead).mockImplementation(async (input) => ({
    conversationType: input.conversationType,
    conversationId: input.conversationId,
    readCursor: { messageId: input.messageId, createdAt: '2026-11-12T10:05:00.000Z' },
    advanced: false,
    unreadCount: 0,
    unreadMentionCount: 0,
  }));
  vi.mocked(chatApi.openTeamChat).mockImplementation(async (teamId: string) => ({
    ...forum(teamId === TEAM_A ? id(1) : id(2), 'Team'),
    channelType: 'team',
    teamId,
  } as TeamChatChannelView));
  vi.mocked(chatApi.listTeamChatMessages).mockResolvedValue([]);
});

async function openForum(title: 'Alpha' | 'Beta'): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(title) }));
  await screen.findByTestId('send-message-form');
  await waitFor(() => expect(chatApi.listChatMessages).toHaveBeenCalled());
}

describe('public forum', () => {
  it('signals through the forum route with only { typing } and shows typing from the stream', async () => {
    render(withProviders(<ChatPage />));
    await openForum('Alpha');
    await waitFor(() => expect(live()).toHaveLength(1));
    expect(live()[0]!.target).toEqual({ kind: 'channel', channelId: FORUM_A });

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'secret plan' } });
    expect(chatApi.signalChatTyping).toHaveBeenCalledWith({ kind: 'channel', channelId: FORUM_A }, true);
    expect(JSON.stringify(vi.mocked(chatApi.signalChatTyping).mock.calls)).not.toContain('secret plan');

    act(() => handlersOf({ kind: 'channel', channelId: FORUM_A }).onConnected(6000));
    act(() =>
      handlersOf({ kind: 'channel', channelId: FORUM_A }).onTyping({
        conversationType: 'channel',
        conversationId: FORUM_A,
        typist: { handle: 'casey' },
        typing: true,
      })
    );
    expect(screen.getByTestId('typing-indicator')).toHaveTextContent('casey is typing…');
    // Display only: no read marking, unread refresh, reload, or reorder.
    expect(chatApi.markChatConversationRead).toHaveBeenCalledTimes(1);
    expect(chatApi.listChatMessages).toHaveBeenCalledTimes(1);
  });

  it('sends a best-effort stop after a successful send, and sending works even if typing fails', async () => {
    vi.mocked(chatApi.signalChatTyping).mockRejectedValue(new chatApi.ChatApiError(500, 'UNKNOWN_ERROR'));
    vi.mocked(chatApi.sendChatMessage).mockResolvedValue(message(FORUM_A, { id: id(8), body: 'Shipped', reactions: [] }));
    render(withProviders(<ChatPage />));
    await openForum('Alpha');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Shipped' } });
    fireEvent.submit(screen.getByTestId('send-message-form'));
    expect(await screen.findByText('Shipped')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toHaveValue('');
    expect(chatApi.signalChatTyping).toHaveBeenLastCalledWith({ kind: 'channel', channelId: FORUM_A }, false);
  });

  it('switching forums, and switching to the Direct messages tab, closes the forum stream', async () => {
    render(withProviders(<ChatPage />));
    await openForum('Alpha');
    await waitFor(() => expect(live()).toHaveLength(1));
    const alpha = live()[0]!;

    await openForum('Beta');
    await waitFor(() => expect(alpha.stop).toHaveBeenCalled());
    expect(live().map((c) => c.target)).toEqual([{ kind: 'channel', channelId: FORUM_B }]);

    const beta = live()[0]!;
    fireEvent.click(screen.getByRole('button', { name: /Direct messages/ }));
    await waitFor(() => expect(beta.stop).toHaveBeenCalled());
    expect(live()).toHaveLength(0);
  });

  it('keeps reactions working after a typing failure', async () => {
    vi.mocked(chatApi.signalChatTyping).mockRejectedValue(new chatApi.ChatApiError(429, 'RATE_LIMITED', undefined, undefined, 'x', 30));
    vi.mocked(chatApi.setChatMessageReaction).mockResolvedValue({
      messageId: MESSAGE,
      reaction: 'heart',
      reactedByMe: true,
      changed: true,
      reactions: [{ reaction: 'heart', count: 2, reactedByMe: true }],
    });
    render(withProviders(<ChatPage />));
    await openForum('Alpha');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'typing' } });
    const item = await screen.findByTestId('chat-message');
    fireEvent.click(await within(item).findByRole('button', { name: 'Heart, 1 reaction' }));
    expect(await within(item).findByRole('button', { name: 'Heart, 2 reactions, you reacted' })).toBeInTheDocument();
  });
});

describe('private team chat', () => {
  it('uses the team routes and closes the stream when switching teams', async () => {
    const view = render(withProviders(<TeamChatView teamId={TEAM_A} teamName="A" />));
    fireEvent.click(screen.getByRole('button', { name: /open team chat/i }));
    await screen.findByTestId('team-chat-composer');
    await waitFor(() => expect(live().map((c) => c.target)).toEqual([{ kind: 'team', teamId: TEAM_A }]));
    const teamA = live()[0]!;

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hi team' } });
    expect(chatApi.signalChatTyping).toHaveBeenCalledWith({ kind: 'team', teamId: TEAM_A }, true);

    view.rerender(withProviders(<TeamChatView teamId={TEAM_B} teamName="B" />));
    await waitFor(() => expect(teamA.stop).toHaveBeenCalled());
    expect(chatApi.signalChatTyping).toHaveBeenCalledWith({ kind: 'team', teamId: TEAM_A }, false);
    expect(live()).toHaveLength(0); // team B's chat is not open yet
    fireEvent.click(screen.getByRole('button', { name: /open team chat/i }));
    await waitFor(() => expect(live().map((c) => c.target)).toEqual([{ kind: 'team', teamId: TEAM_B }]));
  });
});

describe('direct messages', () => {
  it('uses the DM routes and closes the old stream when switching threads', async () => {
    render(withProviders(<DirectMessagesView />));
    fireEvent.click(await screen.findByRole('button', { name: /blake/i }));
    await screen.findByTestId('dm-composer');
    await waitFor(() => expect(live().map((c) => c.target)).toEqual([{ kind: 'directMessage', threadId: THREAD_A }]));
    const threadA = live()[0]!;

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hey' } });
    expect(chatApi.signalChatTyping).toHaveBeenCalledWith({ kind: 'directMessage', threadId: THREAD_A }, true);
    act(() => threadA.handlers && (threadA.handlers as TypingStreamHandlers).onConnected(6000));
    act(() =>
      (threadA.handlers as TypingStreamHandlers).onTyping({
        conversationType: 'directMessage',
        conversationId: THREAD_A,
        typist: { handle: 'blake' },
        typing: true,
      })
    );
    expect(screen.getByTestId('typing-indicator')).toHaveTextContent('blake is typing…');

    fireEvent.click(screen.getByRole('button', { name: /casey/i }));
    await waitFor(() => expect(threadA.stop).toHaveBeenCalled());
    await waitFor(() => expect(live().map((c) => c.target)).toEqual([{ kind: 'directMessage', threadId: THREAD_B }]));
    expect(screen.getByTestId('typing-indicator').textContent).toBe('');
  });

  it('keeps the composer and sending usable when the typing stream is unavailable', async () => {
    vi.mocked(chatApi.sendDirectMessage).mockResolvedValue({
      id: id(8),
      threadId: THREAD_A,
      fromMe: true,
      authorHandle: 'me',
      body: 'still works',
      createdAt: '2026-11-12T10:06:00.000Z',
    });
    render(withProviders(<DirectMessagesView />));
    fireEvent.click(await screen.findByRole('button', { name: /blake/i }));
    await screen.findByTestId('dm-composer');
    await waitFor(() => expect(live()).toHaveLength(1));
    act(() => (live()[0]!.handlers as TypingStreamHandlers).onUnavailable('HTTP_503'));

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'still works' } });
    fireEvent.submit(screen.getByTestId('dm-composer'));
    expect(await screen.findByText('still works')).toBeInTheDocument();
  });
});

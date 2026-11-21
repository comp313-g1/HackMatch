/**
 * US-035 / #406 — reactions inside the public forum, private team chat, and
 * direct-message views: server summaries render, the right conversation route
 * is used, and nothing changes when reactions are off.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  type ChatMessageView,
  type DirectMessageThreadDetail,
  type DirectMessageThreadView,
  type TeamChatChannelView,
} from './chatTypes';

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
    listDirectMessageThreads: vi.fn(),
    getDirectMessageThread: vi.fn(),
    fetchChatUnreadSummary: vi.fn(),
    markChatConversationRead: vi.fn(),
    fetchChatCapabilities: vi.fn(),
    setChatMessageReaction: vi.fn(),
  };
});

const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_CHANNEL_ID = '55555555-5555-4555-8555-555555555555';
const THREAD_ID = '44444444-4444-4444-8444-444444444444';
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';

const channel: ChatChannelView = {
  id: CHANNEL_ID,
  title: 'General',
  description: 'Public forum',
  createdBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  createdAt: '2026-11-12T10:00:00.000Z',
  updatedAt: '2026-11-12T10:00:00.000Z',
};

const teamChannel: TeamChatChannelView = { ...channel, id: TEAM_CHANNEL_ID, title: 'Team: Civic', channelType: 'team', teamId: TEAM_ID };

function channelMessage(overrides: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id: MESSAGE_ID,
    channelId: CHANNEL_ID,
    authorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    authorHandle: 'avery',
    body: 'Hello there',
    createdAt: '2026-11-12T10:05:00.000Z',
    reactions: [
      { reaction: 'heart', count: 2, reactedByMe: true },
      { reaction: 'thumbs_up', count: 1, reactedByMe: false },
    ],
    ...overrides,
  };
}

const thread: DirectMessageThreadView = {
  id: THREAD_ID,
  peer: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', handle: 'blake' },
  createdAt: '2026-11-12T10:00:00.000Z',
  updatedAt: '2026-11-12T10:00:00.000Z',
  lastMessageAt: '2026-11-12T10:05:00.000Z',
};

function threadDetail(youBlockedPeer = false): DirectMessageThreadDetail {
  return {
    thread: { ...thread, youBlockedPeer },
    isEmpty: false,
    messages: [
      {
        id: MESSAGE_ID,
        threadId: THREAD_ID,
        fromMe: false,
        authorHandle: 'blake',
        body: 'DM hello',
        createdAt: '2026-11-12T10:05:00.000Z',
        reactions: [{ reaction: 'laugh', count: 1, reactedByMe: false }],
      },
    ],
  };
}

function capabilities(enabled: boolean) {
  return {
    reactions: { enabled, allowedReactions: enabled ? [...CHAT_REACTION_CODES] : [] },
    typing: { enabled: false as const },
    attachments: { enabled: false as const },
    voiceVideo: false as const,
  };
}

function withProviders(ui: React.ReactElement): React.ReactElement {
  return (
    <ChatUnreadProvider sessionKey="uid-1" enabled>
      <ChatCapabilitiesProvider sessionKey="uid-1" enabled>
        {ui}
      </ChatCapabilitiesProvider>
    </ChatUnreadProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(chatApi.fetchMyPresence).mockResolvedValue({ presenceStatus: 'Online', updatedAt: '2026-11-12T10:00:00.000Z' });
  vi.mocked(chatApi.listChatChannels).mockResolvedValue([channel]);
  vi.mocked(chatApi.listChatMessages).mockResolvedValue([channelMessage()]);
  vi.mocked(chatApi.openTeamChat).mockResolvedValue(teamChannel);
  vi.mocked(chatApi.listTeamChatMessages).mockResolvedValue([channelMessage({ channelId: TEAM_CHANNEL_ID, body: 'Team hello' })]);
  vi.mocked(chatApi.listDirectMessageThreads).mockResolvedValue([thread]);
  vi.mocked(chatApi.getDirectMessageThread).mockResolvedValue(threadDetail());
  vi.mocked(chatApi.fetchChatUnreadSummary).mockResolvedValue({ counts: [], totalUnreadCount: 0, totalUnreadMentionCount: 0 });
  vi.mocked(chatApi.markChatConversationRead).mockResolvedValue({
    conversationType: 'channel',
    conversationId: CHANNEL_ID,
    readCursor: { messageId: MESSAGE_ID, createdAt: '2026-11-12T10:05:00.000Z' },
    advanced: false,
    unreadCount: 0,
    unreadMentionCount: 0,
  });
  vi.mocked(chatApi.fetchChatCapabilities).mockReset().mockResolvedValue(capabilities(true));
  vi.mocked(chatApi.setChatMessageReaction).mockReset();
});

async function openForum(): Promise<HTMLElement> {
  render(withProviders(<ChatPage />));
  fireEvent.click(await screen.findByRole('button', { name: /General/ }));
  return screen.findByTestId('chat-message');
}

describe('public forum', () => {
  it('renders server summaries in approved order and reacts through the channel route', async () => {
    vi.mocked(chatApi.setChatMessageReaction).mockResolvedValue({
      messageId: MESSAGE_ID,
      reaction: 'heart',
      reactedByMe: false,
      changed: true,
      reactions: [{ reaction: 'heart', count: 1, reactedByMe: false }, { reaction: 'thumbs_up', count: 1, reactedByMe: false }],
    });
    const message = await openForum();
    const pills = await within(message).findAllByRole('button', { name: /reaction/ });
    expect(pills.map((p) => p.getAttribute('aria-label'))).toEqual([
      'Thumbs up, 1 reaction',
      'Heart, 2 reactions, you reacted',
      'Add reaction',
    ]);

    fireEvent.click(pills[1]!);
    expect(chatApi.setChatMessageReaction).toHaveBeenCalledWith(
      { kind: 'channel', channelId: CHANNEL_ID },
      MESSAGE_ID,
      'heart',
      false
    );
    expect(await within(message).findByRole('button', { name: 'Heart, 1 reaction' })).toBeInTheDocument();
  });

  it('has no side effects on unread state, message order, or the message list', async () => {
    vi.mocked(chatApi.setChatMessageReaction).mockResolvedValue({
      messageId: MESSAGE_ID,
      reaction: 'eyes',
      reactedByMe: true,
      changed: true,
      reactions: [{ reaction: 'eyes', count: 1, reactedByMe: true }],
    });
    const message = await openForum();
    await waitFor(() => expect(chatApi.markChatConversationRead).toHaveBeenCalledTimes(1));
    const unreadCalls = vi.mocked(chatApi.fetchChatUnreadSummary).mock.calls.length;

    fireEvent.click(within(message).getByRole('button', { name: 'Add reaction' }));
    fireEvent.click(screen.getByRole('button', { name: 'Eyes' }));
    await within(message).findByRole('button', { name: 'Eyes, 1 reaction, you reacted' });

    expect(chatApi.markChatConversationRead).toHaveBeenCalledTimes(1);
    expect(chatApi.fetchChatUnreadSummary).toHaveBeenCalledTimes(unreadCalls);
    expect(chatApi.listChatMessages).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId('chat-message')).toHaveLength(1);
  });

  it('renders exactly as before when reactions are off (and when the field is missing)', async () => {
    vi.mocked(chatApi.fetchChatCapabilities).mockResolvedValue(capabilities(false));
    vi.mocked(chatApi.listChatMessages).mockResolvedValue([channelMessage({ reactions: undefined })]);
    const message = await openForum();
    expect(within(message).getByText('Hello there')).toBeInTheDocument();
    expect(within(message).queryByTestId('message-reactions')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  it('keeps sending text after a reaction failure', async () => {
    vi.mocked(chatApi.setChatMessageReaction).mockRejectedValue(new chatApi.ChatApiError(500, 'UNKNOWN_ERROR'));
    vi.mocked(chatApi.sendChatMessage).mockResolvedValue(
      channelMessage({ id: '66666666-6666-4666-8666-666666666666', body: 'Still here', reactions: [] })
    );
    const message = await openForum();
    fireEvent.click(within(message).getByRole('button', { name: 'Thumbs up, 1 reaction' }));
    expect(await screen.findByTestId('reaction-feedback')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Still here' } });
    fireEvent.submit(screen.getByTestId('send-message-form'));
    expect(await screen.findByText('Still here')).toBeInTheDocument();
  });
});

describe('private team chat', () => {
  it('renders summaries and reacts through the team route', async () => {
    vi.mocked(chatApi.setChatMessageReaction).mockResolvedValue({
      messageId: MESSAGE_ID,
      reaction: 'thumbs_up',
      reactedByMe: true,
      changed: true,
      reactions: [{ reaction: 'thumbs_up', count: 2, reactedByMe: true }, { reaction: 'heart', count: 2, reactedByMe: true }],
    });
    render(withProviders(<TeamChatView teamId={TEAM_ID} teamName="Civic" />));
    fireEvent.click(screen.getByRole('button', { name: /open team chat/i }));
    const message = await screen.findByTestId('team-chat-message');
    fireEvent.click(await within(message).findByRole('button', { name: 'Thumbs up, 1 reaction' }));
    expect(chatApi.setChatMessageReaction).toHaveBeenCalledWith({ kind: 'team', teamId: TEAM_ID }, MESSAGE_ID, 'thumbs_up', true);
    expect(await within(message).findByRole('button', { name: 'Thumbs up, 2 reactions, you reacted' })).toBeInTheDocument();
  });
});

describe('direct messages', () => {
  async function openThread(): Promise<HTMLElement> {
    render(withProviders(<DirectMessagesView />));
    fireEvent.click(await screen.findByRole('button', { name: /blake/i }));
    return screen.findByTestId('dm-message');
  }

  it('renders summaries and reacts through the DM route', async () => {
    vi.mocked(chatApi.setChatMessageReaction).mockResolvedValue({
      messageId: MESSAGE_ID,
      reaction: 'laugh',
      reactedByMe: true,
      changed: true,
      reactions: [{ reaction: 'laugh', count: 2, reactedByMe: true }],
    });
    const message = await openThread();
    fireEvent.click(await within(message).findByRole('button', { name: 'Laugh, 1 reaction' }));
    expect(chatApi.setChatMessageReaction).toHaveBeenCalledWith(
      { kind: 'directMessage', threadId: THREAD_ID },
      MESSAGE_ID,
      'laugh',
      true
    );
    expect(await within(message).findByRole('button', { name: 'Laugh, 2 reactions, you reacted' })).toBeInTheDocument();
  });

  it('shows reactions read-only when you blocked the peer, like the composer', async () => {
    vi.mocked(chatApi.getDirectMessageThread).mockResolvedValue(threadDetail(true));
    const message = await openThread();
    const pill = await within(message).findByRole('button', { name: 'Laugh, 1 reaction' });
    expect(pill).toHaveAttribute('aria-disabled', 'true');
    expect(within(message).queryByRole('button', { name: 'Add reaction' })).not.toBeInTheDocument();
    fireEvent.click(pill);
    expect(chatApi.setChatMessageReaction).not.toHaveBeenCalled();
  });

  it('recovers when the server refuses because the peer blocked you', async () => {
    vi.mocked(chatApi.setChatMessageReaction).mockRejectedValue(new chatApi.ChatApiError(403, 'DM_PEER_UNAVAILABLE'));
    const message = await openThread();
    fireEvent.click(await within(message).findByRole('button', { name: 'Laugh, 1 reaction' }));
    expect(await within(message).findByTestId('reaction-feedback')).toHaveTextContent('You cannot react in this conversation.');
    expect(within(message).getByRole('button', { name: 'Laugh, 1 reaction' })).not.toHaveAttribute('aria-disabled');
  });
});

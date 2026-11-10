import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ChatPage } from './ChatPage';
import * as chatApi from './chatApi';
import { ChatUnreadProvider } from './ChatUnreadContext';

vi.mock('./chatApi', async () => {
  const actual = await vi.importActual<typeof import('./chatApi')>('./chatApi');
  return {
    ...actual,
    fetchMyPresence: vi.fn(),
    updateMyPresence: vi.fn(),
    listChatChannels: vi.fn(),
    createChatChannel: vi.fn(),
    listChatMessages: vi.fn(),
    sendChatMessage: vi.fn(),
    listDirectMessageThreads: vi.fn(),
    getDirectMessageThread: vi.fn(),
    sendDirectMessage: vi.fn(),
    fetchChatUnreadSummary: vi.fn(),
    markChatConversationRead: vi.fn(),
    openDirectMessageThread: vi.fn(),
  };
});

describe('ChatPage (US-030 / #346)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(chatApi.fetchMyPresence).mockResolvedValue({
      presenceStatus: 'Invisible',
      updatedAt: '2026-10-21T12:00:00.000Z',
    });
    vi.mocked(chatApi.listChatChannels).mockResolvedValue([]);
    vi.mocked(chatApi.listChatMessages).mockResolvedValue([]);
    vi.mocked(chatApi.listDirectMessageThreads).mockResolvedValue([]);
    vi.mocked(chatApi.fetchChatUnreadSummary).mockResolvedValue({
      counts: [],
      totalUnreadCount: 0,
      totalUnreadMentionCount: 0,
    });
  });

  it('shows loading then empty forums state', async () => {
    render(<ChatPage />);

    expect(screen.getByText(/Loading forums/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('forums-empty')).toHaveTextContent(/No forums yet/i);
    });
    expect(screen.getByLabelText(/Presence status/i)).toHaveValue('Invisible');
  });

  it('shows access denied for visitors / unauthorized', async () => {
    vi.mocked(chatApi.fetchMyPresence).mockRejectedValue(new chatApi.AuthRequiredError());

    render(<ChatPage onNavigateToSignIn={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-access-denied')).toHaveTextContent(
        /Sign in required for Chat/i
      );
    });
  });

  it('keeps create-forum drafts on client validation failure', async () => {
    render(<ChatPage />);

    await waitFor(() => {
      expect(screen.getByTestId('create-forum-form')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^Title$/i), {
      target: { value: 'General' },
    });
    fireEvent.change(screen.getByLabelText(/^Description$/i), {
      target: { value: '' },
    });
    fireEvent.submit(screen.getByTestId('create-forum-form'));

    await waitFor(() => {
      expect(screen.getByText(/description is required/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/^Title$/i)).toHaveValue('General');
    expect(chatApi.createChatChannel).not.toHaveBeenCalled();
  });

  it('creates a forum and shows success (happy path)', async () => {
    const channel = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'General',
      description: 'Open forum',
      createdBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      createdAt: '2026-10-21T12:00:00.000Z',
      updatedAt: '2026-10-21T12:00:00.000Z',
    };
    vi.mocked(chatApi.createChatChannel).mockResolvedValue(channel);
    vi.mocked(chatApi.listChatMessages).mockResolvedValue([]);

    render(<ChatPage />);
    await waitFor(() => screen.getByTestId('create-forum-form'));

    fireEvent.change(screen.getByLabelText(/^Title$/i), {
      target: { value: 'General' },
    });
    fireEvent.change(screen.getByLabelText(/^Description$/i), {
      target: { value: 'Open forum' },
    });
    fireEvent.submit(screen.getByTestId('create-forum-form'));

    await waitFor(() => {
      expect(screen.getByText(/Forum "General" created/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText('Open forum').length).toBeGreaterThan(0);
    expect(screen.getByTestId('messages-empty')).toBeInTheDocument();
  });

  it('keeps message draft when send validation fails from API', async () => {
    const channel = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'General',
      description: 'Open forum',
      createdBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      createdAt: '2026-10-21T12:00:00.000Z',
      updatedAt: '2026-10-21T12:00:00.000Z',
    };
    vi.mocked(chatApi.listChatChannels).mockResolvedValue([channel]);
    vi.mocked(chatApi.listChatMessages).mockResolvedValue([]);
    vi.mocked(chatApi.sendChatMessage).mockRejectedValue(
      new chatApi.ChatApiError(
        400,
        'VALIDATION_ERROR',
        { body: 'body is required.' },
        { body: '   keep-me   ' },
        'Validation failed.'
      )
    );

    render(<ChatPage />);

    await waitFor(() => {
      expect(screen.getByText('General')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('General'));

    await waitFor(() => {
      expect(screen.getByTestId('send-message-form')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^Message$/i), {
      target: { value: 'hello' },
    });
    fireEvent.submit(screen.getByTestId('send-message-form'));

    await waitFor(() => {
      expect(screen.getByLabelText(/^Message$/i)).toHaveValue('   keep-me   ');
    });
  });

  it('updates presence status successfully', async () => {
    vi.mocked(chatApi.updateMyPresence).mockResolvedValue({
      presenceStatus: 'Online',
      updatedAt: '2026-10-21T12:30:00.000Z',
    });

    render(<ChatPage />);
    await waitFor(() => screen.getByLabelText(/Presence status/i));

    fireEvent.change(screen.getByLabelText(/Presence status/i), {
      target: { value: 'Online' },
    });

    await waitFor(() => {
      expect(screen.getByText(/Status set to Online/i)).toBeInTheDocument();
    });
    expect(chatApi.updateMyPresence).toHaveBeenCalledWith('Online');
  });

  it('opens the direct-message inbox without replacing public forums', async () => {
    render(<ChatPage />);
    await screen.findByTestId('forums-empty');

    fireEvent.click(screen.getByRole('button', { name: /direct messages/i }));
    expect(await screen.findByTestId('direct-messages-view')).toBeInTheDocument();
    expect(screen.getByTestId('dm-inbox-empty')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^forums$/i }));
    expect(screen.getByTestId('create-forum-form')).toBeInTheDocument();
  });

  it('renders channel unread and mention badges and clears them after confirmed mark-read', async () => {
    const channel = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'General',
      description: 'Open forum',
      createdBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      createdAt: '2026-11-10T12:00:00.000Z',
      updatedAt: '2026-11-10T12:00:00.000Z',
    };
    const message = {
      id: '22222222-2222-4222-8222-222222222222',
      channelId: channel.id,
      authorId: channel.createdBy,
      authorHandle: 'avery',
      body: 'Unread update',
      createdAt: '2026-11-10T12:05:00.000Z',
    };
    const unreadSummary = {
      counts: [
        {
          conversationType: 'channel' as const,
          conversationId: channel.id,
          unreadCount: 2,
          unreadMentionCount: 1,
        },
      ],
      totalUnreadCount: 2,
      totalUnreadMentionCount: 1,
    };
    vi.mocked(chatApi.listChatChannels).mockResolvedValue([channel]);
    vi.mocked(chatApi.listChatMessages).mockResolvedValue([message]);
    vi.mocked(chatApi.fetchChatUnreadSummary)
      .mockResolvedValueOnce(unreadSummary)
      .mockResolvedValue({
        counts: [],
        totalUnreadCount: 0,
        totalUnreadMentionCount: 0,
      });
    vi.mocked(chatApi.markChatConversationRead).mockResolvedValue({
      conversationType: 'channel',
      conversationId: channel.id,
      readCursor: { messageId: message.id, createdAt: message.createdAt },
      advanced: true,
      unreadCount: 0,
      unreadMentionCount: 0,
    });

    render(
      <ChatUnreadProvider enabled sessionKey="participant-a">
        <ChatPage />
      </ChatUnreadProvider>
    );
    expect(
      await screen.findByRole('status', { name: /general: 2 unread messages, 1 unread mention/i })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /general/i }));
    await waitFor(() => {
      expect(chatApi.markChatConversationRead).toHaveBeenCalledWith({
        conversationType: 'channel',
        conversationId: channel.id,
        messageId: message.id,
      });
      expect(
        screen.queryByRole('status', { name: /general: 2 unread messages/i })
      ).not.toBeInTheDocument();
    });
  });

  it('keeps the channel badge when mark-read fails', async () => {
    const channel = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'General',
      description: 'Open forum',
      createdBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      createdAt: '2026-11-10T12:00:00.000Z',
      updatedAt: '2026-11-10T12:00:00.000Z',
    };
    const message = {
      id: '22222222-2222-4222-8222-222222222222',
      channelId: channel.id,
      authorId: channel.createdBy,
      authorHandle: 'avery',
      body: 'Unread update',
      createdAt: '2026-11-10T12:05:00.000Z',
    };
    vi.mocked(chatApi.listChatChannels).mockResolvedValue([channel]);
    vi.mocked(chatApi.listChatMessages).mockResolvedValue([message]);
    vi.mocked(chatApi.fetchChatUnreadSummary).mockResolvedValue({
      counts: [
        {
          conversationType: 'channel',
          conversationId: channel.id,
          unreadCount: 2,
          unreadMentionCount: 0,
        },
      ],
      totalUnreadCount: 2,
      totalUnreadMentionCount: 0,
    });
    vi.mocked(chatApi.markChatConversationRead).mockRejectedValue(
      new chatApi.ChatApiError(503, 'UNAVAILABLE')
    );

    render(
      <ChatUnreadProvider enabled sessionKey="participant-a">
        <ChatPage />
      </ChatUnreadProvider>
    );
    await screen.findByRole('status', { name: /general: 2 unread messages/i });
    fireEvent.click(screen.getByRole('button', { name: /general/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /existing badges were kept/i
    );
    expect(
      screen.getByRole('status', { name: /general: 2 unread messages/i })
    ).toBeInTheDocument();
  });

  describe('opening a direct message from a Message click (#432)', () => {
    const THREAD = {
      id: '11111111-1111-4111-8111-111111111111',
      peer: { id: '22222222-2222-4222-8222-222222222222', handle: 'blake' },
      createdAt: '2026-11-10T20:00:00.000Z',
      updatedAt: '2026-11-10T20:00:00.000Z',
      lastMessage: null,
      lastMessageAt: null,
    };

    beforeEach(() => {
      vi.mocked(chatApi.openDirectMessageThread).mockResolvedValue(THREAD);
      vi.mocked(chatApi.getDirectMessageThread).mockResolvedValue({ thread: THREAD, messages: [], isEmpty: true });
    });

    it('starts on the Direct messages tab and opens that conversation when the page is opened by a request', async () => {
      render(<ChatPage directMessageRequest={{ participantId: THREAD.peer.id, requestId: 1 }} />);

      expect(screen.getByRole('button', { name: /^direct messages$/i })).toHaveAttribute('aria-pressed', 'true');
      expect(await screen.findByTestId('dm-thread-empty')).toBeInTheDocument();
      expect(chatApi.openDirectMessageThread).toHaveBeenCalledWith(THREAD.peer.id);
      expect(screen.queryByTestId('forums-empty')).not.toBeInTheDocument();
    });

    it('switches from Forums to Direct messages when a request arrives while the page is already open', async () => {
      const { rerender } = render(<ChatPage />);
      await waitFor(() => expect(screen.getByTestId('forums-empty')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: /^forums$/i })).toHaveAttribute('aria-pressed', 'true');

      rerender(<ChatPage directMessageRequest={{ participantId: THREAD.peer.id, requestId: 1 }} />);

      expect(await screen.findByTestId('dm-thread-empty')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^direct messages$/i })).toHaveAttribute('aria-pressed', 'true');
    });

    it('passes the "request taken" signal up so the app can clear it', async () => {
      const handled = vi.fn();
      render(
        <ChatPage
          directMessageRequest={{ participantId: THREAD.peer.id, requestId: 1 }}
          onDirectMessageRequestHandled={handled}
        />
      );
      await screen.findByTestId('dm-thread-empty');
      expect(handled).toHaveBeenCalledTimes(1);
    });

    it('opens on Forums as before when there is no request', async () => {
      render(<ChatPage />);
      await waitFor(() => expect(screen.getByTestId('forums-empty')).toBeInTheDocument());
      expect(chatApi.openDirectMessageThread).not.toHaveBeenCalled();
    });
  });
});

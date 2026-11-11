import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as chatApi from './chatApi';
import { DirectMessagesView } from './DirectMessagesView';
import { ChatUnreadProvider } from './ChatUnreadContext';
import type {
  DirectMessageThreadDetail,
  DirectMessageThreadView,
  DirectMessageView,
} from './chatTypes';

vi.mock('./chatApi', async () => {
  const actual = await vi.importActual<typeof import('./chatApi')>('./chatApi');
  return {
    ...actual,
    listDirectMessageThreads: vi.fn(),
    getDirectMessageThread: vi.fn(),
    sendDirectMessage: vi.fn(),
    fetchChatUnreadSummary: vi.fn(),
    markChatConversationRead: vi.fn(),
  };
});

const THREAD_ID = '11111111-1111-4111-8111-111111111111';
const PEER_ID = '22222222-2222-4222-8222-222222222222';

const message: DirectMessageView = {
  id: '33333333-3333-4333-8333-333333333333',
  threadId: THREAD_ID,
  authorId: PEER_ID,
  authorHandle: 'blake',
  body: 'Private project update',
  createdAt: '2026-11-09T20:05:00.000Z',
};

const thread: DirectMessageThreadView = {
  id: THREAD_ID,
  peer: { id: PEER_ID, handle: 'blake' },
  createdAt: '2026-11-09T20:00:00.000Z',
  updatedAt: '2026-11-09T20:05:00.000Z',
  lastMessage: { ...message, body: 'Latest preview' },
  lastMessageAt: '2026-11-09T20:05:00.000Z',
};

const emptyDetail: DirectMessageThreadDetail = {
  thread: { ...thread, lastMessage: null },
  messages: [],
  isEmpty: true,
};

async function openThread(): Promise<void> {
  render(<DirectMessagesView />);
  const button = await screen.findByRole('button', { name: /blake/i });
  await act(async () => {
    fireEvent.click(button);
  });
}

describe('DirectMessagesView (US-032 / #389)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(chatApi.listDirectMessageThreads).mockResolvedValue([thread]);
    vi.mocked(chatApi.getDirectMessageThread).mockResolvedValue(emptyDetail);
    vi.mocked(chatApi.sendDirectMessage).mockResolvedValue(message);
    vi.mocked(chatApi.fetchChatUnreadSummary).mockResolvedValue({
      counts: [],
      totalUnreadCount: 0,
      totalUnreadMentionCount: 0,
    });
  });

  it('shows an explicit inbox loading state', () => {
    vi.mocked(chatApi.listDirectMessageThreads).mockReturnValue(new Promise(() => {}));
    render(<DirectMessagesView />);
    expect(screen.getByText(/loading direct messages/i)).toBeInTheDocument();
  });

  it('shows an empty inbox as a valid non-error state', async () => {
    vi.mocked(chatApi.listDirectMessageThreads).mockResolvedValue([]);
    render(<DirectMessagesView />);
    expect(await screen.findByTestId('dm-inbox-empty')).toHaveTextContent(
      /no direct-message conversations yet/i
    );
  });

  it('renders a populated inbox using the safe peer handle and preview', async () => {
    render(<DirectMessagesView />);
    expect(await screen.findByRole('button', { name: /blake/i })).toHaveTextContent(
      'Latest preview'
    );
    expect(screen.queryByText(PEER_ID)).not.toBeInTheDocument();
  });

  it('clears stale content and shows thread loading', async () => {
    vi.mocked(chatApi.getDirectMessageThread).mockReturnValue(new Promise(() => {}));
    await openThread();
    expect(screen.getByRole('status')).toHaveTextContent(/loading conversation/i);
    expect(screen.queryByText(message.body)).not.toBeInTheDocument();
  });

  it('shows an empty thread while keeping the composer available', async () => {
    await openThread();
    expect(await screen.findByTestId('dm-thread-empty')).toHaveTextContent(
      /no messages yet/i
    );
    expect(screen.getByLabelText(/^message$/i)).toBeEnabled();
    expect(screen.getByRole('button', { name: /send message/i })).toBeEnabled();
  });

  it('renders populated messages with safe handle, timestamp, and body', async () => {
    vi.mocked(chatApi.getDirectMessageThread).mockResolvedValue({
      thread,
      messages: [message],
      isEmpty: false,
    });
    await openThread();
    expect(await screen.findByText(message.body)).toBeInTheDocument();
    expect(screen.getAllByText('blake').length).toBeGreaterThan(0);
    expect(screen.getByText(message.body).closest('li')?.querySelector('time')).toHaveAttribute(
      'dateTime',
      message.createdAt
    );
  });

  it('adds a successful message once and clears the draft', async () => {
    await openThread();
    const composer = await screen.findByLabelText(/^message$/i);
    fireEvent.change(composer, { target: { value: 'Private project update' } });
    fireEvent.submit(screen.getByTestId('dm-composer'));

    await waitFor(() => {
      expect(chatApi.sendDirectMessage).toHaveBeenCalledWith(THREAD_ID, {
        body: 'Private project update',
      });
    });
    expect(await screen.findByText('Message sent.')).toBeInTheDocument();
    expect(composer).toHaveValue('');
    expect(screen.getAllByTestId('dm-message')).toHaveLength(1);
    expect(screen.getByTestId('dm-message')).toHaveTextContent(message.body);
  });

  it('shows client validation and preserves the exact invalid draft', async () => {
    await openThread();
    const composer = await screen.findByLabelText(/^message$/i);
    fireEvent.change(composer, { target: { value: '   ' } });
    fireEvent.submit(screen.getByTestId('dm-composer'));

    expect(await screen.findByText('Message is required.')).toBeInTheDocument();
    expect(composer).toHaveValue('   ');
    expect(chatApi.sendDirectMessage).not.toHaveBeenCalled();
  });

  it('preserves the exact draft when sending fails', async () => {
    vi.mocked(chatApi.sendDirectMessage).mockRejectedValue(
      new chatApi.ChatApiError(
        500,
        'SERVER_ERROR',
        undefined,
        undefined,
        'Could not send message.'
      )
    );
    await openThread();
    const composer = await screen.findByLabelText(/^message$/i);
    const exactDraft = '  Keep this exact draft  ';
    fireEvent.change(composer, { target: { value: exactDraft } });
    fireEvent.submit(screen.getByTestId('dm-composer'));

    expect(await screen.findByText('Could not send message.')).toBeInTheDocument();
    expect(composer).toHaveValue(exactDraft);
  });

  it('hides private content but retains the draft when send access is denied', async () => {
    // Not (or no longer) a participant of the conversation. A refusal because the other person is
    // unavailable or a block exists keeps the conversation (see DirectMessagesView.block.test.tsx, #433).
    vi.mocked(chatApi.sendDirectMessage).mockRejectedValue(
      new chatApi.ChatApiError(
        403,
        'FORBIDDEN_NOT_THREAD_PARTICIPANT',
        undefined,
        undefined,
        'Conversation unavailable.'
      )
    );
    await openThread();
    const composer = await screen.findByLabelText(/^message$/i);
    const exactDraft = 'Keep this after access changes';
    fireEvent.change(composer, { target: { value: exactDraft } });
    fireEvent.submit(screen.getByTestId('dm-composer'));

    expect(await screen.findByTestId('dm-thread-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('dm-composer')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByLabelText(/^message$/i)).toHaveValue(exactDraft);
  });

  it('shows a content-free access-denied state without rendering messages', async () => {
    vi.mocked(chatApi.getDirectMessageThread).mockRejectedValue(
      new chatApi.ChatApiError(
        403,
        'FORBIDDEN_NOT_THREAD_PARTICIPANT',
        undefined,
        undefined,
        'Forbidden'
      )
    );
    await openThread();

    expect(await screen.findByTestId('dm-thread-access-denied')).toHaveTextContent(
      /conversation is not available/i
    );
    expect(screen.queryByText(message.body)).not.toBeInTheDocument();
    expect(screen.queryByTestId('dm-composer')).not.toBeInTheDocument();
  });

  it('shows a generic inbox error with a retry action', async () => {
    vi.mocked(chatApi.listDirectMessageThreads).mockRejectedValue(
      new Error('Network unavailable')
    );
    render(<DirectMessagesView />);

    expect(await screen.findByTestId('dm-inbox-error')).toHaveTextContent(
      /network unavailable/i
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows an authorized DM badge and clears it only after confirmed mark-read', async () => {
    vi.mocked(chatApi.getDirectMessageThread).mockResolvedValue({
      thread,
      messages: [message],
      isEmpty: false,
    });
    vi.mocked(chatApi.fetchChatUnreadSummary)
      .mockResolvedValueOnce({
        counts: [
          {
            conversationType: 'directMessage',
            conversationId: THREAD_ID,
            unreadCount: 4,
            unreadMentionCount: 1,
          },
        ],
        totalUnreadCount: 4,
        totalUnreadMentionCount: 1,
      })
      .mockResolvedValue({
        counts: [],
        totalUnreadCount: 0,
        totalUnreadMentionCount: 0,
      });
    vi.mocked(chatApi.markChatConversationRead).mockResolvedValue({
      conversationType: 'directMessage',
      conversationId: THREAD_ID,
      readCursor: { messageId: message.id, createdAt: message.createdAt },
      advanced: true,
      unreadCount: 0,
      unreadMentionCount: 0,
    });

    render(
      <ChatUnreadProvider enabled sessionKey="participant-a">
        <DirectMessagesView />
      </ChatUnreadProvider>
    );
    expect(
      await screen.findByRole('status', {
        name: /direct messages with blake: 4 unread messages, 1 unread mention/i,
      })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /blake/i }));

    await waitFor(() => {
      expect(chatApi.markChatConversationRead).toHaveBeenCalledWith({
        conversationType: 'directMessage',
        conversationId: THREAD_ID,
        messageId: message.id,
      });
      expect(screen.queryByTestId('chat-activity-badge')).not.toBeInTheDocument();
    });
  });
});

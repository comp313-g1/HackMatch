import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as chatApi from './chatApi';
import { ChatActivityBadge, ChatNavigationButton, ChatUnreadStatus } from './ChatUnreadBadge';
import { ChatUnreadProvider, useChatUnread } from './ChatUnreadContext';
import type { ChatUnreadSummary } from './chatTypes';

vi.mock('./chatApi', async () => {
  const actual = await vi.importActual<typeof import('./chatApi')>('./chatApi');
  return {
    ...actual,
    fetchChatUnreadSummary: vi.fn(),
    markChatConversationRead: vi.fn(),
  };
});

const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';
const EMPTY_SUMMARY: ChatUnreadSummary = {
  counts: [],
  totalUnreadCount: 0,
  totalUnreadMentionCount: 0,
};

function summary(unreadCount: number, unreadMentionCount: number): ChatUnreadSummary {
  return {
    counts: [
      {
        conversationType: 'channel',
        conversationId: CHANNEL_ID,
        unreadCount,
        unreadMentionCount,
      },
    ],
    totalUnreadCount: unreadCount,
    totalUnreadMentionCount: unreadMentionCount,
  };
}

function Harness(): React.JSX.Element {
  const unread = useChatUnread();
  const count = unread.getCount('channel', CHANNEL_ID);
  const [actionError, setActionError] = React.useState('');
  return (
    <>
      <ChatUnreadStatus />
      <ChatNavigationButton active={false} onClick={() => undefined} />
      <ChatActivityBadge
        unreadCount={count?.unreadCount ?? 0}
        mentionCount={count?.unreadMentionCount ?? 0}
        label="General forum"
      />
      <button type="button" onClick={() => void unread.refresh()}>
        Refresh test activity
      </button>
      <button
        type="button"
        onClick={() => {
          void unread
            .markRead({
              conversationType: 'channel',
              conversationId: CHANNEL_ID,
              messageId: '22222222-2222-4222-8222-222222222222',
            })
            .catch(() => setActionError('mark failed'));
        }}
      >
        Mark test conversation read
      </button>
      {actionError && <p role="alert">{actionError}</p>}
    </>
  );
}

function renderHarness(sessionKey = 'firebase-user-a') {
  return render(
    <ChatUnreadProvider enabled sessionKey={sessionKey}>
      <Harness />
    </ChatUnreadProvider>
  );
}

describe('ChatUnreadProvider and badges (US-034 / #402)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(chatApi.fetchChatUnreadSummary).mockResolvedValue(EMPTY_SUMMARY);
  });

  it('shows a non-numeric loading state and hides zero-count badges', async () => {
    vi.mocked(chatApi.fetchChatUnreadSummary).mockReturnValue(new Promise(() => {}));
    renderHarness();

    expect(screen.getByRole('status')).toHaveTextContent(/loading unread chat activity/i);
    expect(
      screen.getByRole('button', {
        name: /^open chat$/i,
        description: /loading unread chat activity/i,
      })
    ).toBeInTheDocument();
    expect(screen.queryByTestId('chat-activity-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-nav-badge')).not.toBeInTheDocument();
  });

  it('renders distinct accessible unread and mention badges using the US-021 zero rule', async () => {
    vi.mocked(chatApi.fetchChatUnreadSummary).mockResolvedValue(summary(3, 1));
    renderHarness();

    expect(
      await screen.findByRole('status', {
        name: /general forum: 3 unread messages, 1 unread mention/i,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /^open chat$/i,
        description: /3 unread messages including 1 mention/i,
      })
    ).toBeInTheDocument();
    expect(screen.getByTestId('chat-nav-badge')).toHaveTextContent('3');
    expect(screen.getByTestId('chat-nav-mention-badge')).toHaveTextContent('@1');
  });

  it('refreshes from the authoritative backend and reports a safe error with retry', async () => {
    vi.mocked(chatApi.fetchChatUnreadSummary)
      .mockRejectedValueOnce(new Error('database details must not render'))
      .mockResolvedValueOnce(summary(4, 0));
    renderHarness();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not refresh chat activity/i
    );
    expect(screen.queryByText(/database details/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry chat activity/i }));

    expect(
      await screen.findByRole('status', { name: /general forum: 4 unread messages/i })
    ).toBeInTheDocument();
  });

  it('updates badges only after mark-read succeeds and then reconciles totals', async () => {
    vi.mocked(chatApi.fetchChatUnreadSummary)
      .mockResolvedValueOnce(summary(2, 1))
      .mockResolvedValueOnce(EMPTY_SUMMARY);
    vi.mocked(chatApi.markChatConversationRead).mockResolvedValue({
      conversationType: 'channel',
      conversationId: CHANNEL_ID,
      readCursor: {
        messageId: '22222222-2222-4222-8222-222222222222',
        createdAt: '2026-11-10T12:00:00.000Z',
      },
      advanced: true,
      unreadCount: 0,
      unreadMentionCount: 0,
    });
    renderHarness();
    await screen.findByRole('status', { name: /2 unread messages/i });

    fireEvent.click(screen.getByRole('button', { name: /mark test conversation read/i }));
    await waitFor(() => {
      expect(screen.queryByTestId('chat-activity-badge')).not.toBeInTheDocument();
      expect(screen.queryByTestId('chat-nav-badge')).not.toBeInTheDocument();
    });
    expect(chatApi.markChatConversationRead).toHaveBeenCalledTimes(1);
  });

  it('keeps confirmed badges when mark-read fails', async () => {
    vi.mocked(chatApi.fetchChatUnreadSummary).mockResolvedValue(summary(2, 1));
    vi.mocked(chatApi.markChatConversationRead).mockRejectedValue(
      new chatApi.ChatApiError(503, 'UNAVAILABLE')
    );
    renderHarness();
    await screen.findByRole('status', { name: /2 unread messages/i });

    fireEvent.click(screen.getByRole('button', { name: /mark test conversation read/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('mark failed');
    expect(screen.getByTestId('chat-nav-badge')).toHaveTextContent('2');
  });

  it('removes stale or inaccessible conversations on the next authorized refresh', async () => {
    vi.mocked(chatApi.fetchChatUnreadSummary)
      .mockResolvedValueOnce(summary(5, 1))
      .mockResolvedValueOnce(EMPTY_SUMMARY);
    renderHarness();
    await screen.findByRole('status', { name: /5 unread messages/i });

    fireEvent.click(screen.getByRole('button', { name: /refresh test activity/i }));
    await waitFor(() => {
      expect(screen.queryByTestId('chat-activity-badge')).not.toBeInTheDocument();
      expect(screen.queryByTestId('chat-nav-badge')).not.toBeInTheDocument();
    });
  });

  it('drops the previous account cache immediately when the session changes', async () => {
    let resolveSecond!: (value: ChatUnreadSummary) => void;
    vi.mocked(chatApi.fetchChatUnreadSummary)
      .mockResolvedValueOnce(summary(7, 2))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        })
      );
    const view = renderHarness('firebase-user-a');
    await screen.findByRole('status', { name: /7 unread messages/i });

    view.rerender(
      <ChatUnreadProvider enabled sessionKey="firebase-user-b">
        <Harness />
      </ChatUnreadProvider>
    );
    expect(screen.queryByTestId('chat-nav-badge')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /^open chat$/i,
        description: /loading unread chat activity/i,
      })
    ).toBeInTheDocument();

    resolveSecond(EMPTY_SUMMARY);
    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: /^open chat$/i,
          description: /no unread chat messages/i,
        })
      ).toBeInTheDocument();
    });
  });
});


import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as chatApi from './chatApi';
import { DirectMessagesView } from './DirectMessagesView';
import type { DirectMessageThreadDetail, DirectMessageThreadView } from './chatTypes';

vi.mock('./chatApi', async () => {
  const actual = await vi.importActual<typeof import('./chatApi')>('./chatApi');
  return {
    ...actual,
    listDirectMessageThreads: vi.fn(),
    getDirectMessageThread: vi.fn(),
    sendDirectMessage: vi.fn(),
    openDirectMessageThread: vi.fn(),
  };
});

const THREAD_ID = '11111111-1111-4111-8111-111111111111';
const PEER_ID = '22222222-2222-4222-8222-222222222222';

const thread: DirectMessageThreadView = {
  id: THREAD_ID,
  peer: { id: PEER_ID, handle: 'blake' },
  createdAt: '2026-11-10T20:00:00.000Z',
  updatedAt: '2026-11-10T20:00:00.000Z',
  lastMessage: null,
  lastMessageAt: null,
};
const emptyDetail: DirectMessageThreadDetail = { thread, messages: [], isEmpty: true };

const apiError = (status: number, code: string) =>
  new chatApi.ChatApiError(status, code, undefined, undefined, 'raw server text');

describe('DirectMessagesView: opening a conversation from a Message click (#432)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(chatApi.listDirectMessageThreads).mockResolvedValue([]);
    vi.mocked(chatApi.getDirectMessageThread).mockResolvedValue(emptyDetail);
    vi.mocked(chatApi.openDirectMessageThread).mockResolvedValue(thread);
  });

  it('does nothing extra when there is no request', async () => {
    render(<DirectMessagesView />);
    await screen.findByTestId('dm-inbox-empty');
    expect(chatApi.openDirectMessageThread).not.toHaveBeenCalled();
    expect(screen.queryByTestId('dm-opening')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dm-open-error')).not.toBeInTheDocument();
  });

  it('opens the conversation with that person and shows it ready for the first message', async () => {
    render(<DirectMessagesView openRequest={{ participantId: PEER_ID, requestId: 1 }} />);

    expect(await screen.findByTestId('dm-thread-empty')).toHaveTextContent(/start the conversation below/i);
    expect(chatApi.openDirectMessageThread).toHaveBeenCalledTimes(1);
    expect(chatApi.openDirectMessageThread).toHaveBeenCalledWith(PEER_ID);
    expect(chatApi.getDirectMessageThread).toHaveBeenCalledWith(THREAD_ID);
    expect(screen.getByRole('heading', { name: /blake/i })).toBeInTheDocument();
    expect(screen.queryByTestId('dm-opening')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dm-open-error')).not.toBeInTheDocument();
  });

  it('refreshes the inbox so a brand-new conversation is listed', async () => {
    vi.mocked(chatApi.listDirectMessageThreads).mockResolvedValueOnce([]).mockResolvedValue([thread]);

    render(<DirectMessagesView openRequest={{ participantId: PEER_ID, requestId: 1 }} />);

    await screen.findByTestId('dm-thread-empty');
    const list = await screen.findByRole('list', { name: /direct-message conversations/i });
    expect(list).toHaveTextContent('blake');
    expect(screen.queryByTestId('dm-inbox-empty')).not.toBeInTheDocument();
  });

  it('shows "Opening conversation…" while the conversation is being opened', async () => {
    let finish: (t: DirectMessageThreadView) => void = () => undefined;
    vi.mocked(chatApi.openDirectMessageThread).mockReturnValue(new Promise((resolve) => { finish = resolve; }));

    render(<DirectMessagesView openRequest={{ participantId: PEER_ID, requestId: 1 }} />);

    expect(await screen.findByTestId('dm-opening')).toHaveTextContent(/opening conversation/i);
    await act(async () => finish(thread));
    await screen.findByTestId('dm-thread-empty');
    expect(screen.queryByTestId('dm-opening')).not.toBeInTheDocument();
  });

  it('clicking Message for the same person again opens the SAME conversation, not a new one', async () => {
    const { rerender } = render(<DirectMessagesView openRequest={{ participantId: PEER_ID, requestId: 1 }} />);
    await screen.findByTestId('dm-thread-empty');

    rerender(<DirectMessagesView openRequest={{ participantId: PEER_ID, requestId: 2 }} />);
    await waitFor(() => expect(chatApi.openDirectMessageThread).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(chatApi.getDirectMessageThread).toHaveBeenCalledTimes(2));

    expect(vi.mocked(chatApi.getDirectMessageThread).mock.calls.map((c) => c[0])).toEqual([THREAD_ID, THREAD_ID]);
    expect(screen.getAllByRole('heading', { name: /blake/i })).toHaveLength(1);
  });

  it('runs each request once even when the same request is rendered again', async () => {
    const request = { participantId: PEER_ID, requestId: 7 };
    const { rerender } = render(<DirectMessagesView openRequest={request} />);
    await screen.findByTestId('dm-thread-empty');
    rerender(<DirectMessagesView openRequest={{ ...request }} />);
    rerender(<DirectMessagesView openRequest={request} />);
    expect(chatApi.openDirectMessageThread).toHaveBeenCalledTimes(1);
  });

  it('runs a request once under React StrictMode (effects run twice in development)', async () => {
    render(
      <React.StrictMode>
        <DirectMessagesView openRequest={{ participantId: PEER_ID, requestId: 1 }} />
      </React.StrictMode>
    );
    await screen.findByTestId('dm-thread-empty');
    expect(chatApi.openDirectMessageThread).toHaveBeenCalledTimes(1);
  });

  it('tells the app the request was taken, exactly once, so it is not replayed on a later visit', async () => {
    const handled = vi.fn();
    render(<DirectMessagesView openRequest={{ participantId: PEER_ID, requestId: 1 }} onOpenRequestHandled={handled} />);
    await screen.findByTestId('dm-thread-empty');
    expect(handled).toHaveBeenCalledTimes(1);
  });

  describe('when the conversation cannot be opened', () => {
    it('shows a friendly message for an unavailable person and does not open any conversation', async () => {
      vi.mocked(chatApi.openDirectMessageThread).mockRejectedValue(apiError(404, 'PEER_NOT_AVAILABLE'));

      render(<DirectMessagesView openRequest={{ participantId: PEER_ID, requestId: 1 }} />);

      expect(await screen.findByTestId('dm-open-error')).toHaveTextContent('You cannot message this participant right now.');
      expect(screen.getByTestId('dm-open-error')).not.toHaveTextContent(/raw server text|block|suspend/i);
      expect(chatApi.getDirectMessageThread).not.toHaveBeenCalled();
      expect(screen.queryByTestId('dm-opening')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dm-thread-empty')).not.toBeInTheDocument();
    });

    it.each([
      [apiError(400, 'CANNOT_MESSAGE_SELF'), 'You cannot send a direct message to yourself.'],
      [apiError(403, 'FORBIDDEN'), 'Please sign in again to use direct messages.'],
      [new Error('network down'), 'Could not open the conversation. Please try again.'],
    ])('shows the right message for %#', async (error, text) => {
      vi.mocked(chatApi.openDirectMessageThread).mockRejectedValue(error);
      render(<DirectMessagesView openRequest={{ participantId: PEER_ID, requestId: 1 }} />);
      expect(await screen.findByTestId('dm-open-error')).toHaveTextContent(text);
    });

    it('the message can be dismissed', async () => {
      vi.mocked(chatApi.openDirectMessageThread).mockRejectedValue(apiError(404, 'PEER_NOT_AVAILABLE'));
      render(<DirectMessagesView openRequest={{ participantId: PEER_ID, requestId: 1 }} />);
      await screen.findByTestId('dm-open-error');
      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
      expect(screen.queryByTestId('dm-open-error')).not.toBeInTheDocument();
    });

    it('a later successful request clears the earlier error', async () => {
      vi.mocked(chatApi.openDirectMessageThread).mockRejectedValueOnce(apiError(404, 'PEER_NOT_AVAILABLE'));
      const { rerender } = render(<DirectMessagesView openRequest={{ participantId: PEER_ID, requestId: 1 }} />);
      await screen.findByTestId('dm-open-error');

      rerender(<DirectMessagesView openRequest={{ participantId: PEER_ID, requestId: 2 }} />);
      await screen.findByTestId('dm-thread-empty');
      expect(screen.queryByTestId('dm-open-error')).not.toBeInTheDocument();
    });
  });

  it('an older, slower request never overwrites a newer one', async () => {
    const OTHER_ID = '99999999-9999-4999-8999-999999999999';
    const otherThread: DirectMessageThreadView = {
      ...thread,
      id: '88888888-8888-4888-8888-888888888888',
      peer: { id: OTHER_ID, handle: 'casey' },
    };
    let finishFirst: (t: DirectMessageThreadView) => void = () => undefined;
    vi.mocked(chatApi.openDirectMessageThread)
      .mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce(otherThread);
    vi.mocked(chatApi.getDirectMessageThread).mockImplementation(async (id: string) => ({
      thread: id === otherThread.id ? otherThread : thread,
      messages: [],
      isEmpty: true,
    }));

    const { rerender } = render(<DirectMessagesView openRequest={{ participantId: PEER_ID, requestId: 1 }} />);
    rerender(<DirectMessagesView openRequest={{ participantId: OTHER_ID, requestId: 2 }} />);

    expect(await screen.findByRole('heading', { name: /casey/i })).toBeInTheDocument();
    await act(async () => finishFirst(thread));

    expect(screen.getByRole('heading', { name: /casey/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /blake/i })).not.toBeInTheDocument();
    expect(chatApi.getDirectMessageThread).not.toHaveBeenCalledWith(THREAD_ID);
  });
});

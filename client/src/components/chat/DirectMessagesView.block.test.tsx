import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as chatApi from './chatApi';
import { DirectMessagesView } from './DirectMessagesView';
import type { DirectMessageThreadDetail, DirectMessageThreadView, DirectMessageView } from './chatTypes';

vi.mock('./chatApi', async () => {
  const actual = await vi.importActual<typeof import('./chatApi')>('./chatApi');
  return {
    ...actual,
    listDirectMessageThreads: vi.fn(),
    getDirectMessageThread: vi.fn(),
    sendDirectMessage: vi.fn(),
    blockDirectMessageParticipant: vi.fn(),
    unblockDirectMessageParticipant: vi.fn(),
  };
});

const THREAD_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_THREAD_ID = '55555555-5555-4555-8555-555555555555';
const PEER_ID = '22222222-2222-4222-8222-222222222222';

const sent: DirectMessageView = {
  id: '33333333-3333-4333-8333-333333333333',
  threadId: THREAD_ID,
  fromMe: true,
  authorHandle: 'me',
  body: 'hello',
  createdAt: '2026-11-10T20:05:00.000Z',
};

const thread: DirectMessageThreadView = {
  id: THREAD_ID,
  peer: { id: PEER_ID, handle: 'blake' },
  createdAt: '2026-11-10T20:00:00.000Z',
  updatedAt: '2026-11-10T20:05:00.000Z',
  lastMessage: null,
  lastMessageAt: null,
};
const otherThread: DirectMessageThreadView = {
  ...thread,
  id: OTHER_THREAD_ID,
  peer: { id: '66666666-6666-4666-8666-666666666666', handle: 'casey' },
};

const detail = (over: Partial<DirectMessageThreadView> = {}): DirectMessageThreadDetail => ({
  thread: { ...thread, youBlockedPeer: false, ...over },
  messages: [],
  isEmpty: true,
});

const apiError = (status: number, code: string, message = 'raw server text') =>
  new chatApi.ChatApiError(status, code, undefined, undefined, message);

async function openConversation(handle = 'blake'): Promise<void> {
  render(<DirectMessagesView />);
  const button = await screen.findByRole('button', { name: new RegExp(handle, 'i') });
  await act(async () => {
    fireEvent.click(button);
  });
  await screen.findByTestId('dm-composer');
}

describe('DirectMessagesView: block and unblock (#433)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(chatApi.listDirectMessageThreads).mockResolvedValue([thread, otherThread]);
    vi.mocked(chatApi.getDirectMessageThread).mockResolvedValue(detail());
    vi.mocked(chatApi.sendDirectMessage).mockResolvedValue(sent);
    vi.mocked(chatApi.blockDirectMessageParticipant).mockResolvedValue(true);
    vi.mocked(chatApi.unblockDirectMessageParticipant).mockResolvedValue(false);
  });

  describe('blocking', () => {
    it('offers a Block button in the conversation header', async () => {
      await openConversation();
      expect(screen.getByTestId('dm-block')).toHaveAccessibleName(/block blake/i);
      expect(screen.queryByTestId('dm-unblock')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dm-block-confirm')).not.toBeInTheDocument();
    });

    it('asks for confirmation first, and nothing is blocked until it is given', async () => {
      await openConversation();
      fireEvent.click(screen.getByTestId('dm-block'));

      expect(screen.getByTestId('dm-block-confirm')).toHaveTextContent(/block blake\?/i);
      expect(screen.getByTestId('dm-block-confirm')).toHaveTextContent(/neither of you will be able to send messages/i);
      expect(chatApi.blockDirectMessageParticipant).not.toHaveBeenCalled();
    });

    it('Cancel closes the confirmation without blocking', async () => {
      await openConversation();
      fireEvent.click(screen.getByTestId('dm-block'));
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

      expect(screen.queryByTestId('dm-block-confirm')).not.toBeInTheDocument();
      expect(chatApi.blockDirectMessageParticipant).not.toHaveBeenCalled();
      expect(screen.getByTestId('dm-block')).toBeInTheDocument();
    });

    it('confirming blocks that person, says so, and swaps Block for Unblock', async () => {
      await openConversation();
      fireEvent.click(screen.getByTestId('dm-block'));
      await act(async () => {
        fireEvent.click(screen.getByTestId('dm-block-confirm-yes'));
      });

      expect(chatApi.blockDirectMessageParticipant).toHaveBeenCalledTimes(1);
      expect(chatApi.blockDirectMessageParticipant).toHaveBeenCalledWith(PEER_ID);
      expect(await screen.findByTestId('dm-block-notice')).toHaveTextContent('Participant blocked.');
      expect(screen.getByTestId('dm-unblock')).toHaveAccessibleName(/unblock blake/i);
      expect(screen.queryByTestId('dm-block')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dm-block-confirm')).not.toBeInTheDocument();
    });

    it('stops you sending: the composer is disabled and says why', async () => {
      await openConversation();
      fireEvent.click(screen.getByTestId('dm-block'));
      await act(async () => {
        fireEvent.click(screen.getByTestId('dm-block-confirm-yes'));
      });

      expect(await screen.findByTestId('dm-blocked-notice')).toHaveTextContent(
        /you have blocked this participant\. unblock them to send messages\./i
      );
      expect(screen.getByLabelText('Message')).toBeDisabled();
      expect(screen.getByRole('button', { name: /send message/i })).toBeDisabled();
    });

    it('keeps what you had typed while you block and later unblock', async () => {
      await openConversation();
      fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'half-written thought' } });

      fireEvent.click(screen.getByTestId('dm-block'));
      await act(async () => {
        fireEvent.click(screen.getByTestId('dm-block-confirm-yes'));
      });
      expect(screen.getByLabelText('Message')).toHaveValue('half-written thought');

      await act(async () => {
        fireEvent.click(await screen.findByTestId('dm-unblock'));
      });
      await waitFor(() => expect(screen.getByLabelText('Message')).not.toBeDisabled());
      expect(screen.getByLabelText('Message')).toHaveValue('half-written thought');
    });

    it('shows the problem and stays unblocked when blocking fails', async () => {
      vi.mocked(chatApi.blockDirectMessageParticipant).mockRejectedValue(apiError(404, 'PEER_NOT_AVAILABLE', 'That participant is not available.'));
      await openConversation();
      fireEvent.click(screen.getByTestId('dm-block'));
      await act(async () => {
        fireEvent.click(screen.getByTestId('dm-block-confirm-yes'));
      });

      expect(await screen.findByTestId('dm-block-error')).toHaveTextContent('That participant is not available.');
      expect(screen.getByTestId('dm-block')).toBeInTheDocument();
      expect(screen.queryByTestId('dm-unblock')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Message')).not.toBeDisabled();
      expect(screen.queryByTestId('dm-block-notice')).not.toBeInTheDocument();
    });

    it.each([
      [apiError(401, 'UNAUTHORIZED'), 'Please sign in again to use direct messages.'],
      [apiError(403, 'FORBIDDEN'), 'Please sign in again to use direct messages.'],
      [new Error('network down'), 'network down'],
      ['not an error', 'Could not block this participant. Please try again.'],
    ])('shows a sensible message for failure %#', async (error, text) => {
      vi.mocked(chatApi.blockDirectMessageParticipant).mockRejectedValue(error);
      await openConversation();
      fireEvent.click(screen.getByTestId('dm-block'));
      await act(async () => {
        fireEvent.click(screen.getByTestId('dm-block-confirm-yes'));
      });
      expect(await screen.findByTestId('dm-block-error')).toHaveTextContent(text);
    });

    it('disables the buttons while the request is running, so it cannot be sent twice', async () => {
      let finish: (value: boolean) => void = () => undefined;
      vi.mocked(chatApi.blockDirectMessageParticipant).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      await openConversation();
      fireEvent.click(screen.getByTestId('dm-block'));
      fireEvent.click(screen.getByTestId('dm-block-confirm-yes'));

      expect(await screen.findByRole('button', { name: /blocking…/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: /blocking…/i }));
      expect(chatApi.blockDirectMessageParticipant).toHaveBeenCalledTimes(1);

      await act(async () => finish(true));
      expect(await screen.findByTestId('dm-unblock')).toBeInTheDocument();
    });
  });

  describe('unblocking', () => {
    beforeEach(() => {
      vi.mocked(chatApi.getDirectMessageThread).mockResolvedValue(detail({ youBlockedPeer: true }));
    });

    it('opens a conversation you already blocked with Unblock, the notice, and a disabled composer', async () => {
      await openConversation();
      expect(screen.getByTestId('dm-unblock')).toBeInTheDocument();
      expect(screen.queryByTestId('dm-block')).not.toBeInTheDocument();
      expect(screen.getByTestId('dm-blocked-notice')).toBeInTheDocument();
      expect(screen.getByLabelText('Message')).toBeDisabled();
    });

    it('unblocking removes your block, says so, and lets you send again', async () => {
      await openConversation();
      await act(async () => {
        fireEvent.click(screen.getByTestId('dm-unblock'));
      });

      expect(chatApi.unblockDirectMessageParticipant).toHaveBeenCalledTimes(1);
      expect(chatApi.unblockDirectMessageParticipant).toHaveBeenCalledWith(PEER_ID);
      expect(await screen.findByTestId('dm-block-notice')).toHaveTextContent('Participant unblocked.');
      expect(screen.getByTestId('dm-block')).toBeInTheDocument();
      expect(screen.queryByTestId('dm-unblock')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dm-blocked-notice')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Message')).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /send message/i })).not.toBeDisabled();
    });

    it('can send a message right after unblocking', async () => {
      await openConversation();
      await act(async () => {
        fireEvent.click(screen.getByTestId('dm-unblock'));
      });
      await waitFor(() => expect(screen.getByLabelText('Message')).not.toBeDisabled());

      fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello again' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /send message/i }));
      });
      expect(chatApi.sendDirectMessage).toHaveBeenCalledWith(THREAD_ID, { body: 'hello again' });
    });

    it('shows the problem and stays blocked when unblocking fails', async () => {
      vi.mocked(chatApi.unblockDirectMessageParticipant).mockRejectedValue(new Error('network down'));
      await openConversation();
      await act(async () => {
        fireEvent.click(screen.getByTestId('dm-unblock'));
      });

      expect(await screen.findByTestId('dm-block-error')).toHaveTextContent('network down');
      expect(screen.getByTestId('dm-unblock')).toBeInTheDocument();
      expect(screen.getByLabelText('Message')).toBeDisabled();
    });
  });

  describe('what the screen never does', () => {
    it('shows no block controls or notices until a conversation is open', async () => {
      render(<DirectMessagesView />);
      await screen.findByRole('button', { name: /blake/i });
      expect(screen.queryByTestId('dm-block')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dm-unblock')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dm-blocked-notice')).not.toBeInTheDocument();
    });

    it('treats a missing youBlockedPeer as "not blocked" (older answers)', async () => {
      vi.mocked(chatApi.getDirectMessageThread).mockResolvedValue({ thread, messages: [], isEmpty: true });
      await openConversation();
      expect(screen.getByTestId('dm-block')).toBeInTheDocument();
      expect(screen.getByLabelText('Message')).not.toBeDisabled();
    });

    it('never says anything about the OTHER person having blocked you', async () => {
      await openConversation();
      expect(document.body.textContent).not.toMatch(/blocked you|has blocked you/i);
    });

    it('moving to another conversation closes the confirmation and clears old notices', async () => {
      await openConversation();
      fireEvent.click(screen.getByTestId('dm-block'));
      expect(screen.getByTestId('dm-block-confirm')).toBeInTheDocument();

      vi.mocked(chatApi.getDirectMessageThread).mockResolvedValue({ thread: otherThread, messages: [], isEmpty: true });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /casey/i }));
      });

      await waitFor(() => expect(screen.getByRole('heading', { name: /casey/i })).toBeInTheDocument());
      expect(screen.queryByTestId('dm-block-confirm')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dm-block-notice')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dm-block-error')).not.toBeInTheDocument();
    });

    it('blocking in one conversation does not affect another', async () => {
      await openConversation();
      fireEvent.click(screen.getByTestId('dm-block'));
      await act(async () => {
        fireEvent.click(screen.getByTestId('dm-block-confirm-yes'));
      });
      await screen.findByTestId('dm-unblock');

      vi.mocked(chatApi.getDirectMessageThread).mockResolvedValue({
        thread: { ...otherThread, youBlockedPeer: false },
        messages: [],
        isEmpty: true,
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /casey/i }));
      });
      await waitFor(() => expect(screen.getByRole('heading', { name: /casey/i })).toBeInTheDocument());
      expect(screen.getByTestId('dm-block')).toHaveAccessibleName(/block casey/i);
      expect(screen.getByLabelText('Message')).not.toBeDisabled();
    });

    describe('when the server refuses a send because of a block', () => {
      async function sendAfterTyping(text: string): Promise<void> {
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: text } });
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: /send message/i }));
        });
      }

      it('shows the neutral message to the person who was blocked, and keeps the conversation and the draft', async () => {
        vi.mocked(chatApi.sendDirectMessage).mockRejectedValue(
          apiError(403, 'DM_PEER_UNAVAILABLE', 'You cannot send messages in this conversation.')
        );
        await openConversation();
        await sendAfterTyping('are you there?');

        expect(await screen.findByText('You cannot send messages in this conversation.')).toBeInTheDocument();
        expect(screen.queryByText(/direct-message access denied/i)).not.toBeInTheDocument();
        expect(screen.getByTestId('dm-composer')).toBeInTheDocument();
        expect(screen.getByLabelText('Message')).toHaveValue('are you there?');
        expect(screen.getByRole('heading', { name: /blake/i })).toBeInTheDocument();
      });

      it('does not offer Unblock or say anything about a block to the person who was blocked', async () => {
        vi.mocked(chatApi.sendDirectMessage).mockRejectedValue(
          apiError(403, 'DM_PEER_UNAVAILABLE', 'You cannot send messages in this conversation.')
        );
        await openConversation();
        await sendAfterTyping('hello');
        await screen.findByText('You cannot send messages in this conversation.');

        expect(screen.queryByTestId('dm-unblock')).not.toBeInTheDocument();
        expect(screen.queryByTestId('dm-blocked-notice')).not.toBeInTheDocument();
        expect(screen.getByTestId('dm-block')).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/blocked you/i);
      });

      it('tells the blocker, switches the screen to the blocked state, and keeps the draft', async () => {
        vi.mocked(chatApi.sendDirectMessage).mockRejectedValue(
          apiError(403, 'DM_BLOCKED_BY_YOU', 'You have blocked this participant. Unblock them to send messages.')
        );
        await openConversation();
        await sendAfterTyping('forgot I blocked them');

        expect(await screen.findByTestId('dm-unblock')).toBeInTheDocument();
        expect(screen.getByTestId('dm-blocked-notice')).toBeInTheDocument();
        expect(screen.getByLabelText('Message')).toBeDisabled();
        expect(screen.getByLabelText('Message')).toHaveValue('forgot I blocked them');
        expect(screen.queryByText(/direct-message access denied/i)).not.toBeInTheDocument();
      });

      it('a refusal for another reason (not your thread) still shows access denied, as before', async () => {
        vi.mocked(chatApi.sendDirectMessage).mockRejectedValue(
          apiError(403, 'FORBIDDEN_NOT_THREAD_PARTICIPANT', 'You do not have access to this conversation.')
        );
        await openConversation();
        await sendAfterTyping('hello');
        expect(await screen.findByText(/direct-message access denied/i)).toBeInTheDocument();
      });

      it('a sign-in problem (401) still shows access denied, as before', async () => {
        vi.mocked(chatApi.sendDirectMessage).mockRejectedValue(apiError(401, 'UNAUTHORIZED'));
        await openConversation();
        await sendAfterTyping('hello');
        expect(await screen.findByText(/direct-message access denied/i)).toBeInTheDocument();
      });

      it('after unblocking following a stale refusal, sending works again', async () => {
        vi.mocked(chatApi.sendDirectMessage)
          .mockRejectedValueOnce(apiError(403, 'DM_BLOCKED_BY_YOU', 'You have blocked this participant. Unblock them to send messages.'))
          .mockResolvedValue(sent);
        await openConversation();
        await sendAfterTyping('retry me');
        await act(async () => {
          fireEvent.click(await screen.findByTestId('dm-unblock'));
        });
        await waitFor(() => expect(screen.getByLabelText('Message')).not.toBeDisabled());
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: /send message/i }));
        });
        expect(chatApi.sendDirectMessage).toHaveBeenLastCalledWith(THREAD_ID, { body: 'retry me' });
      });
    });
  });

  describe('timing and edge cases', () => {
    it('a slow block answer that arrives after you moved to another conversation does not mark that conversation', async () => {
      let finish: (value: boolean) => void = () => undefined;
      vi.mocked(chatApi.blockDirectMessageParticipant).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      await openConversation();
      fireEvent.click(screen.getByTestId('dm-block'));
      fireEvent.click(screen.getByTestId('dm-block-confirm-yes'));

      vi.mocked(chatApi.getDirectMessageThread).mockResolvedValue({
        thread: { ...otherThread, youBlockedPeer: false },
        messages: [],
        isEmpty: true,
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /casey/i }));
      });
      await waitFor(() => expect(screen.getByRole('heading', { name: /casey/i })).toBeInTheDocument());

      await act(async () => finish(true));

      expect(screen.getByTestId('dm-block')).toHaveAccessibleName(/block casey/i);
      expect(screen.queryByTestId('dm-unblock')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Message')).not.toBeDisabled();
    });

    it('after blocking and then unblocking, the confirmation does not come back by itself', async () => {
      await openConversation();
      fireEvent.click(screen.getByTestId('dm-block'));
      await act(async () => {
        fireEvent.click(screen.getByTestId('dm-block-confirm-yes'));
      });
      await act(async () => {
        fireEvent.click(await screen.findByTestId('dm-unblock'));
      });
      await screen.findByTestId('dm-block');

      expect(screen.queryByTestId('dm-block-confirm')).not.toBeInTheDocument();
    });

    it.each([
      [401, 'DM_BLOCKED_BY_YOU'],
      [500, 'DM_PEER_UNAVAILABLE'],
    ])('a %i with the code %s is not mistaken for a block refusal', async (status, code) => {
      vi.mocked(chatApi.sendDirectMessage).mockRejectedValue(apiError(status, code, 'raw server text'));
      await openConversation();
      fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /send message/i }));
      });

      expect(screen.queryByTestId('dm-unblock')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dm-blocked-notice')).not.toBeInTheDocument();
    });
  });
});

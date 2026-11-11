import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as chatApi from './chatApi';
import { DirectMessagesView } from './DirectMessagesView';
import type { DirectMessageThreadView, DirectMessageView } from './chatTypes';

vi.mock('./chatApi', async () => {
  const actual = await vi.importActual<typeof import('./chatApi')>('./chatApi');
  return {
    ...actual,
    listDirectMessageThreads: vi.fn(),
    getDirectMessageThread: vi.fn(),
    sendDirectMessage: vi.fn(),
  };
});

const THREAD_ID = '11111111-1111-4111-8111-111111111111';
const PEER_ID = '22222222-2222-4222-8222-222222222222';

const thread: DirectMessageThreadView = {
  id: THREAD_ID,
  peer: { id: PEER_ID, handle: 'blake' },
  createdAt: '2026-11-10T20:00:00.000Z',
  updatedAt: '2026-11-10T20:05:00.000Z',
  lastMessage: null,
  lastMessageAt: null,
};

const theirs: DirectMessageView = {
  id: '33333333-3333-4333-8333-333333333331',
  threadId: THREAD_ID,
  fromMe: false,
  authorHandle: 'blake',
  body: 'hi from blake',
  createdAt: '2026-11-10T20:01:00.000Z',
};
const mine: DirectMessageView = {
  id: '33333333-3333-4333-8333-333333333332',
  threadId: THREAD_ID,
  fromMe: true,
  authorHandle: 'sam',
  body: 'hi from me',
  createdAt: '2026-11-10T20:02:00.000Z',
};

async function openConversation(): Promise<void> {
  render(<DirectMessagesView />);
  const button = await screen.findByRole('button', { name: /blake/i });
  await act(async () => {
    fireEvent.click(button);
  });
  await screen.findByTestId('dm-composer');
}

describe('DirectMessagesView: own messages are marked (#434)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(chatApi.listDirectMessageThreads).mockResolvedValue([thread]);
    vi.mocked(chatApi.getDirectMessageThread).mockResolvedValue({
      thread,
      messages: [theirs, mine],
      isEmpty: false,
    });
  });

  it('labels your message "You" and the other person\'s by their handle', async () => {
    await openConversation();
    const [first, second] = screen.getAllByTestId('dm-message');

    expect(within(first).getByText('blake')).toBeInTheDocument();
    expect(within(first).queryByText('You')).not.toBeInTheDocument();
    expect(within(second).getByText('You')).toBeInTheDocument();
    expect(within(second).queryByText('sam')).not.toBeInTheDocument();
  });

  it('marks which messages are yours so they can be styled and aligned apart', async () => {
    await openConversation();
    const [first, second] = screen.getAllByTestId('dm-message');

    expect(first).toHaveAttribute('data-from-me', 'false');
    expect(second).toHaveAttribute('data-from-me', 'true');
    expect(second.className).toContain('ml-auto');
    expect(first.className).toContain('mr-auto');
    expect(second.className).not.toEqual(first.className);
  });

  it('still shows the other person as "Participant" when they have no handle', async () => {
    vi.mocked(chatApi.getDirectMessageThread).mockResolvedValue({
      thread,
      messages: [{ ...theirs, authorHandle: null }],
      isEmpty: false,
    });
    await openConversation();
    expect(within(screen.getByTestId('dm-message')).getByText('Participant')).toBeInTheDocument();
  });

  it('shows a message you just sent as yours', async () => {
    vi.mocked(chatApi.getDirectMessageThread).mockResolvedValue({ thread, messages: [], isEmpty: true });
    vi.mocked(chatApi.sendDirectMessage).mockResolvedValue({ ...mine, body: 'just now' });
    await openConversation();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'just now' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send message/i }));
    });

    const row = await screen.findByTestId('dm-message');
    expect(row).toHaveAttribute('data-from-me', 'true');
    expect(within(row).getByText('You')).toBeInTheDocument();
  });

  it('treats a message without fromMe as the other person\'s, never as yours', async () => {
    const withoutFlag: Partial<DirectMessageView> = { ...theirs };
    delete withoutFlag.fromMe;
    vi.mocked(chatApi.getDirectMessageThread).mockResolvedValue({
      thread,
      messages: [withoutFlag as DirectMessageView],
      isEmpty: false,
    });
    await openConversation();
    expect(screen.getByTestId('dm-message')).toHaveAttribute('data-from-me', 'false');
  });
});

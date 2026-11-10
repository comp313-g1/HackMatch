import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as chatApi from './chatApi';
import { TeamChatView } from './TeamChatView';
import type { ChatMessageView, TeamChatChannelView } from './chatTypes';

vi.mock('./chatApi', async () => {
  const actual = await vi.importActual<typeof import('./chatApi')>('./chatApi');
  return {
    ...actual,
    openTeamChat: vi.fn(),
    listTeamChatMessages: vi.fn(),
    sendTeamChatMessage: vi.fn(),
  };
});

const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';

const channel: TeamChatChannelView = {
  id: CHANNEL_ID,
  title: 'Team: Civic Signal',
  description: 'Private team coordination channel.',
  createdBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  channelType: 'team',
  teamId: TEAM_ID,
  createdAt: '2026-11-09T18:00:00.000Z',
  updatedAt: '2026-11-09T18:00:00.000Z',
};

const message: ChatMessageView = {
  id: '33333333-3333-4333-8333-333333333333',
  channelId: CHANNEL_ID,
  authorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  authorHandle: 'avery',
  body: 'Private launch plan',
  createdAt: '2026-11-09T18:05:00.000Z',
};

function renderAndOpen(): void {
  render(<TeamChatView teamId={TEAM_ID} teamName="Civic Signal" />);
  fireEvent.click(screen.getByRole('button', { name: /open team chat/i }));
}

describe('TeamChatView (US-031 / #383)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(chatApi.openTeamChat).mockResolvedValue(channel);
    vi.mocked(chatApi.listTeamChatMessages).mockResolvedValue([]);
    vi.mocked(chatApi.sendTeamChatMessage).mockResolvedValue(message);
  });

  it('shows an explicit loading state without rendering stale private content', () => {
    vi.mocked(chatApi.openTeamChat).mockReturnValue(new Promise(() => {}));
    vi.mocked(chatApi.listTeamChatMessages).mockReturnValue(new Promise(() => {}));

    renderAndOpen();

    expect(screen.getByRole('status')).toHaveTextContent(/loading private team chat/i);
    expect(screen.queryByText(/private launch plan/i)).not.toBeInTheDocument();
  });

  it('discards an in-flight response when the selected team changes', async () => {
    let resolveChannel!: (value: TeamChatChannelView) => void;
    let resolveMessages!: (value: ChatMessageView[]) => void;
    vi.mocked(chatApi.openTeamChat).mockReturnValue(
      new Promise((resolve) => {
        resolveChannel = resolve;
      })
    );
    vi.mocked(chatApi.listTeamChatMessages).mockReturnValue(
      new Promise((resolve) => {
        resolveMessages = resolve;
      })
    );

    const view = render(<TeamChatView teamId={TEAM_ID} teamName="Civic Signal" />);
    fireEvent.click(screen.getByRole('button', { name: /open team chat/i }));
    view.rerender(
      <TeamChatView
        teamId="44444444-4444-4444-8444-444444444444"
        teamName="Another Team"
      />
    );
    await act(async () => {
      resolveChannel(channel);
      resolveMessages([message]);
    });

    expect(screen.getByRole('button', { name: /open team chat/i })).toBeInTheDocument();
    expect(screen.queryByText(channel.title)).not.toBeInTheDocument();
    expect(screen.queryByText(message.body)).not.toBeInTheDocument();
  });

  it('shows an empty state and keeps the composer available', async () => {
    renderAndOpen();

    expect(await screen.findByTestId('team-chat-empty')).toHaveTextContent(
      /no team messages yet/i
    );
    expect(screen.getByLabelText(/^message$/i)).toBeEnabled();
    expect(screen.getByRole('button', { name: /send message/i })).toBeEnabled();
  });

  it('renders existing message handle, timestamp, and content', async () => {
    vi.mocked(chatApi.listTeamChatMessages).mockResolvedValue([message]);
    renderAndOpen();

    expect(await screen.findByText('Private launch plan')).toBeInTheDocument();
    expect(screen.getByText('avery')).toBeInTheDocument();
    expect(screen.getByText('Private launch plan').closest('li')?.querySelector('time')).toHaveAttribute(
      'dateTime',
      message.createdAt
    );
  });

  it('appends a successful message and clears the draft only after success', async () => {
    renderAndOpen();
    const composer = await screen.findByLabelText(/^message$/i);
    fireEvent.change(composer, { target: { value: 'Private launch plan' } });
    fireEvent.submit(screen.getByTestId('team-chat-composer'));

    await waitFor(() => {
      expect(chatApi.sendTeamChatMessage).toHaveBeenCalledWith(TEAM_ID, {
        body: 'Private launch plan',
      });
    });
    expect(await screen.findByText('Message sent.')).toBeInTheDocument();
    expect(composer).toHaveValue('');
    expect(screen.getByText('Private launch plan')).toBeInTheDocument();
  });

  it('shows client validation and preserves an invalid draft', async () => {
    renderAndOpen();
    const composer = await screen.findByLabelText(/^message$/i);
    fireEvent.change(composer, { target: { value: '   ' } });
    fireEvent.submit(screen.getByTestId('team-chat-composer'));

    expect(await screen.findByText('Message is required.')).toBeInTheDocument();
    expect(composer).toHaveValue('   ');
    expect(chatApi.sendTeamChatMessage).not.toHaveBeenCalled();
  });

  it('preserves the exact unsent draft when sending fails', async () => {
    vi.mocked(chatApi.sendTeamChatMessage).mockRejectedValue(
      new chatApi.ChatApiError(500, 'SERVER_ERROR', undefined, undefined, 'Send failed.')
    );
    renderAndOpen();
    const composer = await screen.findByLabelText(/^message$/i);
    const exactDraft = '  Keep my spacing and retry  ';
    fireEvent.change(composer, { target: { value: exactDraft } });
    fireEvent.submit(screen.getByTestId('team-chat-composer'));

    expect(await screen.findByText('Send failed.')).toBeInTheDocument();
    expect(composer).toHaveValue(exactDraft);
  });

  it('shows a content-free access-denied state and no private messages', async () => {
    vi.mocked(chatApi.openTeamChat).mockRejectedValue(
      new chatApi.ChatApiError(
        403,
        'FORBIDDEN_NOT_TEAM_MEMBER',
        undefined,
        undefined,
        'Only confirmed team members can use this team channel.'
      )
    );
    vi.mocked(chatApi.listTeamChatMessages).mockRejectedValue(
      new chatApi.ChatApiError(403, 'FORBIDDEN_NOT_TEAM_MEMBER')
    );
    renderAndOpen();

    expect(await screen.findByTestId('team-chat-access-denied')).toHaveTextContent(
      /active, confirmed members/i
    );
    expect(screen.queryByText('Private launch plan')).not.toBeInTheDocument();
    expect(screen.queryByText(channel.title)).not.toBeInTheDocument();
  });

  it('shows a generic load error with a retry action', async () => {
    vi.mocked(chatApi.openTeamChat).mockRejectedValue(new Error('Network unavailable'));
    vi.mocked(chatApi.listTeamChatMessages).mockRejectedValue(new Error('Network unavailable'));
    renderAndOpen();

    const error = await screen.findByTestId('team-chat-load-error');
    expect(error).toHaveTextContent(/could not load team chat/i);
    expect(error).toHaveTextContent(/network unavailable/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('keeps the draft when the lifecycle API marks the channel read-only', async () => {
    vi.mocked(chatApi.sendTeamChatMessage).mockRejectedValue(
      new chatApi.ChatApiError(
        403,
        'TEAM_CHANNEL_READ_ONLY',
        undefined,
        undefined,
        'This team channel is read-only.'
      )
    );
    renderAndOpen();
    const composer = await screen.findByLabelText(/^message$/i);
    fireEvent.change(composer, { target: { value: 'Retain this lifecycle draft' } });
    fireEvent.submit(screen.getByTestId('team-chat-composer'));

    expect(await screen.findByText(/team channel is read-only/i)).toBeInTheDocument();
    expect(composer).toHaveValue('Retain this lifecycle draft');
    expect(screen.queryByTestId('team-chat-access-denied')).not.toBeInTheDocument();
  });
});

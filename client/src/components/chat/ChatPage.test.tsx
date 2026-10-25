import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ChatPage } from './ChatPage';
import * as chatApi from './chatApi';

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
});

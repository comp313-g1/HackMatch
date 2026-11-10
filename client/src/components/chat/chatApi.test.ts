import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthRequiredError } from '../../config/authFetch';
import {
  ChatApiError,
  createChatChannel,
  fetchMyPresence,
  getDirectMessageThread,
  listDirectMessageThreads,
  listChatChannels,
  listTeamChatMessages,
  openTeamChat,
  sendChatMessage,
  sendDirectMessage,
  sendTeamChatMessage,
  updateMyPresence,
} from './chatApi';

vi.mock('../../config/authFetch', async () => {
  const actual = await vi.importActual<typeof import('../../config/authFetch')>(
    '../../config/authFetch'
  );
  return {
    ...actual,
    authFetch: vi.fn(),
  };
});

import { authFetch } from '../../config/authFetch';

describe('chatApi (US-030 / #346)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches presence status', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          presence: { presenceStatus: 'Online', updatedAt: '2026-10-21T12:00:00.000Z' },
        }),
        { status: 200 }
      )
    );

    const presence = await fetchMyPresence();
    expect(presence.presenceStatus).toBe('Online');
    expect(authFetch).toHaveBeenCalledWith('/api/presence/me', { method: 'GET' });
  });

  it('updates presence status', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          presence: { presenceStatus: 'Idle', updatedAt: '2026-10-21T12:01:00.000Z' },
        }),
        { status: 200 }
      )
    );

    const presence = await updateMyPresence('Idle');
    expect(presence.presenceStatus).toBe('Idle');
  });

  it('lists channels and creates a channel', async () => {
    vi.mocked(authFetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', channels: [] }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'ok',
            channel: {
              id: '11111111-1111-4111-8111-111111111111',
              title: 'General',
              description: 'Forum',
              createdBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              createdAt: '2026-10-21T12:00:00.000Z',
              updatedAt: '2026-10-21T12:00:00.000Z',
            },
          }),
          { status: 201 }
        )
      );

    expect(await listChatChannels()).toEqual([]);
    const created = await createChatChannel({
      title: 'General',
      description: 'Forum',
    });
    expect(created.title).toBe('General');
  });

  it('echoes submitted draft on validation failure', async () => {
    const submitted = { title: '  ', description: 'x' };
    vi.mocked(authFetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Validation failed.',
          code: 'VALIDATION_ERROR',
          errors: { title: 'title is required.' },
          submitted,
        }),
        { status: 400 }
      )
    );

    await expect(
      createChatChannel({ title: '  ', description: 'x' })
    ).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      submitted,
    });
  });

  it('sends a message and rethrows AuthRequiredError', async () => {
    vi.mocked(authFetch).mockRejectedValue(new AuthRequiredError());
    await expect(
      sendChatMessage('11111111-1111-4111-8111-111111111111', { body: 'hi' })
    ).rejects.toBeInstanceOf(AuthRequiredError);

    vi.mocked(authFetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          message: {
            id: '22222222-2222-4222-8222-222222222222',
            channelId: '11111111-1111-4111-8111-111111111111',
            authorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            authorHandle: 'hacker1',
            body: 'hi',
            createdAt: '2026-10-21T12:05:00.000Z',
          },
        }),
        { status: 201 }
      )
    );

    const message = await sendChatMessage(
      '11111111-1111-4111-8111-111111111111',
      { body: 'hi' }
    );
    expect(message.body).toBe('hi');
    expect(ChatApiError).toBeTruthy();
  });

  it('uses the member-gated team channel and message endpoints', async () => {
    const teamId = '22222222-2222-4222-8222-222222222222';
    const channel = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Team channel',
      description: 'Private',
      createdBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      channelType: 'team' as const,
      teamId,
      createdAt: '2026-11-09T18:00:00.000Z',
      updatedAt: '2026-11-09T18:00:00.000Z',
    };
    const message = {
      id: '33333333-3333-4333-8333-333333333333',
      channelId: channel.id,
      authorId: channel.createdBy,
      authorHandle: 'avery',
      body: 'hello team',
      createdAt: '2026-11-09T18:01:00.000Z',
    };
    vi.mocked(authFetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', channel }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', messages: [message] }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', message }), { status: 201 })
      );

    await expect(openTeamChat(teamId)).resolves.toEqual(channel);
    await expect(listTeamChatMessages(teamId)).resolves.toEqual([message]);
    await expect(sendTeamChatMessage(teamId, { body: 'hello team' })).resolves.toEqual(
      message
    );

    expect(authFetch).toHaveBeenNthCalledWith(
      1,
      `/api/teams/${teamId}/chat`,
      { method: 'GET' }
    );
    expect(authFetch).toHaveBeenNthCalledWith(
      2,
      `/api/teams/${teamId}/chat/messages`,
      { method: 'GET' }
    );
    expect(authFetch).toHaveBeenNthCalledWith(
      3,
      `/api/teams/${teamId}/chat/messages`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ body: 'hello team' }),
      })
    );
  });

  it('rejects malformed private team-chat payloads safely', async () => {
    const teamId = '22222222-2222-4222-8222-222222222222';
    vi.mocked(authFetch).mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok', channel: null }), { status: 200 })
    );

    await expect(openTeamChat(teamId)).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_RESPONSE',
    });
  });

  it('uses the DM inbox and thread-detail endpoints', async () => {
    const threadId = '11111111-1111-4111-8111-111111111111';
    const thread = {
      id: threadId,
      peer: { id: '22222222-2222-4222-8222-222222222222', handle: 'blake' },
      createdAt: '2026-11-09T20:00:00.000Z',
      updatedAt: '2026-11-09T20:00:00.000Z',
    };
    vi.mocked(authFetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', threads: [thread], isEmpty: false }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ status: 'ok', thread, messages: [], isEmpty: true }),
          { status: 200 }
        )
      );

    await expect(listDirectMessageThreads()).resolves.toEqual([thread]);
    await expect(getDirectMessageThread(threadId)).resolves.toMatchObject({
      thread,
      messages: [],
      isEmpty: true,
    });
    expect(authFetch).toHaveBeenNthCalledWith(1, '/api/direct-messages/threads', {
      method: 'GET',
    });
    expect(authFetch).toHaveBeenNthCalledWith(
      2,
      `/api/direct-messages/threads/${threadId}`,
      { method: 'GET' }
    );
  });

  it('sends a DM using the exact draft and preserves it on validation error', async () => {
    const threadId = '11111111-1111-4111-8111-111111111111';
    const draft = { body: '  exact draft  ' };
    vi.mocked(authFetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Validation failed.',
          code: 'VALIDATION_ERROR',
          errors: { body: 'body is required.' },
          submitted: draft,
        }),
        { status: 400 }
      )
    );

    await expect(sendDirectMessage(threadId, draft)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      submitted: draft,
    });
    expect(authFetch).toHaveBeenCalledWith(
      `/api/direct-messages/threads/${threadId}/messages`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify(draft) })
    );
  });
});

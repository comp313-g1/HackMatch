import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthRequiredError } from '../../config/authFetch';
import {
  ChatApiError,
  createChatChannel,
  fetchMyPresence,
  listChatChannels,
  sendChatMessage,
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
});

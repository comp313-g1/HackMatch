import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatRepository } from './chat.repository.js';
import { getSupabaseClient } from './client.js';

vi.mock('./client.js', () => ({
  getSupabaseClient: vi.fn(),
}));

describe('chatRepository (US-030 / #342)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a channel with title, description, and created_by', async () => {
    const inserted = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'General',
      description: 'Open forum for all verified participants',
      created_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      created_at: '2026-10-21T12:00:00.000Z',
      updated_at: '2026-10-21T12:00:00.000Z',
    };

    const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    vi.mocked(getSupabaseClient).mockReturnValue({
      from: vi.fn(() => ({ insert })),
    } as never);

    const result = await chatRepository.createChannel({
      title: inserted.title,
      description: inserted.description,
      created_by: inserted.created_by,
    });

    expect(insert).toHaveBeenCalledWith({
      title: inserted.title,
      description: inserted.description,
      created_by: inserted.created_by,
    });
    expect(result.id).toBe(inserted.id);
    expect(result.title).toBe('General');
  });

  it('lists channels newest-first with a limit', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const order = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);

    const result = await chatRepository.listChannelsNewestFirst({ limit: 25 });

    expect(from).toHaveBeenCalledWith('chat_channels');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(25);
    expect(result).toEqual([]);
  });

  it('creates a message with channel_id, author_id, and body', async () => {
    const inserted = {
      id: '22222222-2222-4222-8222-222222222222',
      channel_id: '11111111-1111-4111-8111-111111111111',
      author_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      body: 'Hello team',
      created_at: '2026-10-21T12:05:00.000Z',
    };

    const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    vi.mocked(getSupabaseClient).mockReturnValue({
      from: vi.fn(() => ({ insert })),
    } as never);

    const result = await chatRepository.createMessage({
      channel_id: inserted.channel_id,
      author_id: inserted.author_id,
      body: inserted.body,
    });

    expect(insert).toHaveBeenCalledWith({
      channel_id: inserted.channel_id,
      author_id: inserted.author_id,
      body: inserted.body,
    });
    expect(result.body).toBe('Hello team');
  });

  it('lists messages for a channel in ascending created_at order', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);

    const channelId = '11111111-1111-4111-8111-111111111111';
    const result = await chatRepository.listMessagesByChannel(channelId, {
      limit: 50,
    });

    expect(from).toHaveBeenCalledWith('chat_messages');
    expect(eq).toHaveBeenCalledWith('channel_id', channelId);
    expect(order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(limit).toHaveBeenCalledWith(50);
    expect(result).toEqual([]);
  });
});

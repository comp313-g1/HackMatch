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
      channel_type: 'public',
      team_id: null,
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
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);

    const result = await chatRepository.listChannelsNewestFirst({ limit: 25 });

    expect(from).toHaveBeenCalledWith('chat_channels');
    // US-031 / #378: the public list never includes private team channels.
    expect(eq).toHaveBeenCalledWith('channel_type', 'public');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(25);
    expect(result).toEqual([]);
  });

  it('creates a public channel without sending any team linkage (US-030 behavior unchanged)', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'x' }, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    vi.mocked(getSupabaseClient).mockReturnValue({ from: vi.fn(() => ({ insert })) } as never);

    await chatRepository.createChannel({ title: 'T', description: 'D', created_by: 'a' });

    const payload = (insert.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['created_by', 'description', 'title']);
    expect(payload).not.toHaveProperty('channel_type');
    expect(payload).not.toHaveProperty('team_id');
  });

  describe('findChannelByTeamId (US-031 / #378)', () => {
    const TEAM = '123e4567-e89b-42d3-a456-426614174000';

    it('looks a team channel up by team_id', async () => {
      const row = { id: 'c1', channel_type: 'team', team_id: TEAM };
      const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
      const eq = vi.fn(() => ({ maybeSingle }));
      const select = vi.fn(() => ({ eq }));
      const from = vi.fn(() => ({ select }));
      vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);

      const result = await chatRepository.findChannelByTeamId(TEAM);

      expect(from).toHaveBeenCalledWith('chat_channels');
      expect(eq).toHaveBeenCalledWith('team_id', TEAM);
      expect(result).toEqual(row);
    });

    it('returns null for a team that has no channel', async () => {
      const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      vi.mocked(getSupabaseClient).mockReturnValue({
        from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })),
      } as never);
      await expect(chatRepository.findChannelByTeamId(TEAM)).resolves.toBeNull();
    });

    it('surfaces a database error instead of hiding it as "no channel"', async () => {
      const failure = { message: 'connection lost' };
      const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: failure });
      vi.mocked(getSupabaseClient).mockReturnValue({
        from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })),
      } as never);
      await expect(chatRepository.findChannelByTeamId(TEAM)).rejects.toBe(failure);
    });
  });

  describe('provisionOrLinkTeamChannel (US-031 / #378 / T2)', () => {
    const TEAM = '123e4567-e89b-42d3-a456-426614174000';
    const DTO = {
      team_id: TEAM,
      title: 'Team: Alpha',
      description: 'Private team coordination channel',
      created_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    };

    it('returns existing channel without inserting when one is already provisioned', async () => {
      const existing = { id: 'c1', channel_type: 'team' as const, ...DTO };
      const findSpy = vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(existing as never);
      const insert = vi.fn();
      vi.mocked(getSupabaseClient).mockReturnValue({
        from: vi.fn(() => ({ insert })),
      } as never);

      const result = await chatRepository.provisionOrLinkTeamChannel(DTO);

      expect(findSpy).toHaveBeenCalledWith(TEAM);
      expect(insert).not.toHaveBeenCalled();
      expect(result).toEqual({ channel: existing, created: false });
    });

    it('inserts a new team channel when none exists yet', async () => {
      vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(null);
      const createdRow = { id: 'c2', channel_type: 'team', ...DTO };
      const single = vi.fn().mockResolvedValue({ data: createdRow, error: null });
      const select = vi.fn(() => ({ single }));
      const insert = vi.fn(() => ({ select }));
      const from = vi.fn(() => ({ insert }));
      vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);

      const result = await chatRepository.provisionOrLinkTeamChannel(DTO);

      expect(from).toHaveBeenCalledWith('chat_channels');
      expect(insert).toHaveBeenCalledWith({
        channel_type: 'team',
        team_id: DTO.team_id,
        title: DTO.title,
        description: DTO.description,
        created_by: DTO.created_by,
      });
      expect(result).toEqual({ channel: createdRow, created: true });
    });

    it('recovers from concurrent race 23505 unique violation by returning existing channel', async () => {
      const winnerRow = { id: 'c3', channel_type: 'team', ...DTO };
      // First call (check) -> null; Second call (after race conflict) -> winnerRow
      vi.spyOn(chatRepository, 'findChannelByTeamId')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winnerRow as never);

      const conflictError = { code: '23505', message: 'duplicate key value violates unique constraint "uq_chat_channels_team_id"' };
      const single = vi.fn().mockResolvedValue({ data: null, error: conflictError });
      const select = vi.fn(() => ({ single }));
      const insert = vi.fn(() => ({ select }));
      vi.mocked(getSupabaseClient).mockReturnValue({
        from: vi.fn(() => ({ insert })),
      } as never);

      const result = await chatRepository.provisionOrLinkTeamChannel(DTO);

      expect(result).toEqual({ channel: winnerRow, created: false });
    });

    it('throws unexpected database error during insert', async () => {
      vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(null);
      const fatalError = { code: '42P01', message: 'relation does not exist' };
      const single = vi.fn().mockResolvedValue({ data: null, error: fatalError });
      const select = vi.fn(() => ({ single }));
      const insert = vi.fn(() => ({ select }));
      vi.mocked(getSupabaseClient).mockReturnValue({
        from: vi.fn(() => ({ insert })),
      } as never);

      await expect(chatRepository.provisionOrLinkTeamChannel(DTO)).rejects.toBe(fatalError);
    });
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

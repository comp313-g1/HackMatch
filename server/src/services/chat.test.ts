import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatRepository } from '../db/chat.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import {
  ChatServiceError,
  createChannel,
  listChannelMessages,
  listChannels,
  sendChannelMessage,
  toChannelView,
} from './chat.js';

describe('chat service (US-030 / #344)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maps channel rows to safe views without email', () => {
    const view = toChannelView({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'General',
      description: 'Forum',
      created_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      channel_type: 'public',
      team_id: null,
      created_at: '2026-10-21T12:00:00.000Z',
      updated_at: '2026-10-21T12:00:00.000Z',
    });
    expect(view.createdBy).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(view).not.toHaveProperty('email');
  });

  it('lists channels newest-first via repository', async () => {
    vi.spyOn(chatRepository, 'listChannelsNewestFirst').mockResolvedValue([]);
    await expect(listChannels()).resolves.toEqual([]);
  });

  it('creates a channel for the actor', async () => {
    vi.spyOn(chatRepository, 'createChannel').mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'General',
      description: 'Forum',
      created_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      channel_type: 'public',
      team_id: null,
      created_at: '2026-10-21T12:00:00.000Z',
      updated_at: '2026-10-21T12:00:00.000Z',
    });

    const channel = await createChannel({
      title: 'General',
      description: 'Forum',
      createdBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });

    expect(channel.title).toBe('General');
    expect(chatRepository.createChannel).toHaveBeenCalledWith({
      title: 'General',
      description: 'Forum',
      created_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
  });

  it('lists messages with author handles and no email', async () => {
    const channelId = '11111111-1111-4111-8111-111111111111';
    const authorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue({
      id: channelId,
      title: 'General',
      description: 'Forum',
      created_by: authorId,
      channel_type: 'public',
      team_id: null,
      created_at: '2026-10-21T12:00:00.000Z',
      updated_at: '2026-10-21T12:00:00.000Z',
    });
    vi.spyOn(chatRepository, 'listMessagesByChannel').mockResolvedValue([
      {
        id: '22222222-2222-4222-8222-222222222222',
        channel_id: channelId,
        author_id: authorId,
        body: 'Hello',
        created_at: '2026-10-21T12:05:00.000Z',
      },
    ]);
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
      participant_id: authorId,
      handle: 'hacker1',
      primary_role: null,
      institution: null,
      shared_contact_handle: null,
      created_at: '2026-10-21T00:00:00.000Z',
      updated_at: '2026-10-21T00:00:00.000Z',
    } as never);

    const messages = await listChannelMessages(channelId);
    expect(messages[0].authorHandle).toBe('hacker1');
    expect(messages[0]).not.toHaveProperty('email');
  });

  it('throws CHANNEL_NOT_FOUND when sending to a missing channel', async () => {
    vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue(null);

    await expect(
      sendChannelMessage({
        channelId: '11111111-1111-4111-8111-111111111111',
        authorId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        body: 'hi',
      })
    ).rejects.toMatchObject({
      status: 404,
      code: 'CHANNEL_NOT_FOUND',
    });
    expect(ChatServiceError).toBeTruthy();
  });

  describe('private team channels are invisible to the public chat endpoints (US-031 / #378)', () => {
    const channelRow = (over: Record<string, unknown> = {}) => ({
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Team chat',
      description: 'Private',
      created_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      channel_type: 'team' as const,
      team_id: '123e4567-e89b-42d3-a456-426614174000',
      created_at: '2026-10-21T12:00:00.000Z',
      updated_at: '2026-10-21T12:00:00.000Z',
      ...over,
    });

    it('listing messages of a team channel is a 404 identical to an unknown channel, and reads nothing', async () => {
      vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue(channelRow());
      const messages = vi.spyOn(chatRepository, 'listMessagesByChannel').mockResolvedValue([]);

      const err = await listChannelMessages('33333333-3333-4333-8333-333333333333').catch((e) => e);

      expect(err).toBeInstanceOf(ChatServiceError);
      expect(err).toMatchObject({ status: 404, code: 'CHANNEL_NOT_FOUND', message: 'Chat channel not found.' });
      expect(messages).not.toHaveBeenCalled();

      vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue(null);
      const unknown = await listChannelMessages('44444444-4444-4444-8444-444444444444').catch((e) => e);
      expect({ status: err.status, code: err.code, message: err.message }).toEqual({
        status: unknown.status,
        code: unknown.code,
        message: unknown.message,
      });
    });

    it('sending to a team channel through the public path is refused and stores nothing', async () => {
      vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue(channelRow());
      const create = vi.spyOn(chatRepository, 'createMessage').mockResolvedValue({} as never);

      await expect(
        sendChannelMessage({ channelId: '33333333-3333-4333-8333-333333333333', authorId: 'a', body: 'leak?' })
      ).rejects.toMatchObject({ status: 404, code: 'CHANNEL_NOT_FOUND' });
      expect(create).not.toHaveBeenCalled();
    });

    it('fails closed for a row that does not say it is public', async () => {
      vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue(channelRow({ channel_type: undefined, team_id: null }));
      const messages = vi.spyOn(chatRepository, 'listMessagesByChannel').mockResolvedValue([]);
      await expect(listChannelMessages('33333333-3333-4333-8333-333333333333')).rejects.toMatchObject({ status: 404 });
      expect(messages).not.toHaveBeenCalled();
    });

    it('a public channel is still served exactly as before', async () => {
      vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue(channelRow({ channel_type: 'public', team_id: null }));
      vi.spyOn(chatRepository, 'listMessagesByChannel').mockResolvedValue([]);
      await expect(listChannelMessages('33333333-3333-4333-8333-333333333333')).resolves.toEqual([]);
    });

    it('the public channel list asks the repository once, for public channels only', async () => {
      const list = vi.spyOn(chatRepository, 'listChannelsNewestFirst').mockResolvedValue([]);
      await listChannels();
      expect(list).toHaveBeenCalledTimes(1);
    });
  });
});

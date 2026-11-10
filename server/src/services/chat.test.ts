import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatRepository } from '../db/chat.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import {
  ChatServiceError,
  createChannel,
  listChannelMessages,
  listChannels,
  listTeamChannelMessages,
  openTeamChannel,
  provisionOrLinkTeamChannel,
  sendChannelMessage,
  sendTeamChannelMessage,
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

  describe('provisionOrLinkTeamChannel (US-031 / #378 / T2)', () => {
    const TEAM_ID = '123e4567-e89b-42d3-a456-426614174000';
    const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const ACTOR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    const mockTeam = (overrides: Record<string, unknown> = {}) => ({
      id: TEAM_ID,
      event_id: '22222222-2222-4222-8222-222222222222',
      owner_participant_id: OWNER_ID,
      name: 'Alpha Squad',
      pitch: 'Pitch',
      goal: 'Project' as const,
      commitment_hours: 10,
      communication_link: null,
      recruitment_status: 'Open' as const,
      locked_at: null,
      disbanded_at: null,
      ...overrides,
    });

    const mockChannel = (overrides: Record<string, unknown> = {}) => ({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      title: 'Team: Alpha Squad',
      description: `Private team coordination channel for "Alpha Squad" (${TEAM_ID}).`,
      created_by: OWNER_ID,
      channel_type: 'team' as const,
      team_id: TEAM_ID,
      created_at: '2026-11-09T20:00:00.000Z',
      updated_at: '2026-11-09T20:00:00.000Z',
      ...overrides,
    });

    it('rejects with 400 VALIDATION_ERROR when teamId is empty or whitespace', async () => {
      await expect(provisionOrLinkTeamChannel({ teamId: '' })).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
      });
      await expect(provisionOrLinkTeamChannel({ teamId: '   ' })).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    });

    it('rejects with 404 TEAM_NOT_FOUND when team does not exist', async () => {
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(null);

      await expect(provisionOrLinkTeamChannel({ teamId: TEAM_ID })).rejects.toMatchObject({
        status: 404,
        code: 'TEAM_NOT_FOUND',
      });
    });

    it('returns existing channel with created: false when already provisioned', async () => {
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(mockTeam() as never);
      vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(mockChannel());
      const provisionSpy = vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel');

      const result = await provisionOrLinkTeamChannel({ teamId: TEAM_ID });

      expect(provisionSpy).not.toHaveBeenCalled();
      expect(result.created).toBe(false);
      expect(result.teamId).toBe(TEAM_ID);
      expect(result.channel.title).toBe('Team: Alpha Squad');
      expect(result.channel.channelType).toBe('team');
      expect(result.channel.teamId).toBe(TEAM_ID);
    });

    it('preserves historical linkage for a disbanded team if channel already exists', async () => {
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(
        mockTeam({ recruitment_status: 'Disbanded', disbanded_at: '2026-11-09T18:00:00.000Z' }) as never
      );
      vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(mockChannel());

      const result = await provisionOrLinkTeamChannel({ teamId: TEAM_ID });

      expect(result.created).toBe(false);
      expect(result.teamId).toBe(TEAM_ID);
      expect(result.channel.id).toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    });

    it('rejects with 403 TEAM_CHAT_TEAM_DISBANDED when attempting to provision for a disbanded team without an existing channel', async () => {
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(
        mockTeam({ recruitment_status: 'Disbanded', disbanded_at: '2026-11-09T18:00:00.000Z' }) as never
      );
      vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(null);

      await expect(provisionOrLinkTeamChannel({ teamId: TEAM_ID })).rejects.toMatchObject({
        status: 403,
        code: 'TEAM_CHAT_TEAM_DISBANDED',
      });
    });

    it('provisions a new team channel with default owner creator when actorId is not provided', async () => {
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(mockTeam() as never);
      vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(null);
      vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel').mockResolvedValue({
        channel: mockChannel(),
        created: true,
      });

      const result = await provisionOrLinkTeamChannel({ teamId: TEAM_ID });

      expect(chatRepository.provisionOrLinkTeamChannel).toHaveBeenCalledWith({
        team_id: TEAM_ID,
        title: 'Team: Alpha Squad',
        description: `Private team coordination channel for "Alpha Squad" (${TEAM_ID}).`,
        created_by: OWNER_ID,
      });
      expect(result.created).toBe(true);
      expect(result.teamId).toBe(TEAM_ID);
      expect(result.channel.channelType).toBe('team');
    });

    it('provisions a new team channel using actorId when provided', async () => {
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(mockTeam() as never);
      vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(null);
      vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel').mockResolvedValue({
        channel: mockChannel({ created_by: ACTOR_ID }),
        created: true,
      });

      const result = await provisionOrLinkTeamChannel({ teamId: TEAM_ID, actorId: ACTOR_ID });

      expect(chatRepository.provisionOrLinkTeamChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          team_id: TEAM_ID,
          created_by: ACTOR_ID,
        })
      );
      expect(result.created).toBe(true);
      expect(result.channel.createdBy).toBe(ACTOR_ID);
    });
  });

  describe('openTeamChannel, listTeamChannelMessages, and sendTeamChannelMessage (US-031 / #381 / #384)', () => {
    const TEAM_ID = '123e4567-e89b-42d3-a456-426614174000';
    const OTHER_TEAM_ID = '99999999-9999-4999-8999-999999999999';
    const CHANNEL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const MEMBER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    const teamChannelRow = (overrides: Record<string, unknown> = {}) => ({
      id: CHANNEL_ID,
      title: 'Team: Alpha Squad',
      description: 'Private team coordination channel',
      created_by: MEMBER_ID,
      channel_type: 'team' as const,
      team_id: TEAM_ID,
      created_at: '2026-11-09T20:00:00.000Z',
      updated_at: '2026-11-09T20:00:00.000Z',
      ...overrides,
    });

    it('opens a valid team channel and scrubs any leaked sensitive fields', async () => {
      vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(
        teamChannelRow({
          email: 'leak@example.com',
          password: 'secret',
          otp_hash: 'otp123',
        }) as never
      );

      const view = await openTeamChannel(TEAM_ID);

      expect(view).toMatchObject({
        id: CHANNEL_ID,
        title: 'Team: Alpha Squad',
        channelType: 'team',
        teamId: TEAM_ID,
      });
      expect(view).not.toHaveProperty('email');
      expect(view).not.toHaveProperty('password');
      expect(view).not.toHaveProperty('otp_hash');
    });

    it.each([
      ['blank teamId', '   ', null],
      ['missing channel', TEAM_ID, null],
      ['mismatched team_id', TEAM_ID, teamChannelRow({ team_id: OTHER_TEAM_ID })],
      ['public channel_type', TEAM_ID, teamChannelRow({ channel_type: 'public' })],
    ])('fails closed with 404 TEAM_CHANNEL_NOT_FOUND for %s', async (_label, teamId, row) => {
      vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(row as never);

      await expect(openTeamChannel(teamId)).rejects.toMatchObject({
        status: 404,
        code: 'TEAM_CHANNEL_NOT_FOUND',
      });
      await expect(listTeamChannelMessages(teamId)).rejects.toMatchObject({
        status: 404,
        code: 'TEAM_CHANNEL_NOT_FOUND',
      });
      await expect(
        sendTeamChannelMessage({ teamId, authorId: MEMBER_ID, body: 'hi' })
      ).rejects.toMatchObject({
        status: 404,
        code: 'TEAM_CHANNEL_NOT_FOUND',
      });
    });

    it('lists team channel messages with author handles only and scrubs private fields', async () => {
      vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(teamChannelRow());
      vi.spyOn(chatRepository, 'listMessagesByChannel').mockResolvedValue([
        {
          id: 'm1',
          channel_id: CHANNEL_ID,
          author_id: MEMBER_ID,
          body: 'Private standup update',
          created_at: '2026-11-09T20:05:00.000Z',
          email: 'leak@example.com',
          firebase_uid: 'fb-secret',
        } as never,
      ]);
      vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
        participant_id: MEMBER_ID,
        handle: 'alpha_lead',
      } as never);

      const messages = await listTeamChannelMessages(TEAM_ID);

      expect(messages).toEqual([
        {
          id: 'm1',
          channelId: CHANNEL_ID,
          authorId: MEMBER_ID,
          authorHandle: 'alpha_lead',
          body: 'Private standup update',
          createdAt: '2026-11-09T20:05:00.000Z',
        },
      ]);
      expect(JSON.stringify(messages)).not.toMatch(/leak@example\.com|fb-secret/);
    });

    it('sends a team channel message and resolves null handle when profile is missing', async () => {
      vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(teamChannelRow());
      vi.spyOn(chatRepository, 'createMessage').mockResolvedValue({
        id: 'm2',
        channel_id: CHANNEL_ID,
        author_id: MEMBER_ID,
        body: 'Ready for demo',
        created_at: '2026-11-09T20:10:00.000Z',
      });
      vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue(null);

      const sent = await sendTeamChannelMessage({
        teamId: TEAM_ID,
        authorId: MEMBER_ID,
        body: 'Ready for demo',
      });

      expect(sent).toEqual({
        id: 'm2',
        channelId: CHANNEL_ID,
        authorId: MEMBER_ID,
        authorHandle: null,
        body: 'Ready for demo',
        createdAt: '2026-11-09T20:10:00.000Z',
      });
    });
  });
});

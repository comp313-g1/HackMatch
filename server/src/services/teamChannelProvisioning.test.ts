/**
 * #431 — team chat channels are created for every team: on first open (existing teams and any
 * team whose creation-time step failed) and by the backfill command.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatRepository } from '../db/chat.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { getSupabaseClient } from '../db/client.js';
import {
  backfillTeamChannels,
  listTeamChannelMessages,
  openTeamChannel,
  sendTeamChannelMessage,
} from './chat.js';

vi.mock('../db/client.js', () => ({ getSupabaseClient: vi.fn() }));

const TEAM_ID = '123e4567-e89b-42d3-a456-426614174000';
const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHANNEL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const team = (over: Record<string, unknown> = {}) =>
  ({
    id: TEAM_ID,
    name: 'Alpha Squad',
    owner_participant_id: OWNER_ID,
    recruitment_status: 'Open',
    disbanded_at: null,
    ...over,
  }) as never;

const channelRow = (over: Record<string, unknown> = {}) =>
  ({
    id: CHANNEL_ID,
    title: 'Team: Alpha Squad',
    description: 'Private team coordination channel',
    created_by: OWNER_ID,
    channel_type: 'team',
    team_id: TEAM_ID,
    created_at: '2026-11-10T10:00:00.000Z',
    updated_at: '2026-11-10T10:00:00.000Z',
    ...over,
  }) as never;

describe('on-demand team channel provisioning (#431)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /** findChannelByTeamId: empty until provisioning has run, then the channel. */
  function channelAppearsAfterProvisioning() {
    let provisioned = false;
    vi.spyOn(chatRepository, 'findChannelByTeamId').mockImplementation(async () => (provisioned ? channelRow() : null));
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(team());
    return vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel').mockImplementation(async () => {
      provisioned = true;
      return { channel: channelRow(), created: true };
    });
  }

  it('opening the chat of a team without a channel creates it and returns it', async () => {
    const provision = channelAppearsAfterProvisioning();
    const view = await openTeamChannel(TEAM_ID);
    expect(view).toMatchObject({ id: CHANNEL_ID, channelType: 'team', teamId: TEAM_ID });
    expect(provision).toHaveBeenCalledTimes(1);
    expect(provision).toHaveBeenCalledWith({
      team_id: TEAM_ID,
      title: 'Team: Alpha Squad',
      description: expect.any(String),
      created_by: OWNER_ID,
    });
  });

  it('listing messages of a team without a channel creates it and shows an empty chat', async () => {
    channelAppearsAfterProvisioning();
    vi.spyOn(chatRepository, 'listMessagesByChannel').mockResolvedValue([]);
    await expect(listTeamChannelMessages(TEAM_ID)).resolves.toEqual([]);
  });

  it('sending the first message to a team without a channel creates it and stores the message in it', async () => {
    channelAppearsAfterProvisioning();
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({ handle: 'owner' } as never);
    const createMessage = vi.spyOn(chatRepository, 'createMessage').mockResolvedValue({
      id: 'm1',
      channel_id: CHANNEL_ID,
      author_id: OWNER_ID,
      body: 'hello',
      created_at: '2026-11-10T10:01:00.000Z',
    } as never);
    await sendTeamChannelMessage({ teamId: TEAM_ID, authorId: OWNER_ID, body: 'hello' });
    expect(createMessage).toHaveBeenCalledWith({ channel_id: CHANNEL_ID, author_id: OWNER_ID, body: 'hello' });
  });

  it('does not provision when the channel already exists', async () => {
    vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(channelRow());
    const provision = vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel');
    await openTeamChannel(TEAM_ID);
    expect(provision).not.toHaveBeenCalled();
  });

  it('two simultaneous first opens end up with the same single channel', async () => {
    let provisioned = false;
    vi.spyOn(chatRepository, 'findChannelByTeamId').mockImplementation(async () => (provisioned ? channelRow() : null));
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(team());
    const outcomes: string[] = [];
    vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel').mockImplementation(async () => {
      // The repository resolves a lost race to the existing row (unique violation), so only the
      // first caller reports created: true; both get the same channel id.
      const first = !provisioned;
      provisioned = true;
      outcomes.push(first ? 'created' : 'linked');
      return { channel: channelRow(), created: first };
    });

    const [a, b] = await Promise.all([openTeamChannel(TEAM_ID), openTeamChannel(TEAM_ID)]);

    expect(a.id).toBe(b.id);
    expect(outcomes.filter((o) => o === 'created')).toHaveLength(1);
  });

  it.each([
    ['a team that does not exist', null],
    [
      'a disbanded team without a channel',
      team({ recruitment_status: 'Disbanded', disbanded_at: '2026-11-01T00:00:00.000Z' }),
    ],
  ])('reports 404 TEAM_CHANNEL_NOT_FOUND for %s and creates nothing', async (_label, found) => {
    vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(null);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(found as never);
    const provision = vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel');
    await expect(openTeamChannel(TEAM_ID)).rejects.toMatchObject({ status: 404, code: 'TEAM_CHANNEL_NOT_FOUND' });
    expect(provision).not.toHaveBeenCalled();
  });

  it('a blank team id never reaches the database', async () => {
    const find = vi.spyOn(chatRepository, 'findChannelByTeamId');
    await expect(openTeamChannel('   ')).rejects.toMatchObject({ status: 404, code: 'TEAM_CHANNEL_NOT_FOUND' });
    expect(find).not.toHaveBeenCalled();
  });

  it('other provisioning failures are not hidden as "not found"', async () => {
    vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(null);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(team());
    vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel').mockRejectedValue(new Error('database down'));
    await expect(openTeamChannel(TEAM_ID)).rejects.toThrow('database down');
  });

  it('fails closed when the lookup after provisioning still finds nothing usable', async () => {
    vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(null);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(team());
    vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel').mockResolvedValue({ channel: channelRow(), created: true });
    await expect(openTeamChannel(TEAM_ID)).rejects.toMatchObject({ code: 'TEAM_CHANNEL_NOT_FOUND' });
  });
});

describe('backfillTeamChannels (#431)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const T1 = '11111111-1111-4111-8111-111111111111';
  const T2 = '22222222-2222-4222-8222-222222222222';
  const T3 = '33333333-3333-4333-8333-333333333333';

  it('creates a channel for every team that needs one and counts them', async () => {
    vi.spyOn(chatRepository, 'listTeamIdsNeedingChannel').mockResolvedValue([T1, T2]);
    vi.spyOn(teamsRepository, 'findTeamById').mockImplementation(async (id: string) => team({ id }));
    vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(null);
    const provision = vi
      .spyOn(chatRepository, 'provisionOrLinkTeamChannel')
      .mockImplementation(async (data) => ({ channel: channelRow({ team_id: data.team_id }), created: true }));

    const result = await backfillTeamChannels();

    expect(result).toEqual({ checked: 2, created: 2, alreadyLinked: 0, skipped: 0, failed: [] });
    expect(provision.mock.calls.map((c) => c[0].team_id)).toEqual([T1, T2]);
  });

  it('does nothing when every team already has a channel', async () => {
    vi.spyOn(chatRepository, 'listTeamIdsNeedingChannel').mockResolvedValue([]);
    const provision = vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel');
    expect(await backfillTeamChannels()).toEqual({ checked: 0, created: 0, alreadyLinked: 0, skipped: 0, failed: [] });
    expect(provision).not.toHaveBeenCalled();
  });

  it('counts a channel that appeared meanwhile as already linked, and a disbanded team as skipped', async () => {
    vi.spyOn(chatRepository, 'listTeamIdsNeedingChannel').mockResolvedValue([T1, T2]);
    vi.spyOn(teamsRepository, 'findTeamById').mockImplementation(async (id: string) =>
      id === T2 ? team({ id, recruitment_status: 'Disbanded', disbanded_at: '2026-11-01T00:00:00.000Z' }) : team({ id })
    );
    vi.spyOn(chatRepository, 'findChannelByTeamId').mockImplementation(async (id: string) =>
      id === T1 ? channelRow({ team_id: T1 }) : null
    );
    vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel');

    const result = await backfillTeamChannels();

    expect(result).toEqual({ checked: 2, created: 0, alreadyLinked: 1, skipped: 1, failed: [] });
  });

  it('keeps going after one team fails and reports it', async () => {
    vi.spyOn(chatRepository, 'listTeamIdsNeedingChannel').mockResolvedValue([T1, T2, T3]);
    vi.spyOn(teamsRepository, 'findTeamById').mockImplementation(async (id: string) => team({ id }));
    vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(null);
    vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel').mockImplementation(async (data) => {
      if (data.team_id === T2) throw new Error('constraint failed');
      return { channel: channelRow({ team_id: data.team_id }), created: true };
    });

    const result = await backfillTeamChannels();

    expect(result.created).toBe(2);
    expect(result.failed).toEqual([{ teamId: T2, reason: 'constraint failed' }]);
  });

  it('is safe to run twice: the second run finds nothing left to do', async () => {
    const needing = [T1];
    vi.spyOn(chatRepository, 'listTeamIdsNeedingChannel').mockImplementation(async () => [...needing]);
    vi.spyOn(teamsRepository, 'findTeamById').mockImplementation(async (id: string) => team({ id }));
    vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(null);
    vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel').mockImplementation(async (data) => {
      needing.length = 0;
      return { channel: channelRow({ team_id: data.team_id }), created: true };
    });
    expect((await backfillTeamChannels()).created).toBe(1);
    expect((await backfillTeamChannels()).checked).toBe(0);
  });
});

describe('chatRepository.listTeamIdsNeedingChannel (#431)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /** A chainable fake of the Supabase query builder that records its calls and pages its rows. */
  function fakeClient(tables: Record<string, Array<Record<string, string>>>) {
    const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
    const from = (table: string) => {
      let column = '';
      const builder: Record<string, unknown> = {};
      const chain =
        (method: string) =>
        (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      builder.select = (c: string) => {
        column = c;
        calls.push({ table, method: 'select', args: [c] });
        return builder;
      };
      for (const m of ['is', 'neq', 'not', 'order']) builder[m] = chain(m);
      builder.range = (a: number, b: number) => {
        calls.push({ table, method: 'range', args: [a, b] });
        return Promise.resolve({
          data: tables[table].slice(a, b + 1).map((r) => ({ [column]: r[column] })),
          error: null,
        });
      };
      return builder;
    };
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);
    return calls;
  }

  it('returns active teams that have no linked channel', async () => {
    const calls = fakeClient({
      teams: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      chat_channels: [{ team_id: 'b' }],
    });
    expect(await chatRepository.listTeamIdsNeedingChannel()).toEqual(['a', 'c']);
    // Only non-disbanded teams are considered, and only channels that have a team.
    expect(calls).toContainEqual({ table: 'teams', method: 'is', args: ['disbanded_at', null] });
    expect(calls).toContainEqual({ table: 'teams', method: 'neq', args: ['recruitment_status', 'Disbanded'] });
    expect(calls).toContainEqual({ table: 'chat_channels', method: 'not', args: ['team_id', 'is', null] });
  });

  it('reads past the first page of 1000 rows', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ id: `t${i}` }));
    const calls = fakeClient({ teams: many, chat_channels: [] });
    const result = await chatRepository.listTeamIdsNeedingChannel();
    expect(result).toHaveLength(2500);
    expect(calls.filter((c) => c.table === 'teams' && c.method === 'range').map((c) => c.args)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('returns an empty list when there are no teams', async () => {
    fakeClient({ teams: [], chat_channels: [] });
    expect(await chatRepository.listTeamIdsNeedingChannel()).toEqual([]);
  });

  it('rethrows database errors', async () => {
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'is', 'neq', 'not', 'order']) builder[m] = () => builder;
    builder.range = vi.fn().mockResolvedValue({ data: null, error: new Error('db down') });
    vi.mocked(getSupabaseClient).mockReturnValue({ from: () => builder } as never);
    await expect(chatRepository.listTeamIdsNeedingChannel()).rejects.toThrow('db down');
  });
});

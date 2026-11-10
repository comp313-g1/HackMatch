import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatChannel, Participant } from '../db/types.js';
import {
  TEAM_CHAT_ACCESS_DENIED_MESSAGE,
  TeamChatAuthorizationError,
  authorizeConfirmedTeamChatMember,
  type TeamChatAuthorizationDeps,
} from './teamChatAuthorization.js';

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEAM_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CHANNEL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: ACTOR_ID,
    firebase_uid: 'firebase-participant',
    email: 'private@example.test',
    full_name: 'Private Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    is_deactivated: false,
    created_at: '2026-11-09T12:00:00.000Z',
    updated_at: '2026-11-09T12:00:00.000Z',
    ...overrides,
  };
}

function teamChannel(overrides: Partial<ChatChannel> = {}): ChatChannel {
  return {
    id: CHANNEL_ID,
    title: 'Private Team Plans',
    description: 'Confidential launch discussion',
    created_by: ACTOR_ID,
    channel_type: 'team',
    team_id: TEAM_ID,
    created_at: '2026-11-09T12:00:00.000Z',
    updated_at: '2026-11-09T12:00:00.000Z',
    ...overrides,
  };
}

function dependencies(options: {
  actor?: Participant | null;
  channel?: ChatChannel | null;
  confirmedParticipantIds?: string[];
} = {}): Required<TeamChatAuthorizationDeps> {
  return {
    participantsRepo: {
      findById: vi.fn().mockResolvedValue(
        options.actor === undefined ? participant() : options.actor
      ),
    },
    chatRepo: {
      findChannelById: vi.fn().mockResolvedValue(
        options.channel === undefined ? teamChannel() : options.channel
      ),
    },
    teamsRepo: {
      listConfirmedParticipantIdsForTeam: vi
        .fn()
        .mockResolvedValue(options.confirmedParticipantIds ?? [ACTOR_ID]),
    },
  };
}

async function expectForbidden(
  promise: Promise<unknown>
): Promise<TeamChatAuthorizationError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(TeamChatAuthorizationError);
  expect(error).toMatchObject({
    status: 403,
    code: 'TEAM_CHAT_ACCESS_DENIED',
    message: TEAM_CHAT_ACCESS_DENIED_MESSAGE,
  });
  return error as TeamChatAuthorizationError;
}

describe('confirmed team chat authorization (US-031 / #380)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('allows an active verified PART with Confirmed membership in the persisted channel team', async () => {
    const deps = dependencies();

    await expect(
      authorizeConfirmedTeamChatMember(
        { actorParticipantId: ACTOR_ID, channelId: CHANNEL_ID },
        deps
      )
    ).resolves.toMatchObject({
      participantId: ACTOR_ID,
      teamId: TEAM_ID,
      channel: { id: CHANNEL_ID, team_id: TEAM_ID },
    });

    expect(deps.chatRepo.findChannelById).toHaveBeenCalledWith(CHANNEL_ID);
    expect(deps.teamsRepo.listConfirmedParticipantIdsForTeam).toHaveBeenCalledWith(
      TEAM_ID
    );
  });

  it('denies a participant who is not a member of the target team', async () => {
    const deps = dependencies({ confirmedParticipantIds: [] });

    await expectForbidden(
      authorizeConfirmedTeamChatMember(
        { actorParticipantId: ACTOR_ID, channelId: CHANNEL_ID },
        deps
      )
    );
  });

  it('denies a participant who is confirmed only on an unrelated team', async () => {
    const deps = dependencies({ confirmedParticipantIds: [] });

    await expectForbidden(
      authorizeConfirmedTeamChatMember(
        { actorParticipantId: ACTOR_ID, channelId: CHANNEL_ID },
        deps
      )
    );

    expect(deps.teamsRepo.listConfirmedParticipantIdsForTeam).toHaveBeenCalledOnce();
    expect(deps.teamsRepo.listConfirmedParticipantIdsForTeam).toHaveBeenCalledWith(
      TEAM_ID
    );
  });

  it.each(['Removed', 'Released'])(
    'denies a participant whose target-team membership is %s rather than Confirmed',
    async () => {
      // The repository method returns only canonical Confirmed rows; Removed/Released
      // memberships therefore produce an empty result for this authorization unit.
      const deps = dependencies({ confirmedParticipantIds: [] });

      await expectForbidden(
        authorizeConfirmedTeamChatMember(
          { actorParticipantId: ACTOR_ID, channelId: CHANNEL_ID },
          deps
        )
      );
    }
  );

  it('denies an unrelated ADMIN before resolving private channel metadata', async () => {
    const deps = dependencies({ actor: participant({ role: 'ADMIN' }) });

    await expectForbidden(
      authorizeConfirmedTeamChatMember(
        { actorParticipantId: ACTOR_ID, channelId: CHANNEL_ID },
        deps
      )
    );

    expect(deps.chatRepo.findChannelById).not.toHaveBeenCalled();
    expect(deps.teamsRepo.listConfirmedParticipantIdsForTeam).not.toHaveBeenCalled();
  });

  it.each([
    ['suspended', { is_suspended: true }],
    ['deactivated', { is_deactivated: true }],
  ] as const)('denies a %s participant before resolving the channel', async (_label, state) => {
    const deps = dependencies({ actor: participant(state) });

    await expectForbidden(
      authorizeConfirmedTeamChatMember(
        { actorParticipantId: ACTOR_ID, channelId: CHANNEL_ID },
        deps
      )
    );

    expect(deps.chatRepo.findChannelById).not.toHaveBeenCalled();
  });

  it('uses the persisted channel team and cannot be redirected to another team by the client', async () => {
    const deps = dependencies();

    await authorizeConfirmedTeamChatMember(
      { actorParticipantId: ACTOR_ID, channelId: CHANNEL_ID },
      deps
    );

    expect(deps.teamsRepo.listConfirmedParticipantIdsForTeam).toHaveBeenCalledWith(
      teamChannel().team_id
    );
  });

  it('returns 401 for a visitor without resolving any private resource', async () => {
    const deps = dependencies();

    await expect(
      authorizeConfirmedTeamChatMember(
        { actorParticipantId: null, channelId: CHANNEL_ID },
        deps
      )
    ).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });

    expect(deps.participantsRepo.findById).not.toHaveBeenCalled();
    expect(deps.chatRepo.findChannelById).not.toHaveBeenCalled();
    expect(deps.teamsRepo.listConfirmedParticipantIdsForTeam).not.toHaveBeenCalled();
  });

  it('uses an identical generic denial without leaking private channel or message content', async () => {
    const privateChannel = teamChannel();
    const deps = dependencies({
      channel: privateChannel,
      confirmedParticipantIds: [],
    });

    const denied = await expectForbidden(
      authorizeConfirmedTeamChatMember(
        { actorParticipantId: ACTOR_ID, channelId: CHANNEL_ID },
        deps
      )
    );
    const serialized = JSON.stringify({
      status: denied.status,
      code: denied.code,
      message: denied.message,
    });

    expect(serialized).not.toContain(privateChannel.title);
    expect(serialized).not.toContain(privateChannel.description);
    expect(serialized).not.toContain(privateChannel.team_id!);
    expect(serialized).not.toContain('private message body');
  });

  it('denies public or missing channels through the team-chat guard without changing US-030 routes', async () => {
    const publicChannel = teamChannel({ channel_type: 'public', team_id: null });

    await expectForbidden(
      authorizeConfirmedTeamChatMember(
        { actorParticipantId: ACTOR_ID, channelId: CHANNEL_ID },
        dependencies({ channel: publicChannel })
      )
    );
    await expectForbidden(
      authorizeConfirmedTeamChatMember(
        { actorParticipantId: ACTOR_ID, channelId: CHANNEL_ID },
        dependencies({ channel: null })
      )
    );
  });
});

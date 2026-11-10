import {
  chatRepository,
  type IChatRepository,
} from '../db/chat.repository.js';
import {
  participantsRepository,
  type IParticipantRepository,
} from '../db/participants.repository.js';
import {
  teamsRepository,
  type ITeamsRepository,
} from '../db/teams.repository.js';
import type { ChatChannel } from '../db/types.js';

export const TEAM_CHAT_ACCESS_DENIED_MESSAGE =
  'You do not have permission to access this team chat.';

export class TeamChatAuthorizationError extends Error {
  readonly status: number;
  readonly code: 'UNAUTHORIZED' | 'TEAM_CHAT_ACCESS_DENIED';

  constructor(
    status: number,
    code: 'UNAUTHORIZED' | 'TEAM_CHAT_ACCESS_DENIED',
    message: string
  ) {
    super(message);
    this.name = 'TeamChatAuthorizationError';
    this.status = status;
    this.code = code;
  }
}

export interface TeamChatAuthorizationDeps {
  chatRepo?: Pick<IChatRepository, 'findChannelById'>;
  participantsRepo?: Pick<IParticipantRepository, 'findById'>;
  teamsRepo?: Pick<ITeamsRepository, 'listConfirmedParticipantIdsForTeam'>;
}

export interface AuthorizedTeamChatContext {
  participantId: string;
  teamId: string;
  channel: ChatChannel;
}

function denyTeamChatAccess(): never {
  throw new TeamChatAuthorizationError(
    403,
    'TEAM_CHAT_ACCESS_DENIED',
    TEAM_CHAT_ACCESS_DENIED_MESSAGE
  );
}

/**
 * US-031 / #380 — authorize access to one persisted private team channel.
 *
 * The caller supplies only the authenticated participant id and channel id. The target
 * team is always resolved from chat_channels.team_id, so a client-provided team id can
 * never redirect the membership check. Every authenticated denial has the same generic
 * error and returns no channel metadata; message rows are never queried here.
 *
 * Existing US-030 public forum routes do not use this guard and remain unchanged.
 */
export async function authorizeConfirmedTeamChatMember(
  input: {
    actorParticipantId?: string | null;
    channelId: string;
  },
  deps: TeamChatAuthorizationDeps = {}
): Promise<AuthorizedTeamChatContext> {
  const actorParticipantId = input.actorParticipantId?.trim();
  if (!actorParticipantId) {
    throw new TeamChatAuthorizationError(
      401,
      'UNAUTHORIZED',
      'Authentication required. Missing or malformed Authorization header.'
    );
  }

  const participantsRepo = deps.participantsRepo ?? participantsRepository;
  const chatRepo = deps.chatRepo ?? chatRepository;
  const teamsRepo = deps.teamsRepo ?? teamsRepository;

  const participant = await participantsRepo.findById(actorParticipantId);
  if (
    !participant ||
    participant.role !== 'PART' ||
    !participant.is_verified ||
    participant.is_suspended ||
    participant.is_deactivated
  ) {
    denyTeamChatAccess();
  }

  const channelId = input.channelId?.trim();
  if (!channelId) {
    denyTeamChatAccess();
  }

  const channel = await chatRepo.findChannelById(channelId);
  if (!channel || channel.channel_type !== 'team' || !channel.team_id) {
    denyTeamChatAccess();
  }

  const confirmedParticipantIds =
    await teamsRepo.listConfirmedParticipantIdsForTeam(channel.team_id);
  if (!confirmedParticipantIds.includes(actorParticipantId)) {
    denyTeamChatAccess();
  }

  return {
    participantId: actorParticipantId,
    teamId: channel.team_id,
    channel,
  };
}

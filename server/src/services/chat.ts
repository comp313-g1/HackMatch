import { chatRepository } from '../db/chat.repository.js';
import {
  buildTeamChannelDescription,
  buildTeamChannelTitle,
  isPublicChatChannel,
  type ChatChannelType,
} from '../db/chatModel.js';
import { profileRepository } from '../db/profile.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import type { ChatChannel, ChatMessage } from '../db/types.js';
import { scrubPrivateChatFields } from './chatPrivacy.js';
import type { ChatReactionSummary } from '../db/chatReactionModel.js';
import { withChatReactionSummaries, withEmptyChatReactions } from './chatReactionSummaries.js';

/**
 * Safe channel payload (US-030 / #344–#345 / FR-087, FR-089).
 * Never includes email, credentials, OTPs, or firebase_uid.
 */
export interface ChatChannelView {
  id: string;
  title: string;
  description: string;
  createdBy: string;
  channelType?: ChatChannelType;
  teamId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Safe message payload (US-030 / #344–#345 / FR-088, FR-089).
 * Author is exposed as handle only — never email.
 */
export interface ChatMessageView {
  id: string;
  channelId: string;
  authorId: string;
  authorHandle: string | null;
  body: string;
  createdAt: string;
  /**
   * US-035 / #405: present only while RICH_CHAT_REACTIONS_ENABLED is on. Counts and the
   * viewer's own state per approved reaction; never who reacted.
   */
  reactions?: ChatReactionSummary[];
}

export class ChatServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ChatServiceError';
    this.status = status;
    this.code = code;
  }
}

export function toChannelView(channel: ChatChannel): ChatChannelView {
  // FR-089 / #345 — scrub even if a repository join later adds sensitive keys.
  return scrubPrivateChatFields({
    id: channel.id,
    title: channel.title,
    description: channel.description,
    createdBy: channel.created_by,
    ...(channel.channel_type !== undefined ? { channelType: channel.channel_type } : {}),
    ...(channel.team_id !== undefined ? { teamId: channel.team_id } : {}),
    createdAt: channel.created_at,
    updatedAt: channel.updated_at,
  });
}

export function toMessageView(
  message: ChatMessage,
  authorHandle: string | null
): ChatMessageView {
  return scrubPrivateChatFields({
    id: message.id,
    channelId: message.channel_id,
    authorId: message.author_id,
    authorHandle,
    body: message.body,
    createdAt: message.created_at,
  });
}

async function resolveAuthorHandles(
  authorIds: string[]
): Promise<Map<string, string | null>> {
  const unique = [...new Set(authorIds)];
  const entries = await Promise.all(
    unique.map(async (id) => {
      const profile = await profileRepository.findProfileByParticipantId(id);
      return [id, profile?.handle ?? null] as const;
    })
  );
  return new Map(entries);
}

/** US-031 / #381: safe private team channel payload (adds the owning team id). */
export interface TeamChatChannelView extends ChatChannelView {
  teamId: string;
}

const TEAM_CHANNEL_NOT_FOUND = {
  status: 404,
  code: 'TEAM_CHANNEL_NOT_FOUND',
  message: 'Team channel not found.',
} as const;

/**
 * Returns the team's private channel, creating it on first use (#431).
 *
 * Teams created before channel provisioning existed, and teams whose creation-time provisioning
 * failed, get their channel the first time an authorized member opens the chat. Provisioning is
 * idempotent, so two simultaneous first opens (the chat panel loads the channel and the messages
 * together) end up with the same single channel. Only callers that already passed the
 * confirmed-member gate reach this. A team that cannot have a channel (it does not exist, or it was
 * disbanded without one) is reported as 404 TEAM_CHANNEL_NOT_FOUND.
 */
async function findTeamChannelOrThrow(teamId: string): Promise<ChatChannel> {
  const notFound = () =>
    new ChatServiceError(TEAM_CHANNEL_NOT_FOUND.status, TEAM_CHANNEL_NOT_FOUND.code, TEAM_CHANNEL_NOT_FOUND.message);

  const trimmed = typeof teamId === 'string' ? teamId.trim() : '';
  if (!trimmed) throw notFound();

  let channel = await chatRepository.findChannelByTeamId(trimmed);
  if (!channel) {
    try {
      await provisionOrLinkTeamChannel({ teamId: trimmed });
    } catch (err) {
      if (
        err instanceof ChatServiceError &&
        (err.code === 'TEAM_NOT_FOUND' || err.code === 'TEAM_CHAT_TEAM_DISBANDED')
      ) {
        throw notFound();
      }
      throw err;
    }
    channel = await chatRepository.findChannelByTeamId(trimmed);
  }

  // Fail closed: the row must really be this team's private channel.
  if (!channel || channel.channel_type !== 'team' || channel.team_id !== trimmed) throw notFound();
  return channel;
}

/** Translates the lifecycle guards of migration 0052 into content-free 403 responses. */
export function mapTeamChannelWriteError(err: unknown): ChatServiceError | null {
  const text = String((err as { message?: unknown } | null)?.message ?? '');
  if (text.includes('TEAM_CHANNEL_READ_ONLY')) {
    return new ChatServiceError(403, 'TEAM_CHANNEL_READ_ONLY', 'This team channel is read-only.');
  }
  if (text.includes('TEAM_CHANNEL_NOT_A_MEMBER')) {
    return new ChatServiceError(
      403,
      'FORBIDDEN_NOT_TEAM_MEMBER',
      'Only confirmed team members can use this team channel.'
    );
  }
  if (text.includes('TEAM_CHANNEL_ACCOUNT_SUSPENDED')) {
    return new ChatServiceError(403, 'ACCOUNT_SUSPENDED', 'This account cannot write to the team channel.');
  }
  return null;
}

/** Caller must already be authorized as a confirmed member (requireConfirmedTeamMember). */
export async function openTeamChannel(teamId: string): Promise<TeamChatChannelView> {
  const channel = await findTeamChannelOrThrow(teamId);
  return scrubPrivateChatFields({ ...toChannelView(channel), teamId });
}

export async function listTeamChannelMessages(
  teamId: string,
  viewerId?: string
): Promise<ChatMessageView[]> {
  const channel = await findTeamChannelOrThrow(teamId);
  const messages = await chatRepository.listMessagesByChannel(channel.id);
  const handles = await resolveAuthorHandles(messages.map((m) => m.author_id));
  const views = messages.map((message) =>
    toMessageView(message, handles.get(message.author_id) ?? null)
  );
  return withChatReactionSummaries('channel', viewerId, views);
}

export async function sendTeamChannelMessage(input: {
  teamId: string;
  authorId: string;
  body: string;
}): Promise<ChatMessageView> {
  const channel = await findTeamChannelOrThrow(input.teamId);
  let message: ChatMessage;
  try {
    message = await chatRepository.createMessage({
      channel_id: channel.id,
      author_id: input.authorId,
      body: input.body,
    });
  } catch (err) {
    // US-031 / #382: the database re-checks membership, team and account state at insert time,
    // so a change that lands after the route's gate (a race) still cannot produce a write.
    throw mapTeamChannelWriteError(err) ?? err;
  }
  const profile = await profileRepository.findProfileByParticipantId(input.authorId);
  return withEmptyChatReactions(toMessageView(message, profile?.handle ?? null));
}

export async function listChannels(): Promise<ChatChannelView[]> {
  const channels = await chatRepository.listChannelsNewestFirst();
  return channels.map(toChannelView);
}

export async function createChannel(input: {
  title: string;
  description: string;
  createdBy: string;
}): Promise<ChatChannelView> {
  const channel = await chatRepository.createChannel({
    title: input.title,
    description: input.description,
    created_by: input.createdBy,
  });
  return toChannelView(channel);
}

export async function listChannelMessages(
  channelId: string,
  viewerId?: string
): Promise<ChatMessageView[]> {
  const channel = await chatRepository.findChannelById(channelId);
  // US-031 / #378: a private team channel is indistinguishable from a missing one here, so the
  // public endpoints can neither read its messages nor reveal that it exists.
  if (!channel || !isPublicChatChannel(channel)) {
    throw new ChatServiceError(404, 'CHANNEL_NOT_FOUND', 'Chat channel not found.');
  }

  const messages = await chatRepository.listMessagesByChannel(channelId);
  const handles = await resolveAuthorHandles(messages.map((m) => m.author_id));
  const views = messages.map((message) =>
    toMessageView(message, handles.get(message.author_id) ?? null)
  );
  return withChatReactionSummaries('channel', viewerId, views);
}

export async function sendChannelMessage(input: {
  channelId: string;
  authorId: string;
  body: string;
}): Promise<ChatMessageView> {
  const channel = await chatRepository.findChannelById(input.channelId);
  if (!channel || !isPublicChatChannel(channel)) {
    throw new ChatServiceError(404, 'CHANNEL_NOT_FOUND', 'Chat channel not found.');
  }

  const message = await chatRepository.createMessage({
    channel_id: input.channelId,
    author_id: input.authorId,
    body: input.body,
  });

  const profile = await profileRepository.findProfileByParticipantId(input.authorId);
  return withEmptyChatReactions(toMessageView(message, profile?.handle ?? null));
}

export interface TeamChannelBackfillResult {
  checked: number;
  created: number;
  alreadyLinked: number;
  skipped: number;
  failed: Array<{ teamId: string; reason: string }>;
}

/**
 * #431: gives every active team that has no private chat channel one. Safe to run any number of
 * times (provisioning is idempotent); disbanded teams are never given a new channel.
 */
export async function backfillTeamChannels(): Promise<TeamChannelBackfillResult> {
  const teamIds = await chatRepository.listTeamIdsNeedingChannel();
  const result: TeamChannelBackfillResult = {
    checked: teamIds.length,
    created: 0,
    alreadyLinked: 0,
    skipped: 0,
    failed: [],
  };

  for (const teamId of teamIds) {
    try {
      const { created } = await provisionOrLinkTeamChannel({ teamId });
      if (created) result.created += 1;
      else result.alreadyLinked += 1;
    } catch (err) {
      if (
        err instanceof ChatServiceError &&
        (err.code === 'TEAM_NOT_FOUND' || err.code === 'TEAM_CHAT_TEAM_DISBANDED')
      ) {
        result.skipped += 1;
      } else {
        result.failed.push({ teamId, reason: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return result;
}

export interface ProvisionedTeamChannelResult {
  channel: ChatChannelView;
  created: boolean;
  teamId: string;
}

/**
 * US-031 / #378 / T2: Provision or link a team's private chat channel idempotently.
 * - If channel exists, returns it with created: false (preserving historical linkage even for disbanded teams).
 * - If team is disbanded and has no channel, refuses with 403 TEAM_CHAT_TEAM_DISBANDED.
 * - Otherwise provisions channel via chatRepository.provisionOrLinkTeamChannel.
 */
export async function provisionOrLinkTeamChannel(input: {
  teamId: string;
  actorId?: string;
}): Promise<ProvisionedTeamChannelResult> {
  const trimmedTeamId = input.teamId?.trim();
  if (!trimmedTeamId) {
    throw new ChatServiceError(400, 'VALIDATION_ERROR', 'teamId is required.');
  }

  const team = await teamsRepository.findTeamById(trimmedTeamId);
  if (!team) {
    throw new ChatServiceError(404, 'TEAM_NOT_FOUND', 'Team not found.');
  }

  // Preserve historical linkage first if channel already exists for this team (even if Locked or Disbanded)
  const existing = await chatRepository.findChannelByTeamId(team.id);
  if (existing) {
    return {
      channel: toChannelView({
        ...existing,
        team_id: existing.team_id ?? team.id,
        channel_type: existing.channel_type ?? 'team',
      }),
      created: false,
      teamId: team.id,
    };
  }

  if (team.recruitment_status === 'Disbanded' || team.disbanded_at != null) {
    throw new ChatServiceError(
      403,
      'TEAM_CHAT_TEAM_DISBANDED',
      'Cannot provision a new private chat channel for a disbanded team.'
    );
  }

  const title = buildTeamChannelTitle(team.name);
  const description = buildTeamChannelDescription(team.id, team.name);
  const createdBy = input.actorId ?? team.owner_participant_id;

  const { channel, created } = await chatRepository.provisionOrLinkTeamChannel({
    team_id: team.id,
    title,
    description,
    created_by: createdBy,
  });

  return {
    channel: toChannelView(channel),
    created,
    teamId: team.id,
  };
}

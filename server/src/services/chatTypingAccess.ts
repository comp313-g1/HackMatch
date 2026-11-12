import { chatRepository } from '../db/chat.repository.js';
import { isPublicChatChannel } from '../db/chatModel.js';
import { participantsRepository } from '../db/participants.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import type { Participant } from '../db/types.js';
import { ChatServiceError } from './chat.js';
import { typingHub, type TypingConversation } from './chatTyping.js';
import { authorizeDirectThreadAccess, isEligibleDirectMessageParticipant } from './directMessageAccess.js';
import { peerVisiblePresenceStatus } from './presence.js';

/**
 * US-035 / #407 — who may SIGNAL typing (send rules) and who may RECEIVE it
 * (read rules), per conversation type. Route guard chains run first and are
 * the same ones the message routes use; this module adds only the checks those
 * guards leave to the message services (channel kind, team channel state), plus
 * the delivery-time re-check for viewer streams.
 */

const channelNotFound = () => new ChatServiceError(404, 'CHANNEL_NOT_FOUND', 'Chat channel not found.');
const teamChannelNotFound = () => new ChatServiceError(404, 'TEAM_CHANNEL_NOT_FOUND', 'Team channel not found.');

async function findPublicChannelOrThrow(channelId: string): Promise<void> {
  const channel = await chatRepository.findChannelById(channelId.trim().toLowerCase());
  // A private team channel is indistinguishable from a missing one, as on the message routes.
  if (!channel || !isPublicChatChannel(channel)) throw channelNotFound();
}

async function findTeamChannelOrThrow(teamId: string): Promise<void> {
  const id = teamId.trim().toLowerCase();
  const channel = await chatRepository.findChannelByTeamId(id);
  // Unlike opening the chat, typing never provisions a missing channel.
  if (!channel || channel.channel_type !== 'team' || channel.team_id?.toLowerCase() !== id) {
    throw teamChannelNotFound();
  }
}

/** Fresh account state for a delivery-time re-check. */
async function stillEligible(participantId: string): Promise<Participant | null> {
  const participant = await participantsRepository.findById(participantId);
  return isEligibleDirectMessageParticipant(participant) ? participant : null;
}

/**
 * Applies one signal from the authenticated sender. An Invisible participant emits
 * nothing: their signal is accepted as a harmless no-op that only clears any
 * indicator they still had. Delivery runs in the background so a slow or broken
 * viewer can never delay or fail the sender.
 */
async function applySignal(sender: Participant, conversation: TypingConversation, typing: boolean): Promise<void> {
  const invisible = peerVisiblePresenceStatus(sender.presence_status) === null;
  const profile = invisible || !typing ? null : await profileRepository.findProfileByParticipantId(sender.id);
  void typingHub
    .signal({
      conversation,
      participantId: sender.id,
      handle: profile?.handle ?? null,
      typing: typing && !invisible,
    })
    .catch(() => undefined);
}

export async function signalPublicChannelTyping(sender: Participant, channelId: string, typing: boolean): Promise<void> {
  await findPublicChannelOrThrow(channelId);
  await applySignal(sender, { conversationType: 'channel', conversationId: channelId }, typing);
}

/** Caller already passed requireConfirmedTeamMember. A disbanded team is read-only, as for messages. */
export async function signalTeamTyping(sender: Participant, teamId: string, typing: boolean): Promise<void> {
  await findTeamChannelOrThrow(teamId);
  const team = await teamsRepository.findTeamById(teamId.trim().toLowerCase());
  if (!team || team.recruitment_status === 'Disbanded') {
    throw new ChatServiceError(403, 'TEAM_CHANNEL_READ_ONLY', 'This team channel is read-only.');
  }
  await applySignal(sender, { conversationType: 'team', conversationId: teamId }, typing);
}

/** Caller already passed requireDirectThreadSendAccess (thread participant, eligible peer, no block). */
export async function signalDirectMessageTyping(sender: Participant, threadId: string, typing: boolean): Promise<void> {
  await applySignal(sender, { conversationType: 'directMessage', conversationId: threadId }, typing);
}

export interface TypingViewerAccess {
  conversation: TypingConversation;
  authorize: () => Promise<boolean>;
}

/** Viewer of a public forum. The route chain already verified the account. */
export async function authorizePublicChannelViewer(viewer: Participant, channelId: string): Promise<TypingViewerAccess> {
  await findPublicChannelOrThrow(channelId);
  return {
    conversation: { conversationType: 'channel', conversationId: channelId },
    authorize: async () => {
      if (!(await stillEligible(viewer.id))) return false;
      const channel = await chatRepository.findChannelById(channelId.trim().toLowerCase());
      return !!channel && isPublicChatChannel(channel);
    },
  };
}

/** Viewer of a team channel. requireConfirmedTeamMember already ran; history stays readable after disband. */
export async function authorizeTeamViewer(viewer: Participant, teamId: string): Promise<TypingViewerAccess> {
  await findTeamChannelOrThrow(teamId);
  const id = teamId.trim().toLowerCase();
  return {
    conversation: { conversationType: 'team', conversationId: teamId },
    authorize: async () => {
      if (!(await stillEligible(viewer.id))) return false;
      const teamIds = await teamsRepository.findConfirmedTeamIdsForParticipant(viewer.id);
      return teamIds.some((candidate) => candidate.toLowerCase() === id);
    },
  };
}

/** Viewer of a DM thread. requireDirectThreadParticipant already ran. */
export function authorizeDirectMessageViewer(viewer: Participant, threadId: string): TypingViewerAccess {
  return {
    conversation: { conversationType: 'directMessage', conversationId: threadId },
    authorize: async () => {
      const current = await stillEligible(viewer.id);
      if (!current) return false;
      try {
        await authorizeDirectThreadAccess({ caller: current, threadId });
        return true;
      } catch {
        return false;
      }
    },
  };
}

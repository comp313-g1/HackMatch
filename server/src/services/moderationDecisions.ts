import { getSupabaseClient } from '../db/client.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import type {
  ModerationCase,
  ModerationCaseStatus,
  ModerationDecisionAction,
  ModerationTargetType,
} from '../db/types.js';
import {
  ModerationServiceError,
  toModerationCaseView,
  type ModerationCaseView,
} from './moderationCases.js';
import { moderationPrivacyFlags, scrubPrivateModerationFields } from './moderationPrivacy.js';

export const REDACTED_PITCH = '[Content removed by moderation]';
export const REDACTED_HANDLE = 'redacted';
export const LINK_REMOVAL_NOTICE =
  'This communication link was removed by platform moderation.';

export interface DecideModerationCaseInput {
  actorParticipantId: string;
  actorRole: 'PART' | 'ADMIN';
  caseId: string;
  action: ModerationDecisionAction;
  reason: string;
}

export interface DecideModerationCaseResult {
  case: ModerationCaseView;
  action: ModerationDecisionAction;
  outcome: string;
  safeStateSummary: Record<string, unknown>;
}

function caseStatusForAction(action: ModerationDecisionAction): ModerationCaseStatus {
  return action === 'dismiss' ? 'Dismissed' : 'Resolved';
}

function outcomeForAction(action: ModerationDecisionAction): string {
  switch (action) {
    case 'dismiss':
      return 'case_dismissed';
    case 'redact':
      return 'content_redacted';
    case 'warn':
      return 'warning_recorded';
    case 'hide':
      return 'listing_hidden';
    case 'disable_url':
      return 'url_disabled';
    default:
      return 'action_applied';
  }
}

async function notifyParticipant(input: {
  participantId: string;
  teamId: string | null;
  eventId: string | null;
  type: string;
  message: string;
}): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.from('participant_notifications').insert({
    participant_id: input.participantId,
    team_id: input.teamId,
    event_id: input.eventId,
    type: input.type,
    message: input.message,
  });
  if (error) throw error;
}

async function applyDismiss(row: ModerationCase): Promise<Record<string, unknown>> {
  return {
    caseId: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    status: 'Dismissed',
  };
}

async function applyRedact(row: ModerationCase): Promise<Record<string, unknown>> {
  const client = getSupabaseClient();

  if (row.target_type === 'team' || row.target_type === 'url') {
    const team = await teamsRepository.findTeamById(row.target_id);
    if (!team) {
      throw new ModerationServiceError(404, 'TARGET_NOT_FOUND', 'The moderation target was not found.');
    }
    const { error } = await client
      .from('teams')
      .update({ pitch: REDACTED_PITCH })
      .eq('id', team.id);
    if (error) throw error;
    return {
      targetType: 'team',
      targetId: team.id,
      field: 'pitch',
      redacted: true,
    };
  }

  const participant = await participantsRepository.findById(row.target_id);
  if (!participant) {
    throw new ModerationServiceError(404, 'TARGET_NOT_FOUND', 'The moderation target was not found.');
  }
  const { error } = await client
    .from('participant_profiles')
    .update({ handle: REDACTED_HANDLE })
    .eq('participant_id', participant.id);
  if (error) throw error;
  return {
    targetType: 'profile',
    targetId: participant.id,
    field: 'handle',
    redacted: true,
  };
}

async function applyWarn(row: ModerationCase, reason: string): Promise<Record<string, unknown>> {
  const client = getSupabaseClient();

  if (row.target_type === 'team' || row.target_type === 'url') {
    const team = await teamsRepository.findTeamById(row.target_id);
    if (!team) {
      throw new ModerationServiceError(404, 'TARGET_NOT_FOUND', 'The moderation target was not found.');
    }
    const nextStatus = team.moderation_status === 'Hidden' ? 'Hidden' : 'Warned';
    const { error } = await client
      .from('teams')
      .update({ moderation_status: nextStatus })
      .eq('id', team.id);
    if (error) throw error;

    await notifyParticipant({
      participantId: team.owner_participant_id,
      teamId: team.id,
      eventId: team.event_id,
      type: 'moderation_warning',
      message: `Your team listing received a moderation warning: ${reason}`,
    });

    return {
      targetType: 'team',
      targetId: team.id,
      moderationStatus: nextStatus,
      ownerNotified: true,
    };
  }

  const participant = await participantsRepository.findById(row.target_id);
  if (!participant) {
    throw new ModerationServiceError(404, 'TARGET_NOT_FOUND', 'The moderation target was not found.');
  }
  const { error } = await client
    .from('participant_profiles')
    .update({ moderation_status: 'Warned' })
    .eq('participant_id', participant.id);
  if (error) throw error;

  await notifyParticipant({
    participantId: participant.id,
    teamId: null,
    eventId: null,
    type: 'moderation_warning',
    message: `Your profile received a moderation warning: ${reason}`,
  });

  return {
    targetType: 'profile',
    targetId: participant.id,
    moderationStatus: 'Warned',
    participantNotified: true,
  };
}

async function applyHide(row: ModerationCase, reason: string): Promise<Record<string, unknown>> {
  const client = getSupabaseClient();
  const hiddenAt = new Date().toISOString();

  if (row.target_type === 'profile') {
    const { error } = await client
      .from('participant_profiles')
      .update({ moderation_status: 'Hidden' })
      .eq('participant_id', row.target_id);
    if (error) throw error;

    await notifyParticipant({
      participantId: row.target_id,
      teamId: null,
      eventId: null,
      type: 'moderation_listing_hidden',
      message: `Your profile was hidden from ordinary discovery: ${reason}`,
    });

    return {
      targetType: 'profile',
      targetId: row.target_id,
      moderationStatus: 'Hidden',
      membershipsPreserved: true,
    };
  }

  const team = await teamsRepository.findTeamById(row.target_id);
  if (!team) {
    throw new ModerationServiceError(404, 'TARGET_NOT_FOUND', 'The moderation target was not found.');
  }

  const { error } = await client
    .from('teams')
    .update({
      moderation_status: 'Hidden',
      moderation_hidden_at: hiddenAt,
    })
    .eq('id', team.id);
  if (error) throw error;

  await notifyParticipant({
    participantId: team.owner_participant_id,
    teamId: team.id,
    eventId: team.event_id,
    type: 'moderation_listing_hidden',
    message: `Your team listing was hidden from ordinary discovery: ${reason}`,
  });

  return {
    targetType: 'team',
    targetId: team.id,
    moderationStatus: 'Hidden',
    moderationHiddenAt: hiddenAt,
    membershipsPreserved: true,
    recruitmentStatus: team.recruitment_status,
  };
}

async function applyDisableUrl(row: ModerationCase, reason: string): Promise<Record<string, unknown>> {
  const client = getSupabaseClient();

  if (row.target_type === 'profile') {
    throw new ModerationServiceError(
      400,
      'INVALID_TARGET',
      'disable_url applies to team or url cases with a communication link.',
      { targetType: row.target_type }
    );
  }

  const team = await teamsRepository.findTeamById(row.target_id);
  if (!team) {
    throw new ModerationServiceError(404, 'TARGET_NOT_FOUND', 'The moderation target was not found.');
  }

  const previousLink = team.communication_link;
  const flagged = row.flagged_url;

  const { error: teamErr } = await client
    .from('teams')
    .update({
      communication_link: null,
      link_removal_notice: LINK_REMOVAL_NOTICE,
    })
    .eq('id', team.id);
  if (teamErr) throw teamErr;

  // FR-076: when the case flags an event-related unsafe link path, disable event URL too if present.
  const { data: eventRow } = await client
    .from('events')
    .select('id, is_link_disabled, official_url')
    .eq('id', team.event_id)
    .maybeSingle();

  let eventLinkDisabled = false;
  if (eventRow && flagged && eventRow.official_url === flagged) {
    const { error: eventErr } = await client
      .from('events')
      .update({ is_link_disabled: true })
      .eq('id', team.event_id);
    if (eventErr) throw eventErr;
    eventLinkDisabled = true;
  }

  await notifyParticipant({
    participantId: team.owner_participant_id,
    teamId: team.id,
    eventId: team.event_id,
    type: 'moderation_url_disabled',
    message: `A communication link on your team was disabled by moderation: ${reason}`,
  });

  return {
    targetType: 'team',
    targetId: team.id,
    communicationLinkRemoved: true,
    previousLinkPresent: Boolean(previousLink || flagged),
    linkRemovalNotice: LINK_REMOVAL_NOTICE,
    eventLinkDisabled,
    membershipsPreserved: true,
  };
}

async function applyAction(
  row: ModerationCase,
  action: ModerationDecisionAction,
  reason: string
): Promise<Record<string, unknown>> {
  switch (action) {
    case 'dismiss':
      return applyDismiss(row);
    case 'redact':
      return applyRedact(row);
    case 'warn':
      return applyWarn(row, reason);
    case 'hide':
      return applyHide(row, reason);
    case 'disable_url':
      return applyDisableUrl(row, reason);
    default:
      throw new ModerationServiceError(400, 'INVALID_TARGET', 'Unsupported moderation action.');
  }
}

/**
 * ADMIN decide path for US-026 / #242 / FR-075–076 / FR-079.
 * Requires a non-empty reason; writes a safe action record; never exposes credentials.
 */
export async function decideModerationCase(
  input: DecideModerationCaseInput
): Promise<DecideModerationCaseResult> {
  if (input.actorRole !== 'ADMIN') {
    throw new ModerationServiceError(
      403,
      'FORBIDDEN_ROLE',
      'You do not have permission to access this resource.'
    );
  }

  const row = await moderationRepository.findById(input.caseId);
  if (!row) {
    throw new ModerationServiceError(404, 'CASE_NOT_FOUND', 'Moderation case not found.', {
      caseId: input.caseId,
    });
  }

  if (row.status !== 'Open') {
    throw new ModerationServiceError(
      409,
      'CASE_CLOSED',
      'This moderation case is already closed.',
      { caseId: row.id, status: row.status }
    );
  }

  const effects = await applyAction(row, input.action, input.reason);
  const resolvedAt = new Date().toISOString();
  const status = caseStatusForAction(input.action);
  const outcome = outcomeForAction(input.action);
  const privacy = moderationPrivacyFlags();

  // US-026 / #245 — scrub nested effects before persistence and API response.
  const safeStateSummary: Record<string, unknown> = scrubPrivateModerationFields({
    caseId: row.id,
    action: input.action,
    outcome,
    targetType: row.target_type as ModerationTargetType,
    targetId: row.target_id,
    effects,
    ...privacy,
  });

  await moderationRepository.insertActionRecord({
    actor_id: input.actorParticipantId,
    target_type: `moderation_${row.target_type}`,
    target_id: row.target_id,
    action_type: `moderation_${input.action}`,
    reason: input.reason,
    outcome,
    safe_state_summary: safeStateSummary,
  });

  const updated = await moderationRepository.resolveCase(row.id, {
    status,
    lastActionType: input.action,
    resolvedAt,
  });

  return {
    case: toModerationCaseView(updated),
    action: input.action,
    outcome,
    safeStateSummary,
  };
}

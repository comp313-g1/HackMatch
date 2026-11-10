/**
 * US-025 / #235 participant moderation reporting service (AC 1-4 / FR-073 / FR-074).
 * Links participant reports to US-026 moderation_cases, creates cases if needed,
 * enforces rolling-hour rate limits, and issues receipt confirmations.
 */

import { getSupabaseClient } from '../db/client.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { moderationReportsRepository } from '../db/moderationReports.repository.js';
import { chatRepository } from '../db/chat.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import type {
  ModerationReportCategory,
  ModerationReportTargetType,
} from '../db/types.js';
import type { ValidatedModerationReportInput } from '../validators/moderationReport.validator.js';
import { isPublicChatChannel } from '../db/chatModel.js';
import { assertReportRateLimit } from './reportRateLimiter.js';
import {
  authorizeConfirmedTeamChatMember,
  TeamChatAuthorizationError,
} from './teamChatAuthorization.js';

export type ReportServiceErrorCode =
  | 'TARGET_NOT_FOUND'
  | 'SELF_REPORT_FORBIDDEN'
  | 'INVALID_TARGET'
  | 'UNAUTHORIZED';

export class ReportServiceError extends Error {
  readonly status: number;
  readonly code: ReportServiceErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: ReportServiceErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ReportServiceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ReportSubmissionReceipt {
  reportId: string;
  caseId: string;
  targetType: ModerationReportTargetType;
  targetId: string;
  category: ModerationReportCategory;
  status: 'Received';
  submittedAt: string;
  confirmationMessage: string;
  rateLimit: {
    limit: number;
    remaining: number;
    windowSeconds: number;
  };
}

function unavailableChatMessage(targetId: string): never {
  throw new ReportServiceError(
    404,
    'TARGET_NOT_FOUND',
    'The specified chat message is not available for reporting.',
    { targetType: 'chat_message', targetId }
  );
}

/**
 * Reuses the normal US-030/US-031 read boundaries before a chat message may enter US-025.
 * The lookup resolves message -> persisted channel; client-supplied channel/team identifiers
 * are never trusted. Every missing or private denial has the same 404 shape so message UUIDs
 * cannot be used to probe private team channels.
 *
 * US-032 direct messages use `direct_messages`, while #392/#394 currently map the canonical
 * `chat_message` moderation target only to `chat_messages`. A direct-message UUID therefore
 * follows this same unavailable path until that target/evidence contract is explicitly extended.
 */
async function verifyReportableChatMessage(
  reporterId: string,
  targetId: string
): Promise<void> {
  const message = await chatRepository.findMessageById(targetId);
  if (!message) unavailableChatMessage(targetId);

  const channel = await chatRepository.findChannelById(message.channel_id);
  if (!channel) unavailableChatMessage(targetId);

  if (isPublicChatChannel(channel)) return;

  if (channel.channel_type !== 'team' || !channel.team_id) {
    unavailableChatMessage(targetId);
  }

  try {
    await authorizeConfirmedTeamChatMember({
      actorParticipantId: reporterId,
      channelId: channel.id,
    });
  } catch (error) {
    if (error instanceof TeamChatAuthorizationError) {
      unavailableChatMessage(targetId);
    }
    throw error;
  }
}

/**
 * Validates that the report target is visible and permitted for participant reporting (US-025 AC 1).
 * Executes prior to rate-limit evaluation so invalid targets do not burn hourly quota.
 */
export async function verifyReportableTarget(
  reporterId: string,
  input: ValidatedModerationReportInput
): Promise<void> {
  if (input.targetType === 'chat_message') {
    await verifyReportableChatMessage(reporterId, input.targetId);
    return;
  }

  if (input.targetType === 'team') {
    const team = await teamsRepository.findTeamById(input.targetId);
    if (
      !team ||
      team.moderation_status === 'Hidden' ||
      team.recruitment_status === 'Disbanded'
    ) {
      throw new ReportServiceError(
        404,
        'TARGET_NOT_FOUND',
        'The specified team listing is not available for reporting.',
        { targetType: 'team', targetId: input.targetId }
      );
    }
    return;
  }

  if (input.targetType === 'profile') {
    if (input.targetId === reporterId) {
      throw new ReportServiceError(
        403,
        'SELF_REPORT_FORBIDDEN',
        'You cannot submit a moderation report against your own profile.'
      );
    }

    const participant = await participantsRepository.findById(input.targetId);
    if (
      !participant ||
      participant.role !== 'PART' ||
      participant.is_suspended ||
      participant.is_deactivated
    ) {
      throw new ReportServiceError(
        404,
        'TARGET_NOT_FOUND',
        'The specified candidate profile is not available for reporting.',
        { targetType: 'profile', targetId: input.targetId }
      );
    }

    const profile = await profileRepository.findProfileByParticipantId(
      participant.id
    );
    if (profile && profile.moderation_status === 'Hidden') {
      throw new ReportServiceError(
        404,
        'TARGET_NOT_FOUND',
        'The specified candidate profile is not available for reporting.',
        { targetType: 'profile', targetId: input.targetId }
      );
    }
    return;
  }

  if (input.targetType === 'event') {
    const client = getSupabaseClient();
    const { data: event, error } = await client
      .from('events')
      .select('id, status')
      .eq('id', input.targetId)
      .maybeSingle();

    if (error || !event || event.status !== 'Published') {
      throw new ReportServiceError(
        404,
        'TARGET_NOT_FOUND',
        'The specified event is not available for reporting.',
        { targetType: 'event', targetId: input.targetId }
      );
    }
    return;
  }

  if (input.targetType === 'url') {
    if (!input.flaggedUrl) {
      throw new ReportServiceError(
        400,
        'INVALID_TARGET',
        'URL moderation reports require a flagged URL.',
        { targetType: 'url', targetId: input.targetId }
      );
    }

    let urlTargetValid = false;
    const team = await teamsRepository.findTeamById(input.targetId);
    if (
      team &&
      team.moderation_status !== 'Hidden' &&
      team.recruitment_status !== 'Disbanded'
    ) {
      urlTargetValid = true;
    } else {
      const part = await participantsRepository.findById(input.targetId);
      if (
        part &&
        part.role === 'PART' &&
        !part.is_suspended &&
        !part.is_deactivated
      ) {
        const profile = await profileRepository.findProfileByParticipantId(
          part.id
        );
        if (!profile || profile.moderation_status !== 'Hidden') {
          urlTargetValid = true;
        }
      } else {
        const client = getSupabaseClient();
        const { data: event } = await client
          .from('events')
          .select('id, status')
          .eq('id', input.targetId)
          .maybeSingle();
        if (event && event.status === 'Published') {
          urlTargetValid = true;
        }
      }
    }

    if (!urlTargetValid) {
      throw new ReportServiceError(
        404,
        'TARGET_NOT_FOUND',
        'The specified target owning the URL is not available for reporting.',
        { targetType: 'url', targetId: input.targetId }
      );
    }
  }
}

/**
 * Submits a participant moderation report:
 * 1. Verifies target visibility and eligibility (404/403 on error without burning rate-limit quota)
 * 2. Evaluates rolling-hour rate limit (throws 429 if exceeded)
 * 3. Creates or links to an open US-026 moderation case (incrementing report_count)
 * 4. Persists the report in moderation_reports
 * 5. Returns a receipt confirmation
 */
export async function submitParticipantReport(
  reporterId: string,
  input: ValidatedModerationReportInput,
  options?: { now?: () => Date }
): Promise<ReportSubmissionReceipt> {
  // Step 1: Target verification
  await verifyReportableTarget(reporterId, input);

  // Step 2: Rate limit check (AC 3 / FR-074)
  const rateLimitEval = await assertReportRateLimit(reporterId, options);

  // Step 3: Link or create US-026 moderation case (AC 4 / FR-075)
  const existingCase = await moderationRepository.findOpenCaseByTarget(
    input.targetType,
    input.targetId,
    input.flaggedUrl
  );

  let caseId: string;
  if (existingCase) {
    const updatedCase = await moderationRepository.incrementCaseReportCount(
      existingCase.id
    );
    caseId = updatedCase ? updatedCase.id : existingCase.id;
  } else {
    const caseReason = input.explanation
      ? `[${input.category}] ${input.explanation}`
      : `[${input.category}] Reported by participant.`;

    const newCase = await moderationRepository.createCase({
      target_type: input.targetType,
      target_id: input.targetId,
      reason: caseReason.slice(0, 2000),
      created_by: reporterId,
      flagged_url: input.targetType === 'url' ? input.flaggedUrl ?? null : null,
      report_count: 1,
    });
    caseId = newCase.id;
  }

  // Step 4: Persist the report record
  const nowDate = options?.now ? options.now() : new Date();
  const report = await moderationReportsRepository.createReport({
    reporter_id: reporterId,
    target_type: input.targetType,
    target_id: input.targetId,
    category: input.category,
    explanation: input.explanation,
    flagged_url: input.flaggedUrl,
    case_id: caseId,
    created_at: nowDate,
  });

  // Step 5: Issue receipt confirmation
  return {
    reportId: report.id,
    caseId,
    targetType: input.targetType,
    targetId: input.targetId,
    category: input.category,
    status: 'Received',
    submittedAt: report.created_at,
    confirmationMessage:
      'Your report has been received and queued for administrator review.',
    rateLimit: {
      limit: rateLimitEval.limit,
      remaining: Math.max(0, rateLimitEval.remaining - 1),
      windowSeconds: rateLimitEval.windowSeconds,
    },
  };
}

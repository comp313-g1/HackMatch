import { moderationRepository } from '../db/moderation.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import type {
  ModerationCase,
  ModerationCaseStatus,
  ModerationTargetType,
} from '../db/types.js';

export type ModerationServiceErrorCode =
  | 'TARGET_NOT_FOUND'
  | 'CASE_NOT_FOUND'
  | 'FORBIDDEN_ROLE'
  | 'INVALID_TARGET';

export class ModerationServiceError extends Error {
  readonly status: number;
  readonly code: ModerationServiceErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: ModerationServiceErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ModerationServiceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface CreateModerationCaseInput {
  actorParticipantId: string;
  actorRole: 'PART' | 'ADMIN';
  targetType: ModerationTargetType;
  targetId: string;
  reason: string;
  flaggedUrl?: string | null;
}

/** Public queue / detail case shape (camelCase; no credentials). */
export interface ModerationCaseView {
  id: string;
  targetType: ModerationTargetType;
  targetId: string;
  reason: string;
  status: ModerationCaseStatus;
  reportCount: number;
  flaggedUrl: string | null;
  createdAt: string;
  createdBy: string;
}

export interface SanitizedTeamTarget {
  type: 'team';
  team: {
    id: string;
    name: string;
    pitch: string;
    goal: string;
    commitmentHours: number;
    communicationLink: string | null;
    recruitmentStatus: string;
    eventId: string;
    ownerHandle: string | null;
    ownerDisplayName: string | null;
  };
}

export interface SanitizedProfileTarget {
  type: 'profile';
  profile: {
    participantId: string;
    handle: string | null;
    primaryRole: string | null;
    institution: string | null;
    displayName: string | null;
    skills: string[];
    portfolios: Array<{ url: string; label: string | null }>;
  };
}

export interface SanitizedUrlTarget {
  type: 'url';
  url: {
    flaggedUrl: string;
    owningTargetType: 'team' | 'profile';
    owningTargetId: string;
    /** Nested sanitized owner when resolvable; never includes private contacts. */
    owner: SanitizedTeamTarget['team'] | SanitizedProfileTarget['profile'] | null;
  };
}

export type SanitizedModerationTarget =
  | SanitizedTeamTarget
  | SanitizedProfileTarget
  | SanitizedUrlTarget;

export interface ModerationCaseDetailView {
  case: ModerationCaseView;
  target: SanitizedModerationTarget;
}

export function toModerationCaseView(row: ModerationCase): ModerationCaseView {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    status: row.status,
    reportCount: row.report_count,
    flaggedUrl: row.flagged_url,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

async function assertTargetExists(
  targetType: ModerationTargetType,
  targetId: string
): Promise<void> {
  if (targetType === 'team' || targetType === 'url') {
    const team = await teamsRepository.findTeamById(targetId);
    if (!team) {
      throw new ModerationServiceError(
        404,
        'TARGET_NOT_FOUND',
        'The moderation target was not found.',
        { targetType, targetId }
      );
    }
    return;
  }

  const participant = await participantsRepository.findById(targetId);
  if (!participant || participant.role !== 'PART') {
    throw new ModerationServiceError(
      404,
      'TARGET_NOT_FOUND',
      'The moderation target was not found.',
      { targetType, targetId }
    );
  }
}

async function loadSanitizedTeamTarget(teamId: string): Promise<SanitizedTeamTarget> {
  const team = await teamsRepository.findTeamById(teamId);
  if (!team) {
    throw new ModerationServiceError(
      404,
      'TARGET_NOT_FOUND',
      'The moderation target was not found.',
      { targetType: 'team', targetId: teamId }
    );
  }

  const owner = await participantsRepository.findById(team.owner_participant_id);
  const ownerProfile = owner
    ? await profileRepository.findProfileByParticipantId(owner.id)
    : null;

  return {
    type: 'team',
    team: {
      id: team.id,
      name: team.name,
      pitch: team.pitch,
      goal: team.goal,
      commitmentHours: Number(team.commitment_hours),
      communicationLink: team.communication_link,
      recruitmentStatus: team.recruitment_status,
      eventId: team.event_id,
      ownerHandle: ownerProfile?.handle ?? null,
      ownerDisplayName: owner?.full_name ?? null,
    },
  };
}

async function loadSanitizedProfileTarget(
  participantId: string
): Promise<SanitizedProfileTarget> {
  const participant = await participantsRepository.findById(participantId);
  if (!participant || participant.role !== 'PART') {
    throw new ModerationServiceError(
      404,
      'TARGET_NOT_FOUND',
      'The moderation target was not found.',
      { targetType: 'profile', targetId: participantId }
    );
  }

  const full = await profileRepository.getFullProfile(participantId);

  return {
    type: 'profile',
    profile: {
      participantId: participant.id,
      handle: full.profile?.handle ?? null,
      primaryRole: full.profile?.primary_role ?? null,
      institution: full.profile?.institution ?? null,
      displayName: participant.full_name,
      skills: full.skills.map((s) => s.skill_name),
      portfolios: full.portfolios.map((p) => ({ url: p.url, label: p.label })),
    },
  };
}

/**
 * Builds the sanitized target payload for case detail.
 * Omits credentials, email, firebase_uid, and shared_contact_handle (FR-076 / FR-079).
 * Private workspace notes are not granted by ADMIN role.
 */
export async function loadSanitizedTarget(
  targetType: ModerationTargetType,
  targetId: string,
  flaggedUrl: string | null
): Promise<SanitizedModerationTarget> {
  if (targetType === 'team') {
    return loadSanitizedTeamTarget(targetId);
  }
  if (targetType === 'profile') {
    return loadSanitizedProfileTarget(targetId);
  }

  if (!flaggedUrl) {
    throw new ModerationServiceError(
      404,
      'INVALID_TARGET',
      'URL moderation cases require a flagged URL.',
      { targetType, targetId }
    );
  }

  let owner: SanitizedUrlTarget['url']['owner'] = null;
  let owningTargetType: 'team' | 'profile' = 'team';

  try {
    const teamTarget = await loadSanitizedTeamTarget(targetId);
    owner = teamTarget.team;
    owningTargetType = 'team';
  } catch (err: unknown) {
    if (!(err instanceof ModerationServiceError) || err.code !== 'TARGET_NOT_FOUND') {
      throw err;
    }
    const profileTarget = await loadSanitizedProfileTarget(targetId);
    owner = profileTarget.profile;
    owningTargetType = 'profile';
  }

  return {
    type: 'url',
    url: {
      flaggedUrl,
      owningTargetType,
      owningTargetId: targetId,
      owner,
    },
  };
}

export async function createModerationCase(
  input: CreateModerationCaseInput
): Promise<ModerationCaseView> {
  if (input.actorRole !== 'ADMIN') {
    throw new ModerationServiceError(
      403,
      'FORBIDDEN_ROLE',
      'You do not have permission to access this resource.'
    );
  }

  await assertTargetExists(input.targetType, input.targetId);

  const row = await moderationRepository.createCase({
    target_type: input.targetType,
    target_id: input.targetId,
    reason: input.reason,
    created_by: input.actorParticipantId,
    flagged_url: input.targetType === 'url' ? input.flaggedUrl ?? null : null,
  });

  return toModerationCaseView(row);
}

export async function listModerationQueue(options?: {
  status?: ModerationCaseStatus;
  limit?: number;
}): Promise<ModerationCaseView[]> {
  const rows = await moderationRepository.listNewestFirst(options);
  return rows.map(toModerationCaseView);
}

export async function getModerationCaseDetail(
  caseId: string
): Promise<ModerationCaseDetailView> {
  const row = await moderationRepository.findById(caseId);
  if (!row) {
    throw new ModerationServiceError(
      404,
      'CASE_NOT_FOUND',
      'Moderation case not found.',
      { caseId }
    );
  }

  const target = await loadSanitizedTarget(row.target_type, row.target_id, row.flagged_url);
  return {
    case: toModerationCaseView(row),
    target,
  };
}

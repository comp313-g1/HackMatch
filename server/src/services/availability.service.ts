import type { ParticipantPrimaryRole } from '../db/types.js';
import { participantsRepository } from '../db/participants.repository.js';
import {
  profileRepository,
  type FullParticipantProfileRecord,
} from '../db/profile.repository.js';
import {
  availabilityRepository,
  type IAvailabilityRepository,
  type PlatformAvailabilityRecord,
} from '../repositories/availability.repository.js';
import type {
  AvailabilityRole,
  AvailabilityGoal,
  AvailabilityFieldErrors,
  ValidatedAvailabilityUpdateInput,
} from '../validators/availability.validator.js';
import {
  projectProfileForViewer,
  type PermittedCandidateProfileView,
} from './profilePrivacy.js';

export interface AvailableCandidateCard {
  participantId: string;
  displayName: string;
  handle: string | null;
  institution: string | null;
  primaryRole: ParticipantPrimaryRole | null;
  desiredRole: AvailabilityRole | null;
  commitmentHours: number | null;
  goal: AvailabilityGoal | null;
  skills: string[];
  portfolioLinks: Array<{ url: string; label: string | null; isSelfDeclared: true }>;
  updatedAt: string | null;
}

/** Thrown when Looking for Team cannot be enabled due to incomplete profile (#360). */
export class AvailabilityServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: AvailabilityFieldErrors;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors: AvailabilityFieldErrors = {}
  ) {
    super(message);
    this.name = 'AvailabilityServiceError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export interface AvailabilityServiceDeps {
  availabilityRepo: Pick<
    IAvailabilityRepository,
    'findByParticipantId' | 'upsertByParticipantId' | 'findAllActiveLooking'
  >;
  participantsRepo: Pick<typeof participantsRepository, 'findById'>;
  profileRepo: Pick<typeof profileRepository, 'getFullProfile'>;
}

/**
 * US-011 / #360 — discovery cards need handle, institution, skills, and portfolio.
 * Returns field errors when any required profile piece is missing.
 */
export function evaluateLookingForTeamProfileCompleteness(
  fullProfile: FullParticipantProfileRecord
): AvailabilityFieldErrors {
  const errors: AvailabilityFieldErrors = {};
  const handle = fullProfile.profile?.handle?.trim() ?? '';
  const institution = fullProfile.profile?.institution?.trim() ?? '';
  const skillCount = fullProfile.skills?.length ?? 0;
  const portfolioCount = fullProfile.portfolios?.length ?? 0;

  if (!handle) {
    errors.handle = 'Add a handle on your Profile before enabling Looking for Team.';
  }
  if (!institution) {
    errors.institution =
      'Add your academic institution on your Profile before enabling Looking for Team.';
  }
  if (skillCount < 1) {
    errors.skills = 'Add at least one skill on your Profile before enabling Looking for Team.';
  }
  if (portfolioCount < 1) {
    errors.portfolioLinks =
      'Add at least one HTTPS portfolio link on your Profile before enabling Looking for Team.';
  }

  return errors;
}

export function isLookingForTeamProfileComplete(
  fullProfile: FullParticipantProfileRecord
): boolean {
  return Object.keys(evaluateLookingForTeamProfileCompleteness(fullProfile)).length === 0;
}

const defaultDeps: AvailabilityServiceDeps = {
  availabilityRepo: availabilityRepository,
  participantsRepo: participantsRepository,
  profileRepo: profileRepository,
};

export async function getMyPlatformAvailability(
  participantId: string,
  deps: AvailabilityServiceDeps = defaultDeps
): Promise<PlatformAvailabilityRecord> {
  const existing = await deps.availabilityRepo.findByParticipantId(participantId);
  if (existing) {
    return existing;
  }

  return {
    participantId,
    isLooking: false,
    desiredRole: null,
    commitmentHours: null,
    goal: null,
    updatedAt: null,
  };
}

export async function updateMyPlatformAvailability(
  participantId: string,
  input: ValidatedAvailabilityUpdateInput,
  deps: AvailabilityServiceDeps = defaultDeps
): Promise<PlatformAvailabilityRecord> {
  if (input.isLooking) {
    const fullProfile = await deps.profileRepo.getFullProfile(participantId);
    const profileErrors = evaluateLookingForTeamProfileCompleteness(fullProfile);
    if (Object.keys(profileErrors).length > 0) {
      throw new AvailabilityServiceError(
        400,
        'VALIDATION_ERROR',
        'Complete your Profile (handle, institution, skills, and portfolio) before enabling Looking for Team.',
        profileErrors
      );
    }
  }

  const existing = await deps.availabilityRepo.findByParticipantId(participantId);

  // Preserve existing stored preference values when omitted in update payload
  const desiredRole =
    input.desiredRole !== undefined
      ? input.desiredRole
      : existing?.desiredRole ?? null;

  const commitmentHours =
    input.commitmentHours !== undefined
      ? input.commitmentHours
      : existing?.commitmentHours ?? null;

  const goal =
    input.goal !== undefined ? input.goal : existing?.goal ?? null;

  return deps.availabilityRepo.upsertByParticipantId(participantId, {
    isLooking: input.isLooking,
    desiredRole,
    commitmentHours,
    goal,
  });
}

export async function listAvailableCandidates(
  deps: AvailabilityServiceDeps = defaultDeps
): Promise<AvailableCandidateCard[]> {
  const activeRecords = await deps.availabilityRepo.findAllActiveLooking();
  const candidates: AvailableCandidateCard[] = [];

  for (const record of activeRecords) {
    const participant = await deps.participantsRepo.findById(record.participantId);
    if (!participant || participant.role !== 'PART' || !participant.is_verified || participant.is_suspended) {
      continue;
    }

    const fullProfile = await deps.profileRepo.getFullProfile(participant.id);
    // US-026 / #244 — hidden profiles are omitted from ordinary candidate discovery.
    if (fullProfile.profile?.moderation_status === 'Hidden') {
      continue;
    }
    // US-011 / #360 — omit incomplete discovery cards (skills/handle/institution/portfolio).
    if (!isLookingForTeamProfileComplete(fullProfile)) {
      continue;
    }
    const projected = projectProfileForViewer(
      participant,
      fullProfile,
      'PART'
    ) as PermittedCandidateProfileView;

    candidates.push({
      participantId: participant.id,
      displayName: projected.displayName,
      handle: projected.handle,
      institution: projected.institution,
      primaryRole: projected.primaryRole,
      desiredRole: record.desiredRole,
      commitmentHours: record.commitmentHours,
      goal: record.goal,
      skills: projected.skills,
      portfolioLinks: projected.portfolioLinks,
      updatedAt: record.updatedAt,
    });
  }

  return candidates;
}

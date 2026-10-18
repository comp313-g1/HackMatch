import type { ParticipantPrimaryRole } from '../db/types.js';
import { participantsRepository } from '../db/participants.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import {
  availabilityRepository,
  type IAvailabilityRepository,
  type PlatformAvailabilityRecord,
} from '../repositories/availability.repository.js';
import type {
  AvailabilityRole,
  AvailabilityGoal,
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

export interface AvailabilityServiceDeps {
  availabilityRepo: Pick<
    IAvailabilityRepository,
    'findByParticipantId' | 'upsertByParticipantId' | 'findAllActiveLooking'
  >;
  participantsRepo: Pick<typeof participantsRepository, 'findById'>;
  profileRepo: Pick<typeof profileRepository, 'getFullProfile'>;
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

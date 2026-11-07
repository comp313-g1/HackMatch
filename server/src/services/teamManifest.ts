import { getSupabaseClient } from '../db/client.js';
import { teamsRepository } from '../db/teams.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import { profileRepository, type FullParticipantProfileRecord } from '../db/profile.repository.js';
import { teamManifestRepository } from '../db/teamManifest.repository.js';
import { TeamServiceError } from './teamErrors.js';
import {
  MANIFEST_RECORDED_BY_LABEL,
  MANIFEST_INTEGRITY_NOTICE,
  MANIFEST_PRIVACY_EXCLUSION_NOTICE,
  buildCanonicalRosterSnapshot,
  serializeCanonicalRosterSnapshot,
} from '../db/teamManifestModel.js';
import {
  computeCanonicalSnapshotChecksum,
  detectCanonicalSnapshotFieldChanges,
  normalizeChecksum,
} from './teamManifestChecksum.js';
import { projectManifestMember, scrubManifestPrivateFields } from './manifestPrivacy.js';
import type { TeamManifestExportPayload } from './teamManifestExport.js';

export interface TeamManifestDependencies {
  teamsRepo: typeof teamsRepository;
  participantsRepo: typeof participantsRepository;
  profileRepo: typeof profileRepository;
  manifestRepo: typeof teamManifestRepository;
  getSupabaseClient: typeof getSupabaseClient;
}

const defaultDependencies: TeamManifestDependencies = {
  teamsRepo: teamsRepository,
  participantsRepo: participantsRepository,
  profileRepo: profileRepository,
  manifestRepo: teamManifestRepository,
  getSupabaseClient,
};

function extractMemberProfile(fullProfile: FullParticipantProfileRecord | null | undefined) {
  if (!fullProfile) return null;
  return {
    handle: fullProfile.profile?.handle ?? null,
    primary_role: fullProfile.profile?.primary_role ?? null,
    institution: fullProfile.profile?.institution ?? null,
    shared_contact_handle: fullProfile.profile?.shared_contact_handle ?? null,
    portfolio_links: fullProfile.portfolios?.map((p) => ({
      url: p.url,
      label: p.label,
    })) ?? [],
  };
}

export interface TeamManifestVerificationResult {
  valid: boolean;
  matchesStoredSnapshot: boolean;
  matchesCurrentSnapshot: boolean;
  matchesHistoricalSnapshot: boolean;
  expectedChecksum: string;
  providedChecksum: string;
  lockedAt: string;
  message: string;
  integrityNotice: string;
}

/**
 * Authorizes that the actor is an active, verified, non-suspended confirmed member of a locked team (US-024 AC 1).
 */
export async function authorizeLockedTeamManifestMember(
  actorId: string,
  teamId: string,
  deps: TeamManifestDependencies = defaultDependencies
) {
  if (!actorId || !teamId) {
    throw new TeamServiceError('MANIFEST_ACCESS_DENIED');
  }

  const actor = await deps.participantsRepo.findById(actorId);
  if (!actor || actor.role !== 'PART' || !actor.is_verified || actor.is_suspended || actor.is_deactivated) {
    throw new TeamServiceError('MANIFEST_ACCESS_DENIED');
  }

  const viewParts = await deps.teamsRepo.getTeamViewParts(teamId);
  if (!viewParts || !viewParts.team) {
    throw new TeamServiceError('TEAM_NOT_FOUND');
  }

  if (viewParts.team.recruitment_status !== 'Locked' || !viewParts.team.locked_at) {
    throw new TeamServiceError('MANIFEST_TEAM_NOT_LOCKED', {
      recruitmentStatus: viewParts.team.recruitment_status,
    });
  }

  const confirmedParticipantIds = await deps.teamsRepo.listConfirmedParticipantIdsForTeam(teamId);
  const isConfirmed =
    confirmedParticipantIds.includes(actorId) ||
    viewParts.members.some((m) => m.participant_id === actorId);

  if (!isConfirmed) {
    throw new TeamServiceError('MANIFEST_ACCESS_DENIED');
  }

  return { actor, viewParts };
}

/**
 * Generates and stores the canonical roster snapshot, integrity checksum, and export payload (US-024 / FR-071 / FR-072).
 */
export async function exportLockedTeamManifest(
  actorId: string,
  teamId: string,
  deps: TeamManifestDependencies = defaultDependencies
): Promise<TeamManifestExportPayload> {
  const { viewParts } = await authorizeLockedTeamManifestMember(actorId, teamId, deps);
  const client = deps.getSupabaseClient();

  // Query event title (with fallback)
  let eventTitle = 'Hackathon Event';
  try {
    const { data: eventData } = await client
      .from('events')
      .select('title')
      .eq('id', viewParts.team.event_id)
      .maybeSingle();

    if (eventData?.title) {
      eventTitle = eventData.title;
    }
  } catch {
    // Keep fallback
  }

  // Load and project each confirmed member
  const projectedMembers = await Promise.all(
    viewParts.members.map(async (m) => {
      const participant = await deps.participantsRepo.findById(m.participant_id);
      const fullProfile = await deps.profileRepo.getFullProfile(m.participant_id);
      return projectManifestMember({
        membership: {
          participant_id: m.participant_id,
          role: m.role,
          joined_at: m.joined_at,
        },
        participant,
        profile: extractMemberProfile(fullProfile),
      });
    })
  );

  const snapshot = buildCanonicalRosterSnapshot({
    teamId,
    teamName: viewParts.team.name,
    eventId: viewParts.team.event_id,
    eventTitle,
    lockedAt: viewParts.team.locked_at!,
    members: projectedMembers,
  });

  const canonicalJson = serializeCanonicalRosterSnapshot(snapshot);
  const checksum = computeCanonicalSnapshotChecksum(canonicalJson);

  // Check against prior stored snapshot for included field changes
  const prior = await deps.manifestRepo.getLatestManifestByTeamId(teamId);
  const changeDetection = detectCanonicalSnapshotFieldChanges(
    prior?.snapshot_json ?? null,
    snapshot
  );

  // Record manifest snapshot in PostgreSQL database
  try {
    await deps.manifestRepo.saveManifestSnapshot({
      teamId,
      eventId: viewParts.team.event_id,
      lockedAt: snapshot.lockedAt,
      memberCount: snapshot.memberCount,
      snapshotJson: snapshot,
      canonicalJson,
      checksum,
      actorId,
    });
  } catch {
    // Non-fatal if advisory lock or duplicate snapshot exists
  }

  const payload: TeamManifestExportPayload = {
    teamId,
    snapshot,
    canonicalJson,
    integrity: {
      algorithm: 'SHA-256',
      checksum,
      schemaVersion: '1.0',
      recordedByLabel: MANIFEST_RECORDED_BY_LABEL,
      integrityNotice: MANIFEST_INTEGRITY_NOTICE,
      privacyExclusionNotice: MANIFEST_PRIVACY_EXCLUSION_NOTICE,
      organizerAcceptanceAssumed: false,
    },
    changeDetection: {
      matchesStoredSnapshot: changeDetection.matchesStoredSnapshot,
      previousChecksum: changeDetection.previousChecksum,
      changedFields: changeDetection.changedFields,
    },
    exportedAt: new Date().toISOString(),
  };

  return scrubManifestPrivateFields(payload);
}

/**
 * Compares candidate checksum against current and historical snapshots for a locked team (US-024 / FR-072).
 */
export async function verifyLockedTeamManifestChecksum(
  actorId: string,
  teamId: string,
  candidateChecksum: string,
  deps: TeamManifestDependencies = defaultDependencies
): Promise<TeamManifestVerificationResult> {
  const { viewParts } = await authorizeLockedTeamManifestMember(actorId, teamId, deps);
  const normalizedCandidate = normalizeChecksum(candidateChecksum);

  if (!normalizedCandidate) {
    return {
      valid: false,
      matchesStoredSnapshot: false,
      matchesCurrentSnapshot: false,
      matchesHistoricalSnapshot: false,
      expectedChecksum: '',
      providedChecksum: typeof candidateChecksum === 'string' ? candidateChecksum.trim().toLowerCase() : '',
      lockedAt: viewParts.team.locked_at || '',
      message: 'Checksum must be a valid 64-character SHA-256 hexadecimal string.',
      integrityNotice: MANIFEST_INTEGRITY_NOTICE,
    };
  }

  const currentPayload = await exportLockedTeamManifest(actorId, teamId, deps);
  const matchesCurrent = currentPayload.integrity.checksum === normalizedCandidate;

  let matchesHistorical = false;
  if (!matchesCurrent) {
    const historical = await deps.manifestRepo.findSnapshotByChecksum(teamId, normalizedCandidate);
    matchesHistorical = Boolean(historical);
  }

  const matchesStored = matchesCurrent || matchesHistorical;

  return {
    valid: true,
    matchesStoredSnapshot: matchesStored,
    matchesCurrentSnapshot: matchesCurrent,
    matchesHistoricalSnapshot: matchesHistorical,
    expectedChecksum: currentPayload.integrity.checksum,
    providedChecksum: normalizedCandidate,
    lockedAt: currentPayload.snapshot.lockedAt,
    message: matchesCurrent
      ? 'Checksum matches the stored server record.'
      : matchesHistorical
      ? 'Checksum matches a previous historical snapshot for this locked team roster.'
      : 'Checksum does not match any stored server snapshot for this team.',
    integrityNotice: MANIFEST_INTEGRITY_NOTICE,
  };
}

/**
 * Asynchronously refreshes locked team manifests following account pseudonymization (US-027 / #253 / NR-023).
 * Best-effort: failures never block account deletion.
 */
export async function refreshLockedTeamManifestsAfterPseudonymization(
  lockedTeamIds: string[],
  deps: TeamManifestDependencies = defaultDependencies
): Promise<void> {
  for (const teamId of lockedTeamIds) {
    try {
      const viewParts = await deps.teamsRepo.getTeamViewParts(teamId);
      if (viewParts?.team?.recruitment_status === 'Locked' && viewParts.team.locked_at) {
        const client = deps.getSupabaseClient();
        let eventTitle = 'Hackathon Event';
        try {
          const { data } = await client
            .from('events')
            .select('title')
            .eq('id', viewParts.team.event_id)
            .maybeSingle();
          if (data?.title) eventTitle = data.title;
        } catch {
          // ignore
        }

        const projectedMembers = await Promise.all(
          viewParts.members.map(async (m) => {
            const participant = await deps.participantsRepo.findById(m.participant_id);
            const fullProfile = await deps.profileRepo.getFullProfile(m.participant_id);
            return projectManifestMember({
              membership: {
                participant_id: m.participant_id,
                role: m.role,
                joined_at: m.joined_at,
              },
              participant,
              profile: extractMemberProfile(fullProfile),
            });
          })
        );

        const snapshot = buildCanonicalRosterSnapshot({
          teamId,
          teamName: viewParts.team.name,
          eventId: viewParts.team.event_id,
          eventTitle,
          lockedAt: viewParts.team.locked_at,
          members: projectedMembers,
        });

        const canonicalJson = serializeCanonicalRosterSnapshot(snapshot);
        const checksum = computeCanonicalSnapshotChecksum(canonicalJson);

        await deps.manifestRepo.saveManifestSnapshot({
          teamId,
          eventId: viewParts.team.event_id,
          lockedAt: snapshot.lockedAt,
          memberCount: snapshot.memberCount,
          snapshotJson: snapshot,
          canonicalJson,
          checksum,
          actorId: null,
        });
      }
    } catch {
      // Best-effort: ignore per NR-023
    }
  }
}

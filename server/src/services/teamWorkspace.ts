/**
 * US-023 / #US-023-T2: Locked-team private workspace service.
 *
 * Implements member-only workspace authorization and privacy-scrubbed
 * teammate contact projection (FR-068, FR-069, FR-070, US-023 AC 1 & AC 2).
 */

import type {
  Participant,
  TeamMembershipRole,
  TeamWorkspaceLink,
  TeamWorkspaceNote,
  TeamWorkspaceNoteRevision,
  UpsertWorkspaceLinkInput,
} from '../db/types.js';
import {
  participantsRepository,
  type IParticipantRepository,
} from '../db/participants.repository.js';
import {
  teamsRepository,
  type ITeamsRepository,
} from '../db/teams.repository.js';
import {
  profileRepository,
  type IProfileRepository,
} from '../db/profile.repository.js';
import {
  teamWorkspaceRepository,
  type ITeamWorkspaceRepository,
} from '../db/teamWorkspace.repository.js';
import {
  projectProfileForViewer,
  type PermittedCandidateProfileView,
} from './profilePrivacy.js';
import { TeamServiceError, toTeamServiceError } from './teamErrors.js';

export interface TeammateContactCard {
  participantId: string;
  displayName: string;
  handle: string | null;
  teamRole: TeamMembershipRole;
  primaryRole: string | null;
  institution: string | null;
  skills: string[];
  skillsSelfDeclared: boolean;
  portfolioLinks: Array<{
    url: string;
    label: string | null;
    isSelfDeclared: boolean;
  }>;
  selfDeclaredNotice: string;
  sharedContactHandle: string | null;
  sharedContactAudienceNotice?: string;
  experienceBadge?: string;
}

export interface PrivateTeamWorkspaceView {
  teamId: string;
  teamName: string;
  recruitmentStatus: string;
  lockedAt: string;
  viewerRole: TeamMembershipRole;
  isOwner: boolean;
  teammates: TeammateContactCard[];
  links: TeamWorkspaceLink[];
  note: TeamWorkspaceNote | null;
  revisions: TeamWorkspaceNoteRevision[];
}

export interface TeamWorkspaceServiceDeps {
  participantsRepo?: Pick<IParticipantRepository, 'findById'>;
  teamsRepo?: Pick<
    ITeamsRepository,
    'getTeamViewParts' | 'listConfirmedParticipantIdsForTeam'
  >;
  profileRepo?: Pick<IProfileRepository, 'getFullProfile'>;
  workspaceRepo?: Pick<
    ITeamWorkspaceRepository,
    | 'listLinksByTeamId'
    | 'getNoteByTeamId'
    | 'listRevisionsByTeamId'
    | 'replaceLinksForTeam'
    | 'saveNoteWithOptimisticLock'
  >;
}

/**
 * Authorizes that the actor is an active, verified, confirmed member of a locked team.
 * Rejects visitors, unrelated PART users, ADMIN without membership, suspended/deactivated
 * accounts, and active/unlocked recruiting teams (FR-068, US-023 AC 1).
 */
export async function authorizeLockedTeamWorkspaceMember(
  actorId: string,
  teamId: string,
  deps: TeamWorkspaceServiceDeps = {}
): Promise<{
  actor: Participant;
  viewParts: Awaited<ReturnType<ITeamsRepository['getTeamViewParts']>>;
  viewerRole: TeamMembershipRole;
  isOwner: boolean;
}> {
  const participantsRepo = deps.participantsRepo ?? participantsRepository;
  const teamsRepo = deps.teamsRepo ?? teamsRepository;

  const actor = await participantsRepo.findById(actorId);
  if (
    !actor ||
    actor.role !== 'PART' ||
    !actor.is_verified ||
    actor.is_suspended ||
    actor.is_deactivated
  ) {
    throw new TeamServiceError('WORKSPACE_ACCESS_DENIED');
  }

  let viewParts;
  try {
    viewParts = await teamsRepo.getTeamViewParts(teamId);
  } catch {
    throw new TeamServiceError('TEAM_NOT_FOUND');
  }

  if (!viewParts || !viewParts.team) {
    throw new TeamServiceError('TEAM_NOT_FOUND');
  }

  // FR-068 / US-023 AC 1: The workspace is exclusively available once the roster is locked.
  if (
    viewParts.team.recruitment_status !== 'Locked' ||
    !viewParts.team.locked_at
  ) {
    throw new TeamServiceError('WORKSPACE_TEAM_NOT_LOCKED', {
      recruitmentStatus: viewParts.team.recruitment_status,
    });
  }

  const confirmedIds = await teamsRepo.listConfirmedParticipantIdsForTeam(teamId);
  if (!confirmedIds.includes(actorId)) {
    throw new TeamServiceError('WORKSPACE_ACCESS_DENIED');
  }

  const member = viewParts.members.find((m) => m.participant_id === actorId);
  if (!member) {
    throw new TeamServiceError('WORKSPACE_ACCESS_DENIED');
  }

  const isOwner = viewParts.team.owner_participant_id === actorId;
  const viewerRole: TeamMembershipRole = isOwner ? 'Owner' : member.role;

  return { actor, viewParts, viewerRole, isOwner };
}

/**
 * Loads the private workspace view for a confirmed team member.
 * Projects teammate contacts according to US-006 / US-023 AC 2 (showing shared contacts
 * and portfolio links, strictly excluding emails or auth tokens).
 */
export async function getPrivateTeamWorkspace(
  actorId: string,
  teamId: string,
  deps: TeamWorkspaceServiceDeps = {}
): Promise<PrivateTeamWorkspaceView> {
  const participantsRepo = deps.participantsRepo ?? participantsRepository;
  const profileRepo = deps.profileRepo ?? profileRepository;
  const workspaceRepo = deps.workspaceRepo ?? teamWorkspaceRepository;

  const { viewParts, viewerRole, isOwner } =
    await authorizeLockedTeamWorkspaceMember(actorId, teamId, deps);

  // Build privacy-scrubbed teammate contacts (US-023 AC 2)
  const teammates: TeammateContactCard[] = [];
  for (const member of viewParts.members) {
    const fullProfile = await profileRepo.getFullProfile(member.participant_id);
    const participantRecord =
      (await participantsRepo.findById(member.participant_id)) ?? {
        id: member.participant_id,
        firebase_uid: '',
        email: '',
        full_name: member.full_name,
        role: 'PART' as const,
        is_verified: true,
        created_at: member.joined_at,
        updated_at: member.joined_at,
      };

    const projected = projectProfileForViewer(
      participantRecord,
      fullProfile,
      'CONFIRMED_TEAMMATE'
    ) as PermittedCandidateProfileView;

    teammates.push({
      participantId: member.participant_id,
      displayName: projected.displayName,
      handle: projected.handle,
      teamRole: member.role,
      primaryRole: projected.primaryRole,
      institution: projected.institution,
      skills: projected.skills,
      skillsSelfDeclared: projected.skillsSelfDeclared,
      portfolioLinks: projected.portfolioLinks,
      selfDeclaredNotice: projected.selfDeclaredNotice,
      sharedContactHandle: projected.sharedContactHandle ?? null,
      sharedContactAudienceNotice: projected.sharedContactAudienceNotice,
      experienceBadge: projected.experienceBadge,
    });
  }

  const [links, note, revisions] = await Promise.all([
    workspaceRepo.listLinksByTeamId(teamId),
    workspaceRepo.getNoteByTeamId(teamId),
    workspaceRepo.listRevisionsByTeamId(teamId),
  ]);

  return {
    teamId,
    teamName: viewParts.team.name,
    recruitmentStatus: viewParts.team.recruitment_status,
    lockedAt: viewParts.team.locked_at ?? '',
    viewerRole,
    isOwner,
    teammates,
    links,
    note,
    revisions,
  };
}

/**
 * Updates shared external tool links for a locked team.
 * Strictly restricted to the team owner (FR-069, US-023 AC 3).
 */
export async function updateWorkspaceExternalLinks(
  input: {
    actorId: string;
    teamId: string;
    links: UpsertWorkspaceLinkInput[];
  },
  deps: TeamWorkspaceServiceDeps = {}
): Promise<{
  teamId: string;
  links: TeamWorkspaceLink[];
  updatedAt: string;
}> {
  const workspaceRepo = deps.workspaceRepo ?? teamWorkspaceRepository;

  const access = await authorizeLockedTeamWorkspaceMember(
    input.actorId,
    input.teamId,
    deps
  );

  // FR-069 / US-023 AC 3: Only the team owner can update external tool links
  if (!access.isOwner || access.viewerRole !== 'Owner') {
    throw new TeamServiceError('FORBIDDEN_WORKSPACE_LINKS_OWNER_ONLY');
  }

  const updatedLinks = await workspaceRepo.replaceLinksForTeam(
    input.teamId,
    input.actorId,
    input.links
  );

  return {
    teamId: input.teamId,
    links: updatedLinks,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Saves or updates a shared team markdown concept note with optimistic concurrency.
 * Permitted for any active confirmed member of a locked team (FR-070, US-023 AC 4).
 * Creates an append-only revision record.
 */
export async function saveWorkspaceSharedNote(
  input: {
    actorId: string;
    teamId: string;
    content: string;
    expectedVersion: number;
  },
  deps: TeamWorkspaceServiceDeps = {}
): Promise<{
  teamId: string;
  note: TeamWorkspaceNote;
  revision: TeamWorkspaceNoteRevision;
  revisions: TeamWorkspaceNoteRevision[];
}> {
  const profileRepo = deps.profileRepo ?? profileRepository;
  const workspaceRepo = deps.workspaceRepo ?? teamWorkspaceRepository;

  const access = await authorizeLockedTeamWorkspaceMember(
    input.actorId,
    input.teamId,
    deps
  );

  let authorDisplayName = access.actor.full_name;
  try {
    const fullProfile = await profileRepo.getFullProfile(input.actorId);
    if (fullProfile?.profile?.handle) {
      authorDisplayName = fullProfile.profile.handle;
    }
  } catch {
    // Graceful fallback to actor full_name
  }

  try {
    const saved = await workspaceRepo.saveNoteWithOptimisticLock({
      teamId: input.teamId,
      actorId: input.actorId,
      authorDisplayName,
      content: input.content,
      expectedVersion: input.expectedVersion,
    });

    const revisions = await workspaceRepo.listRevisionsByTeamId(input.teamId);

    return {
      teamId: input.teamId,
      note: saved.note,
      revision: saved.revision,
      revisions,
    };
  } catch (rawErr) {
    const serviceErr = toTeamServiceError(rawErr);
    if (serviceErr && serviceErr.code === 'WORKSPACE_NOTE_CONFLICT') {
      try {
        const [latestNote, latestRevisions] = await Promise.all([
          workspaceRepo.getNoteByTeamId(input.teamId),
          workspaceRepo.listRevisionsByTeamId(input.teamId),
        ]);
        const currentVersion =
          latestNote?.version ??
          (serviceErr.details?.currentVersion as number) ??
          0;
        const enrichedDetails: Record<string, unknown> = {
          ...(serviceErr.details ?? {}),
          expectedVersion: input.expectedVersion,
          currentVersion,
          latestNote,
          revisions: latestRevisions,
          latestRevisions,
        };
        throw new TeamServiceError('WORKSPACE_NOTE_CONFLICT', enrichedDetails);
      } catch (enrichErr) {
        if (enrichErr instanceof TeamServiceError) throw enrichErr;
        throw serviceErr;
      }
    }
    throw rawErr;
  }
}

/**
 * Lists shared team note and its immutable revision history.
 * Permitted for any confirmed member of the locked team (FR-070, US-023 AC 4).
 */
export async function listWorkspaceNoteRevisions(
  actorId: string,
  teamId: string,
  deps: TeamWorkspaceServiceDeps = {}
): Promise<{
  teamId: string;
  note: TeamWorkspaceNote | null;
  revisions: TeamWorkspaceNoteRevision[];
}> {
  const workspaceRepo = deps.workspaceRepo ?? teamWorkspaceRepository;

  await authorizeLockedTeamWorkspaceMember(actorId, teamId, deps);

  const [note, revisions] = await Promise.all([
    workspaceRepo.getNoteByTeamId(teamId),
    workspaceRepo.listRevisionsByTeamId(teamId),
  ]);

  return {
    teamId,
    note,
    revisions,
  };
}



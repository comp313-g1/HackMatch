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
import { TeamServiceError } from './teamErrors.js';

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
    'listLinksByTeamId' | 'getNoteByTeamId' | 'listRevisionsByTeamId'
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

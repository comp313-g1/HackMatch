import type { Participant, ParticipantPrimaryRole, ExperienceBadge } from '../db/types.js';
import type { FullParticipantProfileRecord } from '../db/profile.repository.js';
import {
  buildExperienceSummary,
  SELF_REPORTED_HISTORY_NOTICE,
} from './experienceBadge.js';

export { SELF_REPORTED_HISTORY_NOTICE };

export type ProfileViewerCategory = 'VISITOR' | 'PART' | 'CONFIRMED_TEAMMATE' | 'OWNER';

export const SHARED_CONTACT_AUDIENCE_NOTICE =
  'Shared contact handle is visible only to confirmed teammates. Leaving or removal from a team revokes access.';

export const SELF_DECLARED_NOTICE =
  'Self-declared — HackMatch validates URL format only and does not certify skills, identity, or achievements.';

export const VISITOR_ANONYMIZED_NOTICE =
  'Sign in with a verified Participant account to view candidate handles, skills, and self-declared portfolio links.';

export interface ProjectedHackathonHistoryEntry {
  id: string;
  eventName: string;
  eventDate: string;
  teamRole: ParticipantPrimaryRole;
  projectTitle: string;
  projectUrl: string;
}

export interface VisitorAnonymizedPreview {
  viewerCategory: 'VISITOR';
  isAnonymized: true;
  displayLabel: string;
  primaryRole: ParticipantPrimaryRole | null;
  skillCount: number;
  notice: string;
}

export interface PermittedCandidateProfileView {
  viewerCategory: 'PART' | 'CONFIRMED_TEAMMATE' | 'OWNER';
  displayName: string;
  handle: string | null;
  primaryRole: ParticipantPrimaryRole | null;
  institution: string | null;
  skills: string[];
  skillsSelfDeclared: true;
  portfolioLinks: Array<{
    url: string;
    label: string | null;
    isSelfDeclared: true;
  }>;
  selfDeclaredNotice: string;
  hackathonCount: number;
  experienceBadge: ExperienceBadge;
  experienceBadgeSelfReported: true;
  hackathonHistory: ProjectedHackathonHistoryEntry[];
  participantId?: string;
  sharedContactHandle?: string | null;
  sharedContactAudienceNotice?: string;
}

export type ProjectedProfileView = VisitorAnonymizedPreview | PermittedCandidateProfileView;

/**
 * Determines the viewer category for US-006 AC 3 & AC 4 / FR-014 privacy boundaries.
 */
export function resolveProfileViewerCategory(options: {
  viewerParticipantId?: string | null;
  viewerRole?: 'PART' | 'ADMIN' | null;
  targetParticipantId: string;
  isConfirmedTeammate: boolean;
}): ProfileViewerCategory {
  if (!options.viewerParticipantId || options.viewerRole !== 'PART') {
    return 'VISITOR';
  }
  if (options.viewerParticipantId === options.targetParticipantId) {
    return 'OWNER';
  }
  if (options.isConfirmedTeammate) {
    return 'CONFIRMED_TEAMMATE';
  }
  return 'PART';
}

/**
 * Strictly projects participant profile data according to US-006 AC 3 & AC 4 / FR-014:
 * - VISITOR: anonymized preview only (never exposes displayName, handle, institution, portfolioLinks, or sharedContactHandle).
 * - PART: permitted display/profile fields and self-declared portfolio links; excludes sharedContactHandle, email, internal IDs, and auth data.
 * - CONFIRMED_TEAMMATE: permitted PART fields plus sharedContactHandle and audience notice; still excludes email, internal IDs, and auth data.
 * - OWNER: permitted fields plus own participantId, sharedContactHandle, and audience notice; never exposes email/auth metadata in candidate profile payload.
 */
export function projectProfileForViewer(
  participant: Participant,
  record: FullParticipantProfileRecord,
  viewerCategory: ProfileViewerCategory
): ProjectedProfileView {
  if (viewerCategory === 'VISITOR') {
    return {
      viewerCategory: 'VISITOR',
      isAnonymized: true,
      displayLabel: 'Anonymous Participant',
      primaryRole: record.profile?.primary_role ?? null,
      skillCount: record.skills.length,
      notice: VISITOR_ANONYMIZED_NOTICE,
    };
  }

  const history = record.history ?? [];
  const summary = buildExperienceSummary(history);

  const view: PermittedCandidateProfileView = {
    viewerCategory,
    displayName: participant.full_name,
    handle: record.profile?.handle ?? null,
    primaryRole: record.profile?.primary_role ?? null,
    institution: record.profile?.institution ?? null,
    skills: record.skills.map((s) => s.skill_name),
    skillsSelfDeclared: true,
    portfolioLinks: record.portfolios.map((p) => ({
      url: p.url,
      label: p.label ?? null,
      isSelfDeclared: true,
    })),
    selfDeclaredNotice: SELF_DECLARED_NOTICE,
    hackathonCount: summary.hackathonCount,
    experienceBadge: summary.experienceBadge,
    experienceBadgeSelfReported: true,
    hackathonHistory: history.map((entry) => ({
      id: entry.id,
      eventName: entry.event_name,
      eventDate: entry.event_date,
      teamRole: entry.team_role,
      projectTitle: entry.project_title,
      projectUrl: entry.project_url,
    })),
  };

  if (viewerCategory === 'OWNER') {
    view.participantId = participant.id;
    view.sharedContactHandle = record.profile?.shared_contact_handle ?? null;
    view.sharedContactAudienceNotice = SHARED_CONTACT_AUDIENCE_NOTICE;
  } else if (viewerCategory === 'CONFIRMED_TEAMMATE') {
    view.sharedContactHandle = record.profile?.shared_contact_handle ?? null;
    view.sharedContactAudienceNotice = SHARED_CONTACT_AUDIENCE_NOTICE;
  }

  return view;
}

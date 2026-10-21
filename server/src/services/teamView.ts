import type { ITeamsRepository } from '../db/teams.repository.js';
import { deriveTeamLifecycle, type TeamLifecycle } from './teamLifecycle.js';
import type {
  TeamGoal,
  TeamRecruitmentStatus,
  TeamMembershipRole,
  TeamModerationStatus,
  ParticipantPrimaryRole,
} from '../db/types.js';

export interface TeamMemberView {
  participantId: string;
  displayName: string;
  role: TeamMembershipRole;
  joinedAt: string;
}

export interface TeamVacancyView {
  id: string;
  role: ParticipantPrimaryRole;
  skills: string[];
  status: 'Open' | 'Filled';
}

export interface TeamLimits {
  maxTeamSize: number | null;
  confirmedMembers: number;
  openSlots: number;
  remainingCapacity: number | null;
}

export interface TeamView {
  id: string;
  eventId: string;
  name: string;
  pitch: string;
  goal: TeamGoal;
  commitmentHours: number;
  communicationLink: string | null;
  recruitmentStatus: TeamRecruitmentStatus;
  /** Server-recorded roster lock timestamp when Locked (US-022 / FR-066 / #206). */
  lockedAt: string | null;
  /** Owner-visible moderation state (US-026 / #244 / AC 5). */
  moderationStatus: TeamModerationStatus;
  moderationHiddenAt: string | null;
  linkRemovalNotice: string | null;
  createdAt: string;
  updatedAt: string;
  members: TeamMemberView[];
  vacancies: TeamVacancyView[];
  limits: TeamLimits;
  lifecycle: TeamLifecycle;
  /** Role of the authenticated viewer on this team, when known (US-019 leave). */
  viewerRole: TeamMembershipRole | null;
  /** Participant id of the authenticated viewer when they are on the roster (#185). */
  viewerParticipantId: string | null;
  /** Non-owner may leave while recruitment remains mutable (FR-059). */
  canLeave: boolean;
}

export function toTeamView(
  parts: Awaited<ReturnType<ITeamsRepository['getTeamViewParts']>>,
  options?: { viewerParticipantId?: string }
): TeamView {
  const maxTeamSize = parts.event.max_team_size;
  const effectiveMax = maxTeamSize ?? 4;
  const confirmedMembers = parts.members.length;
  const openSlots = parts.vacancies.filter((v) => v.status === 'Open').length;
  const remainingCapacity = Math.max(0, effectiveMax - confirmedMembers - openSlots);

  const members: TeamMemberView[] = parts.members.map((m) => {
    const handle = m.handle?.trim();
    const displayName = handle && handle.length > 0 ? handle : m.full_name;
    return {
      participantId: m.participant_id,
      displayName,
      role: m.role,
      joinedAt: m.joined_at,
    };
  });

  const vacancies: TeamVacancyView[] = parts.vacancies.map((v) => ({
    id: v.id,
    role: v.role,
    skills: v.skills,
    status: v.status as 'Open' | 'Filled',
  }));

  const eventStatus = parts.event.status ?? 'Published';
  const eventEndDate = parts.event.end_date ?? '2099-01-01T00:00:00.000Z';
  const lifecycle = deriveTeamLifecycle(parts.team, {
    status: eventStatus,
    end_date: eventEndDate,
  });

  const viewerMember = options?.viewerParticipantId
    ? members.find((m) => m.participantId === options.viewerParticipantId)
    : undefined;
  const viewerRole = viewerMember?.role ?? null;
  const viewerParticipantId = viewerMember?.participantId ?? null;
  const canLeave = viewerRole === 'Member' && lifecycle.mutable;

  return {
    id: parts.team.id,
    eventId: parts.team.event_id,
    name: parts.team.name,
    pitch: parts.team.pitch,
    goal: parts.team.goal,
    commitmentHours: Number(parts.team.commitment_hours),
    communicationLink: parts.team.communication_link,
    recruitmentStatus: parts.team.recruitment_status,
    lockedAt: parts.team.locked_at ?? null,
    moderationStatus: parts.team.moderation_status ?? 'None',
    moderationHiddenAt: parts.team.moderation_hidden_at ?? null,
    linkRemovalNotice: parts.team.link_removal_notice ?? null,
    createdAt: parts.team.created_at,
    updatedAt: parts.team.updated_at,
    members,
    vacancies,
    limits: {
      maxTeamSize,
      confirmedMembers,
      openSlots,
      remainingCapacity,
    },
    lifecycle,
    viewerRole,
    viewerParticipantId,
    canLeave,
  };
}

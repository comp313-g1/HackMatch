import type { ITeamsRepository } from '../db/teams.repository.js';
import type {
  TeamGoal,
  TeamRecruitmentStatus,
  TeamMembershipRole,
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
  createdAt: string;
  updatedAt: string;
  members: TeamMemberView[];
  vacancies: TeamVacancyView[];
  limits: TeamLimits;
}

export function toTeamView(parts: Awaited<ReturnType<ITeamsRepository['getTeamViewParts']>>): TeamView {
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

  return {
    id: parts.team.id,
    eventId: parts.team.event_id,
    name: parts.team.name,
    pitch: parts.team.pitch,
    goal: parts.team.goal,
    commitmentHours: Number(parts.team.commitment_hours),
    communicationLink: parts.team.communication_link,
    recruitmentStatus: parts.team.recruitment_status,
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
  };
}

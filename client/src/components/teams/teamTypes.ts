import { PRIMARY_ROLES, type ParticipantPrimaryRole } from '../profile/profileValidation';

export const TEAM_ROLES = PRIMARY_ROLES;
export { type ParticipantPrimaryRole };

export const TEAM_GOALS = ['Learning', 'Project Completion', 'Competitive'] as const;
export type TeamGoal = (typeof TEAM_GOALS)[number];

export const TEAM_NAME_MAX = 100;
export const TEAM_PITCH_MAX = 500;
export const TEAM_LINK_MAX = 2048;
export const TEAM_MAX_COMMITMENT_HOURS = 168;
export const VACANCY_SKILLS_MAX = 10;
export const VACANCY_SKILL_MAX_LENGTH = 50;
export const REMOVAL_REASON_MAX = 500;

export type TeamRecruitmentStatus = 'Open' | 'Locked' | 'Disbanded';
export type TeamMembershipRole = 'Owner' | 'Member';
export type TeamLifecycleReason = 'Locked' | 'Disbanded' | 'EventNotRecruiting';

export interface TeamLifecycle {
  mutable: boolean;
  reason: TeamLifecycleReason | null;
}

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
  lifecycle: TeamLifecycle;
  /** Role of the signed-in viewer on this team (US-019 leave). */
  viewerRole: TeamMembershipRole | null;
  /** True when the viewer is a confirmed non-owner and the team is still mutable. */
  canLeave: boolean;
}

export interface TeamFieldErrors {
  name?: string;
  pitch?: string;
  goal?: string;
  commitmentHours?: string;
  communicationLink?: string;
  eventId?: string;
  role?: string;
  skills?: string;
  vacancies?: string;
  reason?: string;
  _form?: string;
  [unknownKey: string]: string | undefined;
}

export interface TeamListingFormValues {
  name: string;
  pitch: string;
  goal: string;
  commitmentHours: string;
  communicationLink: string;
}

export interface CreateTeamPayload {
  eventId?: string;
  name: string;
  pitch: string;
  goal: TeamGoal;
  commitmentHours: number;
  communicationLink: string | null;
  maxTeamSize?: number;
}

export interface UpdateTeamPayload {
  name?: string;
  pitch?: string;
  goal?: TeamGoal;
  commitmentHours?: number;
  communicationLink?: string | null;
}

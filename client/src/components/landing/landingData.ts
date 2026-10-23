import {
  ALLOWED_PRIMARY_ROLES,
  TEAM_GOALS,
  type ParticipantPrimaryRole,
  type TeamGoal,
} from '../teams/openTeamsApi';

export type LandingRoleFilter = 'all' | ParticipantPrimaryRole;
export type LandingGoalFilter = 'all' | TeamGoal;

export const LANDING_ROLES = ALLOWED_PRIMARY_ROLES;
export const LANDING_GOALS = TEAM_GOALS;

import { getSupabaseClient } from './client.js';
import type {
  Team,
  TeamMembership,
  TeamGoal,
  TeamVacancy,
  TeamMembershipRole,
  ParticipantPrimaryRole,
} from './types.js';

export interface CreateTeamWithOwnerInput {
  ownerParticipantId: string;
  eventId: string;
  name: string;
  pitch: string;
  goal: TeamGoal;
  commitmentHours: number;
  communicationLink: string | null;
}

export interface TeamListingPatch {
  name?: string;
  pitch?: string;
  goal?: TeamGoal;
  commitmentHours?: number;
  communicationLink?: string | null;
}

export interface ITeamsRepository {
  createTeamWithOwner(input: CreateTeamWithOwnerInput): Promise<{ team: Team; membership: TeamMembership }>;
  findTeamById(teamId: string): Promise<Team | null>;
  findConfirmedTeamIdForParticipant(participantId: string, eventId: string): Promise<string | null>;
  getTeamViewParts(teamId: string): Promise<{
    team: Team;
    event: { max_team_size: number | null };
    members: Array<{
      participant_id: string;
      role: TeamMembershipRole;
      joined_at: string;
      handle: string | null;
      full_name: string;
    }>;
    vacancies: TeamVacancy[];
  }>;
  updateTeamListing(actorId: string, teamId: string, patch: TeamListingPatch): Promise<Team>;
  addTeamVacancy(actorId: string, teamId: string, role: ParticipantPrimaryRole, skills: string[]): Promise<TeamVacancy>;
  updateTeamVacancy(actorId: string, teamId: string, vacancyId: string, role: ParticipantPrimaryRole, skills: string[]): Promise<TeamVacancy>;
  removeTeamVacancy(actorId: string, teamId: string, vacancyId: string): Promise<{ canceledRequests: number }>;
  disbandTeam(actorId: string, teamId: string): Promise<{ releasedMembers: number; canceledRequests: number }>;
}

export const teamsRepository: ITeamsRepository = {
  async createTeamWithOwner(input: CreateTeamWithOwnerInput): Promise<{ team: Team; membership: TeamMembership }> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('create_team_with_owner', {
      p_owner_id: input.ownerParticipantId,
      p_event_id: input.eventId,
      p_name: input.name,
      p_pitch: input.pitch,
      p_goal: input.goal,
      p_commitment_hours: input.commitmentHours,
      p_communication_link: input.communicationLink,
    });

    if (error) {
      throw error;
    }

    return data as { team: Team; membership: TeamMembership };
  },

  async findTeamById(teamId: string): Promise<Team | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .maybeSingle();

    if (error) throw error;
    return data as Team | null;
  },

  async findConfirmedTeamIdForParticipant(participantId: string, eventId: string): Promise<string | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('team_memberships')
      .select('team_id')
      .eq('participant_id', participantId)
      .eq('event_id', eventId)
      .eq('status', 'Confirmed')
      .maybeSingle();

    if (error) throw error;
    return data ? (data as { team_id: string }).team_id : null;
  },

  async getTeamViewParts(teamId: string): Promise<{
    team: Team;
    event: { max_team_size: number | null };
    members: Array<{
      participant_id: string;
      role: TeamMembershipRole;
      joined_at: string;
      handle: string | null;
      full_name: string;
    }>;
    vacancies: TeamVacancy[];
  }> {
    const client = getSupabaseClient();

    // 1. Team row
    const { data: team, error: teamError } = await client
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .single();
    if (teamError) throw teamError;

    // 2. Event max_team_size
    const { data: event, error: eventError } = await client
      .from('events')
      .select('max_team_size')
      .eq('id', (team as Team).event_id)
      .single();
    if (eventError) throw eventError;

    // 3. Confirmed memberships
    const { data: memberships, error: memberError } = await client
      .from('team_memberships')
      .select('participant_id, role, joined_at')
      .eq('team_id', teamId)
      .eq('status', 'Confirmed')
      .order('joined_at', { ascending: true });
    if (memberError) throw memberError;

    const pIds = ((memberships || []) as Array<{ participant_id: string }>).map((m) => m.participant_id);
    const participantMap: Record<string, { full_name: string }> = {};
    const profileMap: Record<string, { handle: string | null }> = {};

    if (pIds.length > 0) {
      const { data: participants, error: pError } = await client
        .from('participants')
        .select('id, full_name')
        .in('id', pIds);
      if (pError) throw pError;
      for (const p of (participants || []) as Array<{ id: string; full_name: string }>) {
        participantMap[p.id] = { full_name: p.full_name };
      }

      const { data: profiles, error: profError } = await client
        .from('participant_profiles')
        .select('participant_id, handle')
        .in('participant_id', pIds);
      if (profError) throw profError;
      for (const pr of (profiles || []) as Array<{ participant_id: string; handle: string | null }>) {
        profileMap[pr.participant_id] = { handle: pr.handle };
      }
    }

    const members = ((memberships || []) as Array<{ participant_id: string; role: TeamMembershipRole; joined_at: string }>).map((m) => ({
      participant_id: m.participant_id,
      role: m.role,
      joined_at: m.joined_at,
      full_name: participantMap[m.participant_id]?.full_name || 'Participant',
      handle: profileMap[m.participant_id]?.handle || null,
    }));

    // 4. Open or Filled vacancies
    const { data: vacancies, error: vacError } = await client
      .from('team_vacancies')
      .select('*')
      .eq('team_id', teamId)
      .in('status', ['Open', 'Filled'])
      .order('created_at', { ascending: true });
    if (vacError) throw vacError;

    return {
      team: team as Team,
      event: event as { max_team_size: number | null },
      members,
      vacancies: (vacancies || []) as TeamVacancy[],
    };
  },

  async updateTeamListing(actorId: string, teamId: string, patch: TeamListingPatch): Promise<Team> {
    const client = getSupabaseClient();
    const pPatch: Record<string, unknown> = {};
    if (patch.name !== undefined) pPatch.name = patch.name;
    if (patch.pitch !== undefined) pPatch.pitch = patch.pitch;
    if (patch.goal !== undefined) pPatch.goal = patch.goal;
    if (patch.commitmentHours !== undefined) pPatch.commitment_hours = patch.commitmentHours;
    if (patch.communicationLink !== undefined) pPatch.communication_link = patch.communicationLink;

    const { data, error } = await client.rpc('update_team_listing', {
      p_actor: actorId,
      p_team: teamId,
      p_patch: pPatch,
    });
    if (error) throw error;
    return (data as { team: Team }).team;
  },

  async addTeamVacancy(actorId: string, teamId: string, role: ParticipantPrimaryRole, skills: string[]): Promise<TeamVacancy> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('add_team_vacancy', {
      p_actor: actorId,
      p_team: teamId,
      p_role: role,
      p_skills: skills,
    });
    if (error) throw error;
    return (data as { vacancy: TeamVacancy }).vacancy;
  },

  async updateTeamVacancy(actorId: string, teamId: string, vacancyId: string, role: ParticipantPrimaryRole, skills: string[]): Promise<TeamVacancy> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('update_team_vacancy', {
      p_actor: actorId,
      p_team: teamId,
      p_vacancy: vacancyId,
      p_role: role,
      p_skills: skills,
    });
    if (error) throw error;
    return (data as { vacancy: TeamVacancy }).vacancy;
  },

  async removeTeamVacancy(actorId: string, teamId: string, vacancyId: string): Promise<{ canceledRequests: number }> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('remove_team_vacancy', {
      p_actor: actorId,
      p_team: teamId,
      p_vacancy: vacancyId,
    });
    if (error) throw error;
    return data as { canceledRequests: number };
  },

  async disbandTeam(actorId: string, teamId: string): Promise<{ releasedMembers: number; canceledRequests: number }> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('disband_team', {
      p_actor: actorId,
      p_team: teamId,
    });
    if (error) throw error;
    return data as { releasedMembers: number; canceledRequests: number };
  },
};

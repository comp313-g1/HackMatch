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

export interface OpenTeamRecord {
  team: Team;
  event: { status: 'Published' | 'Archived' | 'Disabled'; end_date: string };
  openVacancies: Array<Pick<TeamVacancy, 'id' | 'role' | 'skills'>>;
  members: Array<{
    participant_id: string;
    role: TeamMembershipRole;
    full_name: string | null;
    handle: string | null;
  }>;
}

export interface ITeamsRepository {
  createShadowEvent(title: string, maxTeamSize?: number): Promise<string>;
  createTeamWithOwner(input: CreateTeamWithOwnerInput): Promise<{ team: Team; membership: TeamMembership }>;
  findTeamById(teamId: string): Promise<Team | null>;
  findConfirmedTeamIdForParticipant(participantId: string, eventId: string): Promise<string | null>;
  findConfirmedTeamIdsForParticipant(participantId: string): Promise<string[]>;
  /** FR-046: participant ids with Confirmed membership in the event (any team). */
  listConfirmedParticipantIdsForEvent(eventId: string): Promise<string[]>;
  getTeamViewParts(teamId: string): Promise<{
    team: Team;
    event: {
      max_team_size: number | null;
      status?: 'Published' | 'Archived' | 'Disabled';
      end_date?: string;
    };
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
  removeTeamMember(actorId: string, teamId: string, memberParticipantId: string, reason: string): Promise<{ availabilityRestored: boolean }>;
  findOpenTeamRecords(options: { withMemberIdentities: boolean }): Promise<OpenTeamRecord[]>;
}

export const teamsRepository: ITeamsRepository = {
  async createShadowEvent(title: string, maxTeamSize: number = 4): Promise<string> {
    const client = getSupabaseClient();
    const eventId = crypto.randomUUID();
    const now = new Date();
    const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year in future
    const key = `shadow-${eventId.slice(0, 8)}`;

    const { data, error } = await client
      .from('events')
      .insert({
        id: eventId,
        title: `${title} Scope`,
        official_url: `https://hackmatch.internal/events/${key}`,
        normalized_url: `https://hackmatch.internal/events/${key}`,
        format: 'Hybrid',
        min_team_size: 1,
        max_team_size: maxTeamSize,
        status: 'Published',
        start_date: now.toISOString(),
        end_date: endDate.toISOString(),
      })
      .select('id')
      .single();

    if (error) throw error;
    return (data as { id: string }).id;
  },

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

  async findConfirmedTeamIdsForParticipant(participantId: string): Promise<string[]> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('team_memberships')
      .select('team_id')
      .eq('participant_id', participantId)
      .eq('status', 'Confirmed')
      .order('joined_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((row: { team_id: string }) => row.team_id);
  },

  async listConfirmedParticipantIdsForEvent(eventId: string): Promise<string[]> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('team_memberships')
      .select('participant_id')
      .eq('event_id', eventId)
      .eq('status', 'Confirmed');

    if (error) throw error;
    return [...new Set((data || []).map((row: { participant_id: string }) => row.participant_id))];
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

    // 2. Event max_team_size, status, end_date (with graceful fallback if event is absent)
    const { data: event } = await client
      .from('events')
      .select('max_team_size, status, end_date')
      .eq('id', (team as Team).event_id)
      .maybeSingle();

    const safeEvent = event || {
      max_team_size: 4,
      status: 'Published' as const,
      end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };

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

      const { data: profiles } = await client
        .from('participant_profiles')
        .select('participant_id, handle')
        .in('participant_id', pIds);
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
    const { data: vacancies } = await client
      .from('team_vacancies')
      .select('*')
      .eq('team_id', teamId)
      .in('status', ['Open', 'Filled'])
      .order('created_at', { ascending: true });

    return {
      team: team as Team,
      event: safeEvent as { max_team_size: number | null },
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

  async removeTeamMember(
    actorId: string,
    teamId: string,
    memberParticipantId: string,
    reason: string
  ): Promise<{ availabilityRestored: boolean }> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('remove_team_member', {
      p_actor: actorId,
      p_team: teamId,
      p_member: memberParticipantId,
      p_reason: reason,
    });
    if (error) throw error;
    return data as { availabilityRestored: boolean };
  },

  async findOpenTeamRecords(options: { withMemberIdentities: boolean }): Promise<OpenTeamRecord[]> {
    const client = getSupabaseClient();
    const withMemberIdentities = options.withMemberIdentities;

    const selectQuery = `
      *,
      events!inner(status, end_date),
      team_vacancies!inner(id, role, skills, status),
      team_memberships(
        participant_id,
        role,
        status${withMemberIdentities ? ', participants(full_name, participant_profiles(handle))' : ''}
      )
    `.replace(/\s+/g, ' ').trim();

    const { data, error } = await client
      .from('teams')
      .select(selectQuery)
      .eq('recruitment_status', 'Open')
      .eq('team_vacancies.status', 'Open')
      .eq('team_memberships.status', 'Confirmed')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    const rows = (data as unknown as Array<Record<string, unknown>>) || [];
    return rows.map((row) => {
      const eventData = (Array.isArray(row.events) ? row.events[0] : row.events) as
        | { status?: 'Published' | 'Archived' | 'Disabled'; end_date?: string }
        | undefined;

      const event: { status: 'Published' | 'Archived' | 'Disabled'; end_date: string } = {
        status: eventData?.status ?? 'Published',
        end_date: eventData?.end_date ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      };

      const vacanciesList = (row.team_vacancies || []) as Array<{
        id: string;
        role: ParticipantPrimaryRole;
        skills: string[];
        status: string;
      }>;
      const openVacancies = vacanciesList
        .filter((v) => v.status === 'Open')
        .map((v) => ({
          id: v.id,
          role: v.role,
          skills: Array.isArray(v.skills) ? v.skills : [],
        }));

      const membershipsList = (row.team_memberships || []) as Array<Record<string, unknown>>;
      const members = membershipsList
        .filter((m) => m.status === 'Confirmed')
        .map((m) => {
          let fullName: string | null = null;
          let handle: string | null = null;

          if (withMemberIdentities && m.participants) {
            const participantData = (Array.isArray(m.participants) ? m.participants[0] : m.participants) as
              | { full_name?: string; participant_profiles?: unknown }
              | undefined;
            fullName = participantData?.full_name ?? null;

            if (participantData?.participant_profiles) {
              const profileData = (Array.isArray(participantData.participant_profiles)
                ? participantData.participant_profiles[0]
                : participantData.participant_profiles) as { handle?: string | null } | undefined;
              handle = profileData?.handle ?? null;
            }
          }

          return {
            participant_id: String(m.participant_id),
            role: m.role as TeamMembershipRole,
            full_name: fullName,
            handle,
          };
        });

      const teamFields = { ...row };
      delete teamFields.events;
      delete teamFields.team_vacancies;
      delete teamFields.team_memberships;

      return {
        team: teamFields as unknown as Team,
        event,
        openVacancies,
        members,
      };
    });
  },
};

import { getSupabaseClient } from './client.js';
import type {
  Team,
  TeamMembership,
  TeamGoal,
  TeamVacancy,
  TeamMembershipRole,
  ParticipantPrimaryRole,
  TeamRequest,
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

export interface DeclineInvitationEffects {
  invitationChanged: boolean;
  ownerAlertCreated: boolean;
  inviteeAlertCreated: boolean;
  availabilityChanged: false;
  membershipChanged: false;
  vacancyChanged: false;
}

export interface InvitationStatusAlertRecord {
  audience: string;
  type: string;
  message: string;
  notificationId?: string;
  createdAt?: string;
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
  /** US-015: participant ids with Confirmed membership in the requesting team. */
  listConfirmedParticipantIdsForTeam(teamId: string): Promise<string[]>;
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
  /** US-019 / #183 / FR-059 — confirmed non-owner voluntary leave before lock. */
  leaveTeam(actorId: string, teamId: string): Promise<{
    leftParticipantId: string;
    teamId: string;
    availabilityRestored: boolean;
    notice: string;
  }>;
  issueTeamInvitation(
    actorId: string,
    teamId: string,
    vacancyId: string,
    inviteeParticipantId: string
  ): Promise<{
    invitation: TeamRequest;
    expiresAt: string;
    vacancyRole: string;
    teamName: string;
  }>;
  /** US-018 / #172 applicant submission via submit_team_application (atomic FR-054). */
  submitTeamApplication(
    actorId: string,
    teamId: string,
    vacancyId: string,
    message: string | null
  ): Promise<{
    application: TeamRequest;
    vacancyRole: string;
    teamName: string;
    pendingCount?: number;
    pendingCountForEvent: number;
    notice: string;
  }>;
  /** US-018 / #174 — count Pending Applications across all teams for platform-wide quota. */
  countPendingApplicationsForParticipant(
    participantId: string
  ): Promise<number>;
  /** US-018 / #174 — count Pending Applications for PART/event quota preflight. */
  countPendingApplicationsForEvent(
    participantId: string,
    eventId: string
  ): Promise<number>;
  /** US-018 / #175 — applicant's applications across teams (status inspect). */
  listMyApplications(participantId: string): Promise<
    Array<{
      application: TeamRequest;
      vacancyRole: string | null;
      teamName: string;
    }>
  >;
  /** US-018 / #175 / FR-055 — applicant withdraw Pending application; idempotent. */
  withdrawTeamApplication(
    actorId: string,
    applicationId: string
  ): Promise<{
    application: TeamRequest;
    changed: boolean;
    idempotent: boolean;
    teamName: string;
    vacancyRole: string | null;
    alerts: Array<{ audience: string; type: string; message: string }>;
    notice: string;
  }>;
  /** US-018 / #176 — detect an existing Pending Application for applicant/team. */
  findPendingApplicationForTeam(
    participantId: string,
    teamId: string
  ): Promise<Pick<TeamRequest, 'id'> | null>;
  /**
   * US-017 / #164 pending-quota probe: existing Pending invite for invitee/team
   * and/or for the vacancy slot (may be the same row).
   */
  findPendingInvitationConflicts(
    teamId: string,
    vacancyId: string,
    inviteeParticipantId: string
  ): Promise<{ byInvitee: TeamRequest | null; bySlot: TeamRequest | null }>;
  /** Load a single Invitation row (US-017 / #165 acceptance revalidation). */
  findInvitationById(invitationId: string): Promise<TeamRequest | null>;
  /** Persist Expired when past expires_at (FR-051); restores pending quotas. */
  markInvitationExpiredIfDue(
    invitationId: string
  ): Promise<{ invitation: TeamRequest; changed: boolean }>;
  /**
   * US-019 / #180 / #181 — atomically accept invitation, fill slot, confirm membership,
   * and cancel competing invitations/applications/slot requests.
   */
  acceptTeamInvitation(
    actorId: string,
    invitationId: string
  ): Promise<{
    accepted: true;
    invitation: TeamRequest;
    membership: TeamMembership;
    vacancy: TeamVacancy;
    teamName: string;
    vacancyRole: string;
    memberCount: number;
    maxTeamSize: number;
    availabilityCleared: boolean;
    membershipCommitted: boolean;
    cascade: {
      winningRequestId?: string;
      eventInvitationsCanceled: number;
      eventApplicationsWithdrawn: number;
      slotRequestsCanceled: number;
      teamRequestsCanceled: number;
      teamNowFull: boolean;
    };
    notice: string;
  }>;
  /** Owner cancel Pending invitation (US-017 / #166 / FR-052); idempotent. */
  cancelTeamInvitation(
    actorId: string,
    invitationId: string
  ): Promise<{
    invitation: TeamRequest;
    changed: boolean;
    idempotent: boolean;
    teamName: string;
    vacancyRole: string | null;
    alerts: Array<{ audience: string; type: string; message: string }>;
    notice: string;
  }>;
  /** Invitee decline Pending invitation (US-019 / #182 / FR-058); idempotent. */
  declineTeamInvitation(
    actorId: string,
    invitationId: string
  ): Promise<{
    invitation: TeamRequest;
    changed: boolean;
    idempotent: boolean;
    teamName: string;
    vacancyRole: string | null;
    alerts: InvitationStatusAlertRecord[];
    effects: DeclineInvitationEffects;
    notice: string;
  }>;
  /** US-019 / #181 — FR-056/057 cascade helper (also usable after application approval). */
  cancelCompetingRequestsOnPlacement(input: {
    winningRequestId: string;
    participantId: string;
    eventId: string;
    teamId: string;
    vacancyId: string | null;
    teamNowFull: boolean;
  }): Promise<{
    winningRequestId: string;
    eventInvitationsCanceled: number;
    eventApplicationsWithdrawn: number;
    slotRequestsCanceled: number;
    teamRequestsCanceled: number;
    teamNowFull: boolean;
  }>;
  /** Invitee inbound invitations (US-019 / #179). */
  listMyInvitations(participantId: string): Promise<
    Array<{
      invitation: TeamRequest;
      vacancyRole: string | null;
      teamName: string;
    }>
  >;
  /** Owner outbound invitations for a team (US-017). */
  listTeamInvitations(teamId: string): Promise<
    Array<{
      invitation: TeamRequest;
      inviteeHandle: string | null;
      inviteeDisplayName: string;
      vacancyRole: string | null;
      teamName: string;
    }>
  >;
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

  async listConfirmedParticipantIdsForTeam(teamId: string): Promise<string[]> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('team_memberships')
      .select('participant_id')
      .eq('team_id', teamId)
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

  async leaveTeam(
    actorId: string,
    teamId: string
  ): Promise<{
    leftParticipantId: string;
    teamId: string;
    availabilityRestored: boolean;
    notice: string;
  }> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('leave_team', {
      p_actor: actorId,
      p_team: teamId,
    });
    if (error) throw error;
    const payload = data as {
      leftParticipantId?: string;
      teamId?: string;
      availabilityRestored?: boolean;
      notice?: string;
    };
    return {
      leftParticipantId: payload.leftParticipantId ?? actorId,
      teamId: payload.teamId ?? teamId,
      availabilityRestored: Boolean(payload.availabilityRestored),
      notice:
        payload.notice ??
        'You left the team. Capacity is available for the team again.',
    };
  },

  async issueTeamInvitation(
    actorId: string,
    teamId: string,
    vacancyId: string,
    inviteeParticipantId: string
  ): Promise<{
    invitation: TeamRequest;
    expiresAt: string;
    vacancyRole: string;
    teamName: string;
  }> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('issue_team_invitation', {
      p_actor: actorId,
      p_team: teamId,
      p_vacancy: vacancyId,
      p_invitee: inviteeParticipantId,
    });
    if (error) throw error;
    const payload = data as {
      invitation: TeamRequest;
      expiresAt: string;
      vacancyRole: string;
      teamName: string;
    };
    return {
      invitation: payload.invitation,
      expiresAt: payload.expiresAt,
      vacancyRole: payload.vacancyRole,
      teamName: payload.teamName,
    };
  },

  async submitTeamApplication(
    actorId: string,
    teamId: string,
    vacancyId: string,
    message: string | null
  ): Promise<{
    application: TeamRequest;
    vacancyRole: string;
    teamName: string;
    pendingCount: number;
    pendingCountForEvent: number;
    notice: string;
  }> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('submit_team_application', {
      p_actor: actorId,
      p_team: teamId,
      p_vacancy: vacancyId,
      p_message: message,
    });
    if (error) throw error;
    const payload = data as {
      application: TeamRequest;
      vacancyRole: string;
      teamName: string;
      pendingCount?: number;
      pendingCountForEvent: number;
      notice: string;
    };
    return {
      application: payload.application,
      vacancyRole: payload.vacancyRole,
      teamName: payload.teamName,
      pendingCount: payload.pendingCount ?? payload.pendingCountForEvent,
      pendingCountForEvent: payload.pendingCountForEvent,
      notice: payload.notice,
    };
  },

  async countPendingApplicationsForParticipant(
    participantId: string
  ): Promise<number> {
    const client = getSupabaseClient();
    const { count, error } = await client
      .from('team_requests')
      .select('id', { count: 'exact', head: true })
      .eq('participant_id', participantId)
      .eq('request_type', 'Application')
      .eq('status', 'Pending');
    if (error) throw error;
    return count ?? 0;
  },

  async countPendingApplicationsForEvent(
    participantId: string,
    eventId: string
  ): Promise<number> {
    const client = getSupabaseClient();
    const { count, error } = await client
      .from('team_requests')
      .select('id', { count: 'exact', head: true })
      .eq('participant_id', participantId)
      .eq('event_id', eventId)
      .eq('request_type', 'Application')
      .eq('status', 'Pending');
    if (error) throw error;
    return count ?? 0;
  },

  async listMyApplications(participantId: string): Promise<
    Array<{
      application: TeamRequest;
      vacancyRole: string | null;
      teamName: string;
    }>
  > {
    const client = getSupabaseClient();
    const { data: rows, error } = await client
      .from('team_requests')
      .select('*, vacancy:team_vacancies(role), team:teams(name)')
      .eq('participant_id', participantId)
      .eq('request_type', 'Application')
      .order('created_at', { ascending: false });
    if (error) throw error;

    return (rows || []).map(
      (row: {
        vacancy?: { role?: string } | null;
        team?: { name?: string } | null;
      } & TeamRequest) => {
        const { vacancy, team, ...application } = row;
        return {
          application: application as TeamRequest,
          vacancyRole: vacancy?.role ?? null,
          teamName: team?.name ?? 'Unknown team',
        };
      }
    );
  },

  async withdrawTeamApplication(
    actorId: string,
    applicationId: string
  ): Promise<{
    application: TeamRequest;
    changed: boolean;
    idempotent: boolean;
    teamName: string;
    vacancyRole: string | null;
    alerts: Array<{ audience: string; type: string; message: string }>;
    notice: string;
  }> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('withdraw_team_application', {
      p_actor: actorId,
      p_application: applicationId,
    });
    if (error) throw error;
    const payload = data as {
      application: TeamRequest;
      changed: boolean;
      idempotent: boolean;
      teamName: string;
      vacancyRole?: string | null;
      alerts?: Array<{ audience: string; type: string; message: string }>;
      notice: string;
    };
    return {
      application: payload.application,
      changed: Boolean(payload.changed),
      idempotent: Boolean(payload.idempotent),
      teamName: payload.teamName,
      vacancyRole: payload.vacancyRole ?? null,
      alerts: payload.alerts ?? [],
      notice: payload.notice,
    };
  },

  async findPendingApplicationForTeam(
    participantId: string,
    teamId: string
  ): Promise<Pick<TeamRequest, 'id'> | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('team_requests')
      .select('id')
      .eq('participant_id', participantId)
      .eq('team_id', teamId)
      .eq('request_type', 'Application')
      .eq('status', 'Pending')
      .maybeSingle();
    if (error) throw error;
    return (data as Pick<TeamRequest, 'id'> | null) ?? null;
  },

  async findPendingInvitationConflicts(
    teamId: string,
    vacancyId: string,
    inviteeParticipantId: string
  ): Promise<{ byInvitee: TeamRequest | null; bySlot: TeamRequest | null }> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('team_requests')
      .select('*')
      .eq('team_id', teamId)
      .eq('request_type', 'Invitation')
      .eq('status', 'Pending')
      .or(`participant_id.eq.${inviteeParticipantId},vacancy_id.eq.${vacancyId}`);
    if (error) throw error;

    const rows = (data || []) as TeamRequest[];
    const byInvitee =
      rows.find((r) => r.participant_id === inviteeParticipantId) ?? null;
    const bySlot = rows.find((r) => r.vacancy_id === vacancyId) ?? null;
    return { byInvitee, bySlot };
  },

  async findInvitationById(invitationId: string): Promise<TeamRequest | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('team_requests')
      .select('*')
      .eq('id', invitationId)
      .eq('request_type', 'Invitation')
      .maybeSingle();
    if (error) throw error;
    return (data as TeamRequest | null) ?? null;
  },

  async markInvitationExpiredIfDue(
    invitationId: string
  ): Promise<{ invitation: TeamRequest; changed: boolean }> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('mark_team_invitation_expired_if_due', {
      p_invitation: invitationId,
    });
    if (error) throw error;
    const payload = data as { invitation: TeamRequest; changed: boolean };
    return {
      invitation: payload.invitation,
      changed: Boolean(payload.changed),
    };
  },

  async acceptTeamInvitation(
    actorId: string,
    invitationId: string
  ): Promise<{
    accepted: true;
    invitation: TeamRequest;
    membership: TeamMembership;
    vacancy: TeamVacancy;
    teamName: string;
    vacancyRole: string;
    memberCount: number;
    maxTeamSize: number;
    availabilityCleared: boolean;
    membershipCommitted: boolean;
    cascade: {
      winningRequestId?: string;
      eventInvitationsCanceled: number;
      eventApplicationsWithdrawn: number;
      slotRequestsCanceled: number;
      teamRequestsCanceled: number;
      teamNowFull: boolean;
    };
    notice: string;
  }> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('accept_team_invitation', {
      p_actor: actorId,
      p_invitation: invitationId,
    });
    if (error) throw error;

    const payload = data as {
      error?: string;
      details?: Record<string, unknown>;
      accepted?: boolean;
      invitation?: TeamRequest;
      membership?: TeamMembership;
      vacancy?: TeamVacancy;
      teamName?: string;
      vacancyRole?: string;
      memberCount?: number;
      maxTeamSize?: number;
      availabilityCleared?: boolean;
      membershipCommitted?: boolean;
      cascade?: {
        winningRequestId?: string;
        eventInvitationsCanceled?: number;
        eventApplicationsWithdrawn?: number;
        slotRequestsCanceled?: number;
        teamRequestsCanceled?: number;
        teamNowFull?: boolean;
      };
      notice?: string;
    };

    // Expiry is persisted by the RPC and returned as a domain failure instead of
    // raised inside PostgreSQL (raising would roll the Expired update back).
    if (payload.error) {
      throw {
        message: payload.error,
        code: 'P0001',
        detail: JSON.stringify(payload.details ?? {}),
      };
    }

    const cascade = payload.cascade ?? {};
    return {
      accepted: true as const,
      invitation: payload.invitation as TeamRequest,
      membership: payload.membership as TeamMembership,
      vacancy: payload.vacancy as TeamVacancy,
      teamName: payload.teamName as string,
      vacancyRole: payload.vacancyRole as string,
      memberCount: payload.memberCount as number,
      maxTeamSize: payload.maxTeamSize as number,
      availabilityCleared: Boolean(payload.availabilityCleared),
      membershipCommitted: payload.membershipCommitted !== false,
      cascade: {
        winningRequestId: cascade.winningRequestId,
        eventInvitationsCanceled: cascade.eventInvitationsCanceled ?? 0,
        eventApplicationsWithdrawn: cascade.eventApplicationsWithdrawn ?? 0,
        slotRequestsCanceled: cascade.slotRequestsCanceled ?? 0,
        teamRequestsCanceled: cascade.teamRequestsCanceled ?? 0,
        teamNowFull: Boolean(cascade.teamNowFull),
      },
      notice: payload.notice as string,
    };
  },

  async cancelTeamInvitation(
    actorId: string,
    invitationId: string
  ): Promise<{
    invitation: TeamRequest;
    changed: boolean;
    idempotent: boolean;
    teamName: string;
    vacancyRole: string | null;
    alerts: Array<{ audience: string; type: string; message: string }>;
    notice: string;
  }> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('cancel_team_invitation', {
      p_actor: actorId,
      p_invitation: invitationId,
    });
    if (error) throw error;
    const payload = data as {
      invitation: TeamRequest;
      changed: boolean;
      idempotent: boolean;
      teamName: string;
      vacancyRole?: string | null;
      alerts?: Array<{ audience: string; type: string; message: string }>;
      notice: string;
    };
    return {
      invitation: payload.invitation,
      changed: Boolean(payload.changed),
      idempotent: Boolean(payload.idempotent),
      teamName: payload.teamName,
      vacancyRole: payload.vacancyRole ?? null,
      alerts: payload.alerts ?? [],
      notice: payload.notice,
    };
  },

  async declineTeamInvitation(
    actorId: string,
    invitationId: string
  ): Promise<{
    invitation: TeamRequest;
    changed: boolean;
    idempotent: boolean;
    teamName: string;
    vacancyRole: string | null;
    alerts: InvitationStatusAlertRecord[];
    effects: DeclineInvitationEffects;
    notice: string;
  }> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('decline_team_invitation', {
      p_actor: actorId,
      p_invitation: invitationId,
    });
    if (error) throw error;
    const payload = data as {
      error?: string;
      details?: Record<string, unknown>;
      invitation: TeamRequest;
      changed: boolean;
      idempotent: boolean;
      teamName: string;
      vacancyRole?: string | null;
      alerts?: InvitationStatusAlertRecord[];
      effects?: DeclineInvitationEffects;
      notice: string;
    };

    // Clock expiry must commit, so the RPC reports it as a failure payload.
    if (payload.error) {
      throw {
        message: payload.error,
        code: 'P0001',
        detail: JSON.stringify(payload.details ?? {}),
      };
    }

    return {
      invitation: payload.invitation,
      changed: Boolean(payload.changed),
      idempotent: Boolean(payload.idempotent),
      teamName: payload.teamName,
      vacancyRole: payload.vacancyRole ?? null,
      alerts: payload.alerts ?? [],
      effects: payload.effects ?? {
        invitationChanged: Boolean(payload.changed),
        ownerAlertCreated: false,
        inviteeAlertCreated: false,
        availabilityChanged: false,
        membershipChanged: false,
        vacancyChanged: false,
      },
      notice: payload.notice,
    };
  },

  async cancelCompetingRequestsOnPlacement(input: {
    winningRequestId: string;
    participantId: string;
    eventId: string;
    teamId: string;
    vacancyId: string | null;
    teamNowFull: boolean;
  }): Promise<{
    winningRequestId: string;
    eventInvitationsCanceled: number;
    eventApplicationsWithdrawn: number;
    slotRequestsCanceled: number;
    teamRequestsCanceled: number;
    teamNowFull: boolean;
  }> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('cancel_competing_requests_on_placement', {
      p_winning_request_id: input.winningRequestId,
      p_participant_id: input.participantId,
      p_event_id: input.eventId,
      p_team_id: input.teamId,
      p_vacancy_id: input.vacancyId,
      p_team_now_full: input.teamNowFull,
    });
    if (error) throw error;
    const payload = data as {
      winningRequestId: string;
      eventInvitationsCanceled: number;
      eventApplicationsWithdrawn: number;
      slotRequestsCanceled: number;
      teamRequestsCanceled: number;
      teamNowFull: boolean;
    };
    return {
      winningRequestId: payload.winningRequestId,
      eventInvitationsCanceled: payload.eventInvitationsCanceled ?? 0,
      eventApplicationsWithdrawn: payload.eventApplicationsWithdrawn ?? 0,
      slotRequestsCanceled: payload.slotRequestsCanceled ?? 0,
      teamRequestsCanceled: payload.teamRequestsCanceled ?? 0,
      teamNowFull: Boolean(payload.teamNowFull),
    };
  },

  async listMyInvitations(participantId: string): Promise<
    Array<{
      invitation: TeamRequest;
      vacancyRole: string | null;
      teamName: string;
    }>
  > {
    const client = getSupabaseClient();
    const { data: rows, error } = await client
      .from('team_requests')
      .select('*, vacancy:team_vacancies(role), team:teams(name)')
      .eq('participant_id', participantId)
      .eq('request_type', 'Invitation')
      .order('created_at', { ascending: false });
    if (error) throw error;

    return (rows || []).map(
      (row: {
        vacancy?: { role?: string } | null;
        team?: { name?: string } | null;
      } & TeamRequest) => {
        const { vacancy, team, ...invitation } = row;
        return {
          invitation: invitation as TeamRequest,
          vacancyRole: vacancy?.role ?? null,
          teamName: team?.name ?? 'Unknown team',
        };
      }
    );
  },

  async listTeamInvitations(teamId: string): Promise<
    Array<{
      invitation: TeamRequest;
      inviteeHandle: string | null;
      inviteeDisplayName: string;
      vacancyRole: string | null;
      teamName: string;
    }>
  > {
    const client = getSupabaseClient();
    const { data: teamRow, error: teamErr } = await client
      .from('teams')
      .select('id, name')
      .eq('id', teamId)
      .maybeSingle();
    if (teamErr) throw teamErr;
    if (!teamRow) return [];

    const { data: rows, error } = await client
      .from('team_requests')
      .select('*, vacancy:team_vacancies(role)')
      .eq('team_id', teamId)
      .eq('request_type', 'Invitation')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const inviteeIds = [...new Set((rows || []).map((r: { participant_id: string }) => r.participant_id))];
    const profileById = new Map<string, { handle: string | null; full_name: string }>();

    if (inviteeIds.length > 0) {
      const { data: participants, error: partErr } = await client
        .from('participants')
        .select('id, full_name')
        .in('id', inviteeIds);
      if (partErr) throw partErr;

      const { data: profiles, error: profileErr } = await client
        .from('participant_profiles')
        .select('participant_id, handle')
        .in('participant_id', inviteeIds);
      if (profileErr) throw profileErr;

      const handleById = new Map(
        (profiles || []).map((p: { participant_id: string; handle: string | null }) => [
          p.participant_id,
          p.handle,
        ])
      );
      for (const p of participants || []) {
        const row = p as { id: string; full_name: string };
        profileById.set(row.id, {
          handle: handleById.get(row.id) ?? null,
          full_name: row.full_name,
        });
      }
    }

    return (rows || []).map((row: Record<string, unknown>) => {
      const vacancy = row.vacancy as { role?: string } | null;
      const invitation = { ...row } as unknown as TeamRequest & { vacancy?: unknown };
      delete (invitation as { vacancy?: unknown }).vacancy;
      const profile = profileById.get(invitation.participant_id);
      return {
        invitation,
        inviteeHandle: profile?.handle ?? null,
        inviteeDisplayName: profile?.full_name ?? 'Participant',
        vacancyRole: vacancy?.role ?? null,
        teamName: (teamRow as { name: string }).name,
      };
    });
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

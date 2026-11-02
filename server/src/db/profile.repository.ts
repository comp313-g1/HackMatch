import { getSupabaseClient } from './client.js';
import type {
  ParticipantProfile,
  ParticipantPrimaryRole,
  ParticipantSkill,
  ParticipantPortfolio,
  ParticipantHackathonHistory,
  CreateHackathonHistoryDTO,
  UpdateHackathonHistoryDTO,
} from './types.js';

function normalizeHistoryRow(row: Record<string, unknown>): ParticipantHackathonHistory {
  let eventDate = '';
  if (row.event_date instanceof Date) {
    eventDate = row.event_date.toISOString().slice(0, 10);
  } else if (typeof row.event_date === 'string') {
    eventDate = row.event_date.slice(0, 10);
  }

  const createdAt =
    typeof row.created_at === 'string'
      ? row.created_at
      : row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(String(row.created_at)).toISOString();

  const updatedAt =
    typeof row.updated_at === 'string'
      ? row.updated_at
      : row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(String(row.updated_at)).toISOString();

  return {
    id: String(row.id),
    participant_id: String(row.participant_id),
    event_name: String(row.event_name),
    event_date: eventDate,
    team_role: row.team_role as ParticipantPrimaryRole,
    project_title: String(row.project_title),
    project_url: String(row.project_url),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export interface PortfolioLinkInput {
  url: string;
  label?: string | null;
}

export interface UpsertFullProfileInput {
  participantId: string;
  handle: string | null;
  primaryRole: ParticipantPrimaryRole | null;
  institution: string | null;
  sharedContactHandle: string | null;
  skills: string[];
  portfolioLinks: PortfolioLinkInput[];
}

export interface FullParticipantProfileRecord {
  profile: ParticipantProfile | null;
  skills: ParticipantSkill[];
  portfolios: ParticipantPortfolio[];
  history?: ParticipantHackathonHistory[];
}

export interface IProfileRepository {
  findProfileByParticipantId(participantId: string): Promise<ParticipantProfile | null>;
  findByHandle(handle: string): Promise<ParticipantProfile | null>;
  findSkillsByParticipantId(participantId: string): Promise<ParticipantSkill[]>;
  findPortfoliosByParticipantId(participantId: string): Promise<ParticipantPortfolio[]>;
  findHistoryByParticipantId(participantId: string): Promise<ParticipantHackathonHistory[]>;
  findHistoryEntryById(historyId: string): Promise<ParticipantHackathonHistory | null>;
  countHistoryByParticipantId(participantId: string): Promise<number>;
  createHistoryEntry(participantId: string, data: CreateHackathonHistoryDTO): Promise<ParticipantHackathonHistory>;
  updateHistoryEntry(participantId: string, historyId: string, data: UpdateHackathonHistoryDTO): Promise<ParticipantHackathonHistory | null>;
  deleteHistoryEntry(participantId: string, historyId: string): Promise<boolean>;
  getFullProfile(participantId: string): Promise<FullParticipantProfileRecord>;
  upsertFullProfile(input: UpsertFullProfileInput): Promise<FullParticipantProfileRecord>;
  areConfirmedTeammates(viewerParticipantId: string, targetParticipantId: string): Promise<boolean>;
}

export const profileRepository: IProfileRepository = {
  async findProfileByParticipantId(participantId: string): Promise<ParticipantProfile | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('participant_profiles')
      .select('*')
      .eq('participant_id', participantId)
      .maybeSingle();

    if (error) throw error;
    return data as ParticipantProfile | null;
  },

  async findByHandle(handle: string): Promise<ParticipantProfile | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('participant_profiles')
      .select('*')
      .ilike('handle', handle.trim())
      .maybeSingle();

    if (error) throw error;
    return data as ParticipantProfile | null;
  },

  async findSkillsByParticipantId(participantId: string): Promise<ParticipantSkill[]> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('participant_skills')
      .select('*')
      .eq('participant_id', participantId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data || []) as ParticipantSkill[];
  },

  async findPortfoliosByParticipantId(participantId: string): Promise<ParticipantPortfolio[]> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('participant_portfolios')
      .select('*')
      .eq('participant_id', participantId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data || []) as ParticipantPortfolio[];
  },

  async findHistoryByParticipantId(participantId: string): Promise<ParticipantHackathonHistory[]> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('participant_hackathon_history')
      .select('*')
      .eq('participant_id', participantId)
      .order('event_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((row) => normalizeHistoryRow(row as Record<string, unknown>));
  },

  async findHistoryEntryById(historyId: string): Promise<ParticipantHackathonHistory | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('participant_hackathon_history')
      .select('*')
      .eq('id', historyId)
      .maybeSingle();

    if (error) throw error;
    return data ? normalizeHistoryRow(data as Record<string, unknown>) : null;
  },

  async countHistoryByParticipantId(participantId: string): Promise<number> {
    const client = getSupabaseClient();
    const { count, error } = await client
      .from('participant_hackathon_history')
      .select('*', { count: 'exact', head: true })
      .eq('participant_id', participantId);

    if (error) throw error;
    return count ?? 0;
  },

  async createHistoryEntry(
    participantId: string,
    data: CreateHackathonHistoryDTO
  ): Promise<ParticipantHackathonHistory> {
    const client = getSupabaseClient();
    const now = new Date().toISOString();
    const { data: created, error } = await client
      .from('participant_hackathon_history')
      .insert({
        participant_id: participantId,
        event_name: data.event_name.trim(),
        event_date: data.event_date.trim(),
        team_role: data.team_role,
        project_title: data.project_title.trim(),
        project_url: data.project_url.trim(),
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();

    if (error) throw error;
    return normalizeHistoryRow(created as Record<string, unknown>);
  },

  async updateHistoryEntry(
    participantId: string,
    historyId: string,
    data: UpdateHackathonHistoryDTO
  ): Promise<ParticipantHackathonHistory | null> {
    const client = getSupabaseClient();
    const now = new Date().toISOString();
    const { data: updated, error } = await client
      .from('participant_hackathon_history')
      .update({
        event_name: data.event_name.trim(),
        event_date: data.event_date.trim(),
        team_role: data.team_role,
        project_title: data.project_title.trim(),
        project_url: data.project_url.trim(),
        updated_at: now,
      })
      .eq('id', historyId)
      .eq('participant_id', participantId)
      .select('*')
      .maybeSingle();

    if (error) throw error;
    return updated ? normalizeHistoryRow(updated as Record<string, unknown>) : null;
  },

  async deleteHistoryEntry(participantId: string, historyId: string): Promise<boolean> {
    const client = getSupabaseClient();
    const { error, count } = await client
      .from('participant_hackathon_history')
      .delete({ count: 'exact' })
      .eq('id', historyId)
      .eq('participant_id', participantId);

    if (error) throw error;
    return (count ?? 0) > 0;
  },

  async getFullProfile(participantId: string): Promise<FullParticipantProfileRecord> {
    const [profile, skills, portfolios, history] = await Promise.all([
      this.findProfileByParticipantId(participantId),
      this.findSkillsByParticipantId(participantId),
      this.findPortfoliosByParticipantId(participantId),
      this.findHistoryByParticipantId(participantId),
    ]);

    return {
      profile,
      skills,
      portfolios,
      history,
    };
  },

  async upsertFullProfile(input: UpsertFullProfileInput): Promise<FullParticipantProfileRecord> {
    const client = getSupabaseClient();
    const now = new Date().toISOString();

    const { data: profileData, error: profileError } = await client
      .from('participant_profiles')
      .upsert(
        {
          participant_id: input.participantId,
          handle: input.handle,
          primary_role: input.primaryRole,
          institution: input.institution,
          shared_contact_handle: input.sharedContactHandle,
          updated_at: now,
        },
        { onConflict: 'participant_id' }
      )
      .select('*')
      .single();

    if (profileError) throw profileError;

    const { error: deleteSkillsError } = await client
      .from('participant_skills')
      .delete()
      .eq('participant_id', input.participantId);
    if (deleteSkillsError) throw deleteSkillsError;

    let insertedSkills: ParticipantSkill[] = [];
    if (input.skills.length > 0) {
      const skillRows = input.skills.map((skillName) => ({
        participant_id: input.participantId,
        skill_name: skillName,
      }));
      const { data: skillsData, error: insertSkillsError } = await client
        .from('participant_skills')
        .insert(skillRows)
        .select('*');
      if (insertSkillsError) throw insertSkillsError;
      insertedSkills = (skillsData || []) as ParticipantSkill[];
    }

    const { error: deletePortfoliosError } = await client
      .from('participant_portfolios')
      .delete()
      .eq('participant_id', input.participantId);
    if (deletePortfoliosError) throw deletePortfoliosError;

    let insertedPortfolios: ParticipantPortfolio[] = [];
    if (input.portfolioLinks.length > 0) {
      const portfolioRows = input.portfolioLinks.map((link) => ({
        participant_id: input.participantId,
        url: link.url,
        label: link.label ?? null,
      }));
      const { data: portfoliosData, error: insertPortfoliosError } = await client
        .from('participant_portfolios')
        .insert(portfolioRows)
        .select('*');
      if (insertPortfoliosError) throw insertPortfoliosError;
      insertedPortfolios = (portfoliosData || []) as ParticipantPortfolio[];
    }

    return {
      profile: profileData as ParticipantProfile,
      skills: insertedSkills,
      portfolios: insertedPortfolios,
    };
  },

  async areConfirmedTeammates(
    viewerParticipantId: string,
    targetParticipantId: string
  ): Promise<boolean> {
    if (!viewerParticipantId || !targetParticipantId) return false;
    if (viewerParticipantId === targetParticipantId) return true;

    const client = getSupabaseClient();
    const { data: viewerMemberships, error: viewerError } = await client
      .from('team_memberships')
      .select('team_id')
      .eq('participant_id', viewerParticipantId)
      .eq('status', 'Confirmed');

    if (viewerError || !viewerMemberships || viewerMemberships.length === 0) {
      return false;
    }

    const teamIds = (viewerMemberships as Array<{ team_id: string }>).map((m) => m.team_id);
    const { data: sharedMemberships, error: sharedError } = await client
      .from('team_memberships')
      .select('team_id')
      .eq('participant_id', targetParticipantId)
      .eq('status', 'Confirmed')
      .in('team_id', teamIds)
      .limit(1);

    // Fail closed: any lookup error or absence of a Confirmed shared row revokes access (US-006 AC 4).
    if (sharedError || !sharedMemberships || sharedMemberships.length === 0) {
      return false;
    }

    return true;
  },
};

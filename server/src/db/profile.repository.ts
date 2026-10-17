import { getSupabaseClient } from './client.js';
import type {
  ParticipantProfile,
  ParticipantPrimaryRole,
  ParticipantSkill,
  ParticipantPortfolio,
} from './types.js';

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
}

export interface IProfileRepository {
  findProfileByParticipantId(participantId: string): Promise<ParticipantProfile | null>;
  findByHandle(handle: string): Promise<ParticipantProfile | null>;
  findSkillsByParticipantId(participantId: string): Promise<ParticipantSkill[]>;
  findPortfoliosByParticipantId(participantId: string): Promise<ParticipantPortfolio[]>;
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

  async getFullProfile(participantId: string): Promise<FullParticipantProfileRecord> {
    const [profile, skills, portfolios] = await Promise.all([
      this.findProfileByParticipantId(participantId),
      this.findSkillsByParticipantId(participantId),
      this.findPortfoliosByParticipantId(participantId),
    ]);

    return {
      profile,
      skills,
      portfolios,
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

import { getSupabaseClient } from './client.js';
import type { Participant, ParticipantRole, TeamRecruitmentStatus } from './types.js';

export interface AdminAccountListFilters {
  role?: ParticipantRole;
  isSuspended?: boolean;
  isDeactivated?: boolean;
  /** Case-insensitive substring match against email or full_name. */
  q?: string;
  limit: number;
}

export interface AdminAccountListingRow {
  team_id: string;
  team_name: string;
  recruitment_status: TeamRecruitmentStatus;
  locked_at: string | null;
  membership_role: 'Owner' | 'Member';
  is_owner: boolean;
}

export interface IAccountsRepository {
  listForAdmin(filters: AdminAccountListFilters): Promise<Participant[]>;
  findById(accountId: string): Promise<Participant | null>;
  listRelevantListings(accountId: string): Promise<AdminAccountListingRow[]>;
}

export const accountsRepository: IAccountsRepository = {
  async listForAdmin(filters: AdminAccountListFilters): Promise<Participant[]> {
    const client = getSupabaseClient();
    let query = client
      .from('participants')
      .select(
        'id, email, full_name, role, is_verified, is_suspended, suspended_at, suspended_by, suspension_reason, is_deactivated, deactivated_at, deactivated_by, deactivation_reason, created_at, updated_at'
      )
      .order('created_at', { ascending: false })
      .limit(filters.limit);

    if (filters.role) {
      query = query.eq('role', filters.role);
    }
    if (filters.isSuspended !== undefined) {
      query = query.eq('is_suspended', filters.isSuspended);
    }
    if (filters.isDeactivated !== undefined) {
      query = query.eq('is_deactivated', filters.isDeactivated);
    }
    if (filters.q) {
      // Search account identifiers only (email / display name). Never OTP/credential tables.
      const escaped = filters.q.replace(/[%_,]/g, '');
      if (escaped.length > 0) {
        const pattern = `%${escaped}%`;
        query = query.or(`email.ilike."${pattern}",full_name.ilike."${pattern}"`);
      }
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as Participant[];
  },

  async findById(accountId: string): Promise<Participant | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('participants')
      .select(
        'id, email, full_name, role, is_verified, is_suspended, suspended_at, suspended_by, suspension_reason, is_deactivated, deactivated_at, deactivated_by, deactivation_reason, created_at, updated_at'
      )
      .eq('id', accountId)
      .maybeSingle();

    if (error) throw error;
    return data as Participant | null;
  },

  async listRelevantListings(accountId: string): Promise<AdminAccountListingRow[]> {
    const client = getSupabaseClient();

    const { data: memberships, error: membershipError } = await client
      .from('team_memberships')
      .select(
        `
        role,
        status,
        teams!inner (
          id,
          name,
          recruitment_status,
          locked_at,
          owner_participant_id
        )
      `
      )
      .eq('participant_id', accountId)
      .eq('status', 'Confirmed');

    if (membershipError) throw membershipError;

    const rows = (memberships || []) as Array<{
      role: 'Owner' | 'Member';
      status: string;
      teams:
        | {
            id: string;
            name: string;
            recruitment_status: TeamRecruitmentStatus;
            locked_at: string | null;
            owner_participant_id: string;
          }
        | Array<{
            id: string;
            name: string;
            recruitment_status: TeamRecruitmentStatus;
            locked_at: string | null;
            owner_participant_id: string;
          }>;
    }>;

    return rows.map((row) => {
      const team = Array.isArray(row.teams) ? row.teams[0] : row.teams;
      return {
        team_id: team.id,
        team_name: team.name,
        recruitment_status: team.recruitment_status,
        locked_at: team.locked_at,
        membership_role: row.role,
        is_owner: team.owner_participant_id === accountId,
      };
    });
  },
};

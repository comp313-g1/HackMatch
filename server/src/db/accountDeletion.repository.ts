import { getSupabaseClient } from './client.js';
import type {
  AccountDeletionRequest,
  CreateAccountDeletionRequestDTO,
  UpdateAccountDeletionRequestDTO,
} from './types.js';

export interface IAccountDeletionRepository {
  create(data: CreateAccountDeletionRequestDTO): Promise<AccountDeletionRequest>;
  findById(id: string): Promise<AccountDeletionRequest | null>;
  findOpenByParticipantId(participantId: string): Promise<AccountDeletionRequest | null>;
  listNewestFirst(options?: {
    status?: AccountDeletionRequest['status'];
    limit?: number;
  }): Promise<AccountDeletionRequest[]>;
  update(
    id: string,
    patch: UpdateAccountDeletionRequestDTO
  ): Promise<AccountDeletionRequest>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const accountDeletionRepository: IAccountDeletionRepository = {
  async create(data: CreateAccountDeletionRequestDTO): Promise<AccountDeletionRequest> {
    const client = getSupabaseClient();
    const { data: record, error } = await client
      .from('account_deletion_requests')
      .insert({
        participant_id: data.participant_id,
        requested_by: data.requested_by,
        reason: data.reason,
        ownership_verified: data.ownership_verified ?? false,
        ownership_verified_at: data.ownership_verified_at ?? null,
        ownership_verified_by: data.ownership_verified_by ?? null,
        status: data.status ?? 'Pending',
        blocked_reason: data.blocked_reason ?? null,
        safe_state_summary: data.safe_state_summary ?? {
          credentialsIncluded: false,
          otpsIncluded: false,
          privateNotesIncluded: false,
        },
      })
      .select('*')
      .single();

    if (error) throw error;
    return record as AccountDeletionRequest;
  },

  async findById(id: string): Promise<AccountDeletionRequest | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('account_deletion_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data as AccountDeletionRequest | null;
  },

  async findOpenByParticipantId(
    participantId: string
  ): Promise<AccountDeletionRequest | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('account_deletion_requests')
      .select('*')
      .eq('participant_id', participantId)
      .in('status', ['Pending', 'BlockedNeedsDisband', 'Processing'])
      .maybeSingle();

    if (error) throw error;
    return data as AccountDeletionRequest | null;
  },

  async listNewestFirst(options?: {
    status?: AccountDeletionRequest['status'];
    limit?: number;
  }): Promise<AccountDeletionRequest[]> {
    const client = getSupabaseClient();
    const limit = Math.min(Math.max(options?.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    let query = client
      .from('account_deletion_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as AccountDeletionRequest[];
  },

  async update(
    id: string,
    patch: UpdateAccountDeletionRequestDTO
  ): Promise<AccountDeletionRequest> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('account_deletion_requests')
      .update({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.ownership_verified !== undefined
          ? { ownership_verified: patch.ownership_verified }
          : {}),
        ...(patch.ownership_verified_at !== undefined
          ? { ownership_verified_at: patch.ownership_verified_at }
          : {}),
        ...(patch.ownership_verified_by !== undefined
          ? { ownership_verified_by: patch.ownership_verified_by }
          : {}),
        ...(patch.blocked_reason !== undefined
          ? { blocked_reason: patch.blocked_reason }
          : {}),
        ...(patch.completed_at !== undefined ? { completed_at: patch.completed_at } : {}),
        ...(patch.safe_state_summary !== undefined
          ? { safe_state_summary: patch.safe_state_summary }
          : {}),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    return data as AccountDeletionRequest;
  },
};

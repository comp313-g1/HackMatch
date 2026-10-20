import { getSupabaseClient } from './client.js';
import type {
  CreateModerationCaseDTO,
  ModerationCase,
  ModerationCaseStatus,
} from './types.js';

export interface ListModerationCasesOptions {
  status?: ModerationCaseStatus;
  limit?: number;
}

export interface IModerationRepository {
  createCase(data: CreateModerationCaseDTO): Promise<ModerationCase>;
  findById(id: string): Promise<ModerationCase | null>;
  listNewestFirst(options?: ListModerationCasesOptions): Promise<ModerationCase[]>;
}

const DEFAULT_QUEUE_LIMIT = 100;
const MAX_QUEUE_LIMIT = 200;

export const moderationRepository: IModerationRepository = {
  async createCase(data: CreateModerationCaseDTO): Promise<ModerationCase> {
    const client = getSupabaseClient();
    const { data: record, error } = await client
      .from('moderation_cases')
      .insert({
        target_type: data.target_type,
        target_id: data.target_id,
        reason: data.reason,
        created_by: data.created_by,
        flagged_url: data.flagged_url ?? null,
        report_count: data.report_count ?? 0,
        status: 'Open',
      })
      .select('*')
      .single();

    if (error) throw error;
    return record as ModerationCase;
  },

  async findById(id: string): Promise<ModerationCase | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('moderation_cases')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data as ModerationCase | null;
  },

  async listNewestFirst(options: ListModerationCasesOptions = {}): Promise<ModerationCase[]> {
    const client = getSupabaseClient();
    const limit = Math.min(
      Math.max(1, options.limit ?? DEFAULT_QUEUE_LIMIT),
      MAX_QUEUE_LIMIT
    );

    let query = client
      .from('moderation_cases')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (options.status) {
      query = query.eq('status', options.status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as ModerationCase[];
  },
};

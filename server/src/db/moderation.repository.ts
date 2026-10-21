import { getSupabaseClient } from './client.js';
import { scrubPrivateAccountFields } from '../services/accountPrivacy.js';
import { scrubPrivateModerationFields } from '../services/moderationPrivacy.js';
import type {
  CreateEventActionRecordDTO,
  CreateModerationCaseDTO,
  EventActionRecord,
  ModerationCase,
  ModerationCaseStatus,
  ModerationDecisionAction,
} from './types.js';

export interface ListModerationCasesOptions {
  status?: ModerationCaseStatus;
  limit?: number;
}

export interface ResolveModerationCaseInput {
  status: ModerationCaseStatus;
  lastActionType: ModerationDecisionAction;
  resolvedAt: string;
}

export interface IModerationRepository {
  createCase(data: CreateModerationCaseDTO): Promise<ModerationCase>;
  findById(id: string): Promise<ModerationCase | null>;
  listNewestFirst(options?: ListModerationCasesOptions): Promise<ModerationCase[]>;
  resolveCase(id: string, input: ResolveModerationCaseInput): Promise<ModerationCase>;
  insertActionRecord(data: CreateEventActionRecordDTO): Promise<EventActionRecord>;
  listActionRecordsForCase(caseId: string): Promise<EventActionRecord[]>;
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

  async resolveCase(id: string, input: ResolveModerationCaseInput): Promise<ModerationCase> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('moderation_cases')
      .update({
        status: input.status,
        last_action_type: input.lastActionType,
        resolved_at: input.resolvedAt,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    return data as ModerationCase;
  },

  async insertActionRecord(data: CreateEventActionRecordDTO): Promise<EventActionRecord> {
    const client = getSupabaseClient();
    // US-026 / #245 & US-027 / #254 — never persist credentials, OTPs, or private notes.
    const summary = data.safe_state_summary ?? {};
    const scrubbedSummary =
      typeof data.action_type === 'string' && data.action_type.startsWith('account_')
        ? scrubPrivateAccountFields(summary)
        : scrubPrivateModerationFields(summary);

    const { data: record, error } = await client
      .from('event_action_records')
      .insert({
        actor_id: data.actor_id,
        target_type: data.target_type,
        target_id: data.target_id,
        action_type: data.action_type,
        reason: data.reason,
        outcome: data.outcome,
        safe_state_summary: scrubbedSummary,
      })
      .select('*')
      .single();

    if (error) throw error;
    return record as EventActionRecord;
  },

  async listActionRecordsForCase(caseId: string): Promise<EventActionRecord[]> {
    const caseRow = await this.findById(caseId);
    if (!caseRow) return [];

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('event_action_records')
      .select('id, actor_id, target_type, target_id, action_type, reason, outcome, safe_state_summary, created_at')
      .eq('target_id', caseRow.target_id)
      .like('action_type', 'moderation_%')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    const rows = (data || []) as EventActionRecord[];
    return rows.filter((row) => {
      const summary = row.safe_state_summary as Record<string, unknown> | null;
      return summary?.caseId === caseId;
    });
  },
};

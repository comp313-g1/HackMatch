import { getSupabaseClient } from './client.js';
import {
  buildModerationReportRecord,
  type CreateModerationReportRowInput,
} from './moderationReportModel.js';
import type {
  CreateModerationReportDTO,
  ModerationReportRecord,
  ModerationReportTargetType,
} from './types.js';

export interface IModerationReportsRepository {
  createReport(
    data: CreateModerationReportDTO & { id?: string; created_at?: string | Date }
  ): Promise<ModerationReportRecord>;
  findReportById(id: string): Promise<ModerationReportRecord | null>;
  findReportsByReporterSince(
    reporterId: string,
    since: Date | string
  ): Promise<ModerationReportRecord[]>;
  findReportsByTarget(
    targetType: ModerationReportTargetType,
    targetId: string
  ): Promise<ModerationReportRecord[]>;
  findReportsByCaseId(caseId: string): Promise<ModerationReportRecord[]>;
}

const inMemoryReportsStore = new Map<string, ModerationReportRecord>();

function tryGetSupabaseFromTable() {
  try {
    const client = getSupabaseClient() as unknown as {
      from?: (table: string) => unknown;
    } | null;
    if (client && typeof client.from === 'function') {
      return client as ReturnType<typeof getSupabaseClient>;
    }
  } catch {
    // Fallback to in-memory store when Supabase env vars are not configured in unit tests
  }
  return null;
}

export function clearModerationReportsStore(): void {
  inMemoryReportsStore.clear();
}

export const moderationReportsRepository: IModerationReportsRepository = {
  async createReport(
    data: CreateModerationReportDTO & { id?: string; created_at?: string | Date }
  ): Promise<ModerationReportRecord> {
    const rowInput: CreateModerationReportRowInput = {
      id: data.id,
      reporterId: data.reporter_id,
      targetType: data.target_type,
      targetId: data.target_id,
      category: data.category,
      explanation: data.explanation ?? null,
      flaggedUrl: data.flagged_url ?? null,
      caseId: data.case_id ?? null,
      createdAt: data.created_at,
    };

    const validatedRecord = buildModerationReportRecord(rowInput);
    const client = tryGetSupabaseFromTable();

    if (client) {
      const { data: inserted, error } = await client
        .from('moderation_reports')
        .insert({
          id: validatedRecord.id,
          reporter_id: validatedRecord.reporter_id,
          target_type: validatedRecord.target_type,
          target_id: validatedRecord.target_id,
          category: validatedRecord.category,
          explanation: validatedRecord.explanation,
          flagged_url: validatedRecord.flagged_url,
          case_id: validatedRecord.case_id,
          created_at: validatedRecord.created_at,
        })
        .select('*')
        .single();

      if (error) throw error;
      if (inserted) {
        return inserted as ModerationReportRecord;
      }
    }

    inMemoryReportsStore.set(validatedRecord.id, validatedRecord);
    return validatedRecord;
  },

  async findReportById(id: string): Promise<ModerationReportRecord | null> {
    const client = tryGetSupabaseFromTable();

    if (client) {
      const { data, error } = await client
        .from('moderation_reports')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      return (data as ModerationReportRecord | null) ?? null;
    }

    return inMemoryReportsStore.get(id) ?? null;
  },

  async findReportsByReporterSince(
    reporterId: string,
    since: Date | string
  ): Promise<ModerationReportRecord[]> {
    const sinceIso =
      since instanceof Date ? since.toISOString() : new Date(since).toISOString();
    const sinceMs = new Date(sinceIso).getTime();

    const client = tryGetSupabaseFromTable();
    if (client) {
      try {
        const tableQuery = client.from('moderation_reports');
        if (tableQuery && typeof (tableQuery as unknown as { select: unknown }).select === 'function') {
          const selectQuery = tableQuery.select('*');
          if (selectQuery && typeof (selectQuery as unknown as { eq: unknown }).eq === 'function') {
            const eqQuery = selectQuery.eq('reporter_id', reporterId);
            if (eqQuery && typeof (eqQuery as unknown as { gt: unknown }).gt === 'function') {
              const { data, error } = await eqQuery
                .gt('created_at', sinceIso)
                .order('created_at', { ascending: true });

              if (!error && Array.isArray(data)) {
                return (data as ModerationReportRecord[]).sort(
                  (a, b) =>
                    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                );
              }
            }
          }
        }
      } catch {
        // Fallback to in-memory store
      }
    }

    return Array.from(inMemoryReportsStore.values())
      .filter(
        (row) =>
          row.reporter_id === reporterId &&
          new Date(row.created_at).getTime() > sinceMs
      )
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
  },

  async findReportsByTarget(
    targetType: ModerationReportTargetType,
    targetId: string
  ): Promise<ModerationReportRecord[]> {
    const client = tryGetSupabaseFromTable();
    if (client) {
      const { data, error } = await client
        .from('moderation_reports')
        .select('*')
        .eq('target_type', targetType)
        .eq('target_id', targetId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as ModerationReportRecord[];
    }

    return Array.from(inMemoryReportsStore.values())
      .filter(
        (row) => row.target_type === targetType && row.target_id === targetId
      )
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
  },

  async findReportsByCaseId(caseId: string): Promise<ModerationReportRecord[]> {
    const client = tryGetSupabaseFromTable();
    if (client) {
      const { data, error } = await client
        .from('moderation_reports')
        .select('*')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as ModerationReportRecord[];
    }

    return Array.from(inMemoryReportsStore.values())
      .filter((row) => row.case_id === caseId)
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
  },
};

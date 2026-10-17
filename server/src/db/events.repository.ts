import { getSupabaseClient } from './client.js';

export interface EventRecord {
  id: string;
  title: string;
  official_url: string;
  event_edition: string | null;
  start_date: string;
  end_date: string;
  format: string;
  location: string | null;
  min_team_size: number | null;
  max_team_size: number | null;
  is_link_disabled: boolean;
  status: 'Published' | 'Archived' | 'Disabled';
}

export interface EventListFilter {
  limit: number;
  offset: number;
}

export interface IEventsRepository {
  listPublicEvents(f: EventListFilter): Promise<{ rows: EventRecord[]; total: number }>;
  findPublicEventById(id: string): Promise<EventRecord | null>;
}

export const PUBLIC_STATUSES = ['Published', 'Archived'] as const;

export const PUBLIC_EVENT_COLUMNS =
  'id, title, official_url, event_edition, start_date, end_date, format, location, min_team_size, max_team_size, is_link_disabled, status';

export const eventsRepository: IEventsRepository = {
  async listPublicEvents(filter: EventListFilter): Promise<{ rows: EventRecord[]; total: number }> {
    const client = getSupabaseClient();
    const { data, count, error } = await client
      .from('events')
      .select(PUBLIC_EVENT_COLUMNS, { count: 'exact' })
      .in('status', [...PUBLIC_STATUSES])
      .order('start_date', { ascending: true })
      .order('id', { ascending: true })
      .range(filter.offset, filter.offset + filter.limit - 1);

    if (error) {
      throw error;
    }

    return {
      rows: (data as EventRecord[]) || [],
      total: count ?? 0,
    };
  },

  async findPublicEventById(id: string): Promise<EventRecord | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('events')
      .select(PUBLIC_EVENT_COLUMNS)
      .eq('id', id)
      .in('status', [...PUBLIC_STATUSES])
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data as EventRecord) || null;
  },
};

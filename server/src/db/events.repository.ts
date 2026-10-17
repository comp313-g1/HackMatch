import { getSupabaseClient } from './client.js';
import { escapeLikeTerm } from '../services/eventVisibility.js';

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

export type TimeState = 'upcoming' | 'ongoing' | 'concluded';

export interface EventListFilter {
  limit: number;
  offset: number;
  keyword?: string;
  format?: string;
  timeState?: TimeState;
  now?: Date;
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
    let query = client
      .from('events')
      .select(PUBLIC_EVENT_COLUMNS, { count: 'exact' })
      .in('status', [...PUBLIC_STATUSES]);

    // Keyword filter (across title and location using OR within the group)
    if (filter.keyword && filter.keyword.trim().length > 0) {
      const sanitized = escapeLikeTerm(filter.keyword.trim());
      if (sanitized.length > 0) {
        query = query.or(`title.ilike.%${sanitized}%,location.ilike.%${sanitized}%`);
      }
    }

    // Format filter (case-insensitive exact match)
    if (filter.format && filter.format.trim().length > 0) {
      const sanitized = escapeLikeTerm(filter.format.trim());
      query = query.ilike('format', sanitized);
    }

    // TimeState filter (calculated relative to reference now)
    const referenceTime = filter.now || new Date();
    const isoNow = referenceTime.toISOString();

    if (filter.timeState === 'upcoming') {
      // start_date > now
      query = query.gt('start_date', isoNow);
    } else if (filter.timeState === 'ongoing') {
      // start_date <= now AND end_date >= now AND status = 'Published'
      query = query.lte('start_date', isoNow).gte('end_date', isoNow).eq('status', 'Published');
    } else if (filter.timeState === 'concluded') {
      // end_date < now OR status = 'Archived'
      query = query.or(`end_date.lt.${isoNow},status.eq.Archived`);
    }

    const { data, count, error } = await query
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

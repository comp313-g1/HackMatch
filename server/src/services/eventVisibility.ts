import type { EventRecord } from '../db/events.repository.js';

export interface PublicEvent {
  id: string;
  title: string;
  official_url: string | null;
  link_disabled: boolean;
  event_edition: string | null;
  start_date: string;
  end_date: string;
  format: string;
  location: string | null;
  min_team_size: number | null;
  max_team_size: number | null;
  status: 'Published' | 'Archived';
  time_state: 'upcoming' | 'ongoing' | 'concluded';
}

/**
 * Derives time-state relative to an injectable reference time.
 * Upcoming: start_date > now
 * Ongoing: start_date <= now <= end_date AND status !== 'Archived'
 * Concluded: end_date < now OR status === 'Archived'
 */
export function deriveTimeState(
  event: Pick<EventRecord, 'start_date' | 'end_date' | 'status'>,
  now: Date = new Date()
): PublicEvent['time_state'] {
  if (event.status === 'Archived') {
    return 'concluded';
  }

  const startTime = new Date(event.start_date).getTime();
  const endTime = new Date(event.end_date).getTime();
  const nowTime = now.getTime();

  if (nowTime < startTime) {
    return 'upcoming';
  }
  if (nowTime <= endTime) {
    return 'ongoing';
  }
  return 'concluded';
}

/**
 * Maps an internal database EventRecord to a safe, public allow-listed DTO.
 * Explicitly sanitizes:
 * - If is_link_disabled is true, official_url is nulled.
 * - If official_url does not start with https://, official_url is nulled.
 * - Internal fields (normalized_url, created_at, updated_at) are never forwarded.
 */
export function toPublicEvent(record: EventRecord, now: Date = new Date()): PublicEvent {
  const isSafeHttps =
    typeof record.official_url === 'string' && record.official_url.startsWith('https://');

  const safeUrl = record.is_link_disabled || !isSafeHttps ? null : record.official_url;

  return {
    id: record.id,
    title: record.title,
    official_url: safeUrl,
    link_disabled: record.is_link_disabled,
    event_edition: record.event_edition,
    start_date: record.start_date,
    end_date: record.end_date,
    format: record.format,
    location: record.location,
    min_team_size: record.min_team_size,
    max_team_size: record.max_team_size,
    status: record.status as 'Published' | 'Archived',
    time_state: deriveTimeState(record, now),
  };
}

/**
 * Strips PostgREST query control characters and escapes LIKE wildcards.
 * Strips: , ( ) " \ *
 * Escapes: % -> \% and _ -> \_
 */
export function escapeLikeTerm(term: string): string {
  // Strip control characters that could break PostgREST or filter grammar
  const stripped = term.replace(/[,()"\\*]/g, '');
  // Escape LIKE pattern wildcards so user input is treated as literal text
  return stripped.replace(/[%_]/g, '\\$&');
}

/**
 * Checks whether an event status is approved for public visibility (US-008 AC 1, AC 4).
 * Only 'Published' and 'Archived' records are public. 'Disabled', 'Pending', and rejected records are hidden.
 */
export function isPubliclyVisible(status: string): boolean {
  return status === 'Published' || status === 'Archived';
}



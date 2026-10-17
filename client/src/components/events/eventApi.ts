import type { PublicEvent } from './eventTypes.js';
import { type EventFilters, buildEventQuery } from './eventFilters.js';

export class EventApiError extends Error {
  public status: number;
  public fields?: Record<string, string>;

  constructor(message: string, status: number, fields?: Record<string, string>) {
    super(message);
    this.name = 'EventApiError';
    this.status = status;
    this.fields = fields;
  }
}

export interface ListEventsResponse {
  events: PublicEvent[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Fetches public events with active filters.
 * Public endpoint — no auth token required.
 */
export async function fetchPublicEvents(
  filters: EventFilters,
  signal?: AbortSignal
): Promise<ListEventsResponse> {
  const query = buildEventQuery(filters);
  const response = await fetch(`/api/events${query}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    let errorData: { error?: string; fields?: Record<string, string> } = {};
    try {
      errorData = await response.json();
    } catch {
      // Non-JSON response
    }
    throw new EventApiError(
      errorData.error || `Failed to fetch events (HTTP ${response.status})`,
      response.status,
      errorData.fields
    );
  }

  return response.json();
}

/**
 * Fetches a single public event by UUID.
 */
export async function fetchPublicEventById(
  eventId: string,
  signal?: AbortSignal
): Promise<PublicEvent> {
  const response = await fetch(`/api/events/${encodeURIComponent(eventId)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    let errorData: { error?: string } = {};
    try {
      errorData = await response.json();
    } catch {
      // Non-JSON response
    }
    throw new EventApiError(
      errorData.error || `Failed to fetch event (HTTP ${response.status})`,
      response.status
    );
  }

  const data = await response.json();
  return data.event;
}

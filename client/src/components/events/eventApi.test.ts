import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchPublicEvents,
  fetchPublicEventById,
  EventApiError,
} from './eventApi.js';
import type { PublicEvent } from './eventTypes.js';

describe('eventApi unit tests (US-008 / #73)', () => {
  const sampleEvent: PublicEvent = {
    id: 'e1000000-0000-4000-8000-000000000001',
    title: 'Hack The North 2026',
    official_url: 'https://hackthenorth.com',
    link_disabled: false,
    event_edition: '2026',
    start_date: '2026-09-18T18:00:00.000Z',
    end_date: '2026-09-20T18:00:00.000Z',
    format: 'In-Person',
    location: 'Waterloo, ON',
    min_team_size: 1,
    max_team_size: 4,
    status: 'Published',
    time_state: 'upcoming',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchPublicEvents queries /api/events with built query params', async () => {
    const mockJson = {
      events: [sampleEvent],
      total: 1,
      limit: 20,
      offset: 0,
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockJson,
    } as unknown as Response);

    const result = await fetchPublicEvents({
      keyword: 'north',
      format: 'In-Person',
      timeState: 'upcoming',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/events?q=north&format=In-Person&timeState=upcoming',
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe(sampleEvent.id);
  });

  it('fetchPublicEvents throws EventApiError with status and fields on 400', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'Invalid query parameters',
        fields: { format: 'Format must be one of: In-Person, Virtual, Hybrid' },
      }),
    } as unknown as Response);

    await expect(
      fetchPublicEvents({
        keyword: '',
        format: 'BadFormat',
        timeState: '',
      })
    ).rejects.toThrow(EventApiError);

    try {
      await fetchPublicEvents({
        keyword: '',
        format: 'BadFormat',
        timeState: '',
      });
    } catch (err) {
      const apiErr = err as EventApiError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.fields?.format).toBe('Format must be one of: In-Person, Virtual, Hybrid');
    }
  });

  it('fetchPublicEventById returns event on 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ event: sampleEvent }),
    } as unknown as Response);

    const result = await fetchPublicEventById(sampleEvent.id);
    expect(result.id).toBe(sampleEvent.id);
  });

  it('fetchPublicEventById throws EventApiError on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Event not found' }),
    } as unknown as Response);

    await expect(fetchPublicEventById('unknown-id')).rejects.toThrow(EventApiError);
  });
});

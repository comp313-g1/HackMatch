import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { eventsRepository, type EventRecord } from '../db/events.repository.js';

describe('Public Express Event List and Detail Endpoints (US-008 / #72)', () => {
  const publishedRecord: EventRecord = {
    id: 'e1000000-0000-4000-8000-000000000001',
    title: 'Hack The North 2026',
    official_url: 'https://hackthenorth.com',
    event_edition: '2026',
    start_date: '2026-09-18T18:00:00.000Z',
    end_date: '2026-09-20T18:00:00.000Z',
    format: 'In-Person',
    location: 'Waterloo, ON',
    min_team_size: 1,
    max_team_size: 4,
    is_link_disabled: false,
    status: 'Published',
  };

  const archivedRecord: EventRecord = {
    id: 'e1000000-0000-4000-8000-000000000002',
    title: 'Hack The North 2025',
    official_url: 'https://archive.hackthenorth.com',
    event_edition: '2025',
    start_date: '2025-09-18T18:00:00.000Z',
    end_date: '2025-09-20T18:00:00.000Z',
    format: 'In-Person',
    location: 'Waterloo, ON',
    min_team_size: 1,
    max_team_size: 4,
    is_link_disabled: false,
    status: 'Archived',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /api/events succeeds with 200 without requiring authentication headers', async () => {
    vi.spyOn(eventsRepository, 'listPublicEvents').mockResolvedValue({
      rows: [publishedRecord, archivedRecord],
      total: 2,
    });

    const res = await request(app).get('/api/events');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.limit).toBe(20);
    expect(res.body.offset).toBe(0);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events).toHaveLength(2);
    expect(res.body.events[0]).toMatchObject({
      id: publishedRecord.id,
      title: publishedRecord.title,
      official_url: publishedRecord.official_url,
      link_disabled: false,
      status: 'Published',
    });
    // Ensure no internal timestamps or normalized_url leaked
    expect(res.body.events[0].normalized_url).toBeUndefined();
    expect(res.body.events[0].created_at).toBeUndefined();
  });

  it('GET /api/events returns empty array when no events match', async () => {
    vi.spyOn(eventsRepository, 'listPublicEvents').mockResolvedValue({
      rows: [],
      total: 0,
    });

    const res = await request(app).get('/api/events');

    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('GET /api/events/:eventId returns 200 with public event details', async () => {
    vi.spyOn(eventsRepository, 'findPublicEventById').mockResolvedValue(publishedRecord);

    const res = await request(app).get(`/api/events/${publishedRecord.id}`);

    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({
      id: publishedRecord.id,
      title: publishedRecord.title,
      official_url: publishedRecord.official_url,
      format: 'In-Person',
      location: 'Waterloo, ON',
      min_team_size: 1,
      max_team_size: 4,
    });
  });

  it('GET /api/events/:eventId returns 404 when event is not found or not published/archived', async () => {
    vi.spyOn(eventsRepository, 'findPublicEventById').mockResolvedValue(null);

    const res = await request(app).get('/api/events/e1000000-0000-4000-8000-000000000999');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Event not found' });
  });

  it('GET /api/events/:eventId returns 400 when event ID is not a valid UUID', async () => {
    const res = await request(app).get('/api/events/invalid-uuid-123');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid event id' });
  });

  it('GET /api/events/:eventId hides official_url when is_link_disabled is true', async () => {
    vi.spyOn(eventsRepository, 'findPublicEventById').mockResolvedValue({
      ...publishedRecord,
      is_link_disabled: true,
    });

    const res = await request(app).get(`/api/events/${publishedRecord.id}`);

    expect(res.status).toBe(200);
    expect(res.body.event.official_url).toBeNull();
    expect(res.body.event.link_disabled).toBe(true);
  });

  it('returns generic 500 without leaking database details when repository throws', async () => {
    vi.spyOn(eventsRepository, 'listPublicEvents').mockRejectedValue(
      new Error('FATAL: connection pool exhausted at postgresql://...')
    );

    const res = await request(app).get('/api/events');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal Server Error');
    expect(res.body.message).toBeUndefined();
  });
});

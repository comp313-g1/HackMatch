import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { eventsRepository, type EventRecord, type EventListFilter } from '../db/events.repository.js';

describe('US-008 Event Discovery End-to-End Integration Tests (Task 7 / #78)', () => {
  const refNow = new Date('2026-06-05T12:00:00.000Z');

  const dataset: EventRecord[] = [
    {
      id: 'e1000000-0000-4000-8000-000000000001',
      title: 'Waterloo Hackathon 2026',
      official_url: 'https://waterloohacks.com',
      event_edition: '2026',
      start_date: '2026-10-01T00:00:00.000Z',
      end_date: '2026-10-03T00:00:00.000Z',
      format: 'In-Person',
      location: 'Waterloo, ON',
      min_team_size: 2,
      max_team_size: 4,
      is_link_disabled: false,
      status: 'Published',
    },
    {
      id: 'e1000000-0000-4000-8000-000000000002',
      title: 'Global Virtual AI Hackathon',
      official_url: 'https://aihack.global',
      event_edition: '2026',
      start_date: '2026-06-01T00:00:00.000Z',
      end_date: '2026-06-10T00:00:00.000Z',
      format: 'Virtual',
      location: 'Online Everywhere',
      min_team_size: 1,
      max_team_size: 5,
      is_link_disabled: false,
      status: 'Published',
    },
    {
      id: 'e1000000-0000-4000-8000-000000000003',
      title: 'Winter Hybrid Hackathon 2026',
      official_url: 'https://winterhack.ca',
      event_edition: '2026',
      start_date: '2026-01-10T00:00:00.000Z',
      end_date: '2026-01-12T00:00:00.000Z',
      format: 'Hybrid',
      location: 'Montreal, QC',
      min_team_size: null,
      max_team_size: null,
      is_link_disabled: false,
      status: 'Published',
    },
    {
      id: 'e1000000-0000-4000-8000-000000000004',
      title: 'Legacy Hackathon 2025',
      official_url: 'https://legacyhack.com',
      event_edition: '2025',
      start_date: '2025-05-01T00:00:00.000Z',
      end_date: '2025-05-03T00:00:00.000Z',
      format: 'In-Person',
      location: 'Toronto, ON',
      min_team_size: 1,
      max_team_size: 4,
      is_link_disabled: false,
      status: 'Archived',
    },
    {
      id: 'e1000000-0000-4000-8000-000000000005',
      title: 'Suspended Phishing Hackathon',
      official_url: 'https://phishinghack.evil',
      event_edition: '2026',
      start_date: '2026-10-10T00:00:00.000Z',
      end_date: '2026-10-12T00:00:00.000Z',
      format: 'Virtual',
      location: 'Online',
      min_team_size: 1,
      max_team_size: 2,
      is_link_disabled: false,
      status: 'Disabled',
    },
    {
      id: 'e1000000-0000-4000-8000-000000000006',
      title: 'Compromised Link Event',
      official_url: 'https://compromised-site.com',
      event_edition: '2026',
      start_date: '2026-11-01T00:00:00.000Z',
      end_date: '2026-11-03T00:00:00.000Z',
      format: 'In-Person',
      location: 'Ottawa, ON',
      min_team_size: 2,
      max_team_size: 5,
      is_link_disabled: true,
      status: 'Published',
    },
    {
      id: 'e1000000-0000-4000-8000-000000000007',
      title: 'Insecure Protocol Event',
      official_url: 'http://insecure-site.com',
      event_edition: '2026',
      start_date: '2026-12-01T00:00:00.000Z',
      end_date: '2026-12-03T00:00:00.000Z',
      format: 'Virtual',
      location: null,
      min_team_size: null,
      max_team_size: null,
      is_link_disabled: false,
      status: 'Published',
    },
  ];

  // In-memory fake repository implementation faithfully reproducing database filtering logic
  function createInMemoryRepository(records: EventRecord[]) {
    return {
      async listPublicEvents(filter: EventListFilter) {
        const now = filter.now ?? new Date();

        let filtered = records.filter(
          (r) => r.status === 'Published' || r.status === 'Archived'
        );

        if (filter.keyword && filter.keyword.trim().length > 0) {
          const kw = filter.keyword.trim().toLowerCase();
          filtered = filtered.filter(
            (r) =>
              r.title.toLowerCase().includes(kw) ||
              (r.location && r.location.toLowerCase().includes(kw))
          );
        }

        if (filter.format && filter.format.trim().length > 0) {
          const fmt = filter.format.trim().toLowerCase();
          filtered = filtered.filter((r) => r.format.toLowerCase() === fmt);
        }

        if (filter.timeState) {
          filtered = filtered.filter((r) => {
            const start = new Date(r.start_date).getTime();
            const end = new Date(r.end_date).getTime();
            const n = now.getTime();

            if (filter.timeState === 'upcoming') {
              return start > n;
            }
            if (filter.timeState === 'ongoing') {
              return start <= n && end >= n && r.status === 'Published';
            }
            if (filter.timeState === 'concluded') {
              return end < n || r.status === 'Archived';
            }
            return true;
          });
        }

        // Order by start_date asc then id asc
        filtered.sort((a, b) => {
          const cmp = new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
          return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
        });

        const total = filtered.length;
        const rows = filtered.slice(filter.offset, filter.offset + filter.limit);

        return { rows, total };
      },

      async findPublicEventById(id: string) {
        const found = records.find(
          (r) => r.id === id && (r.status === 'Published' || r.status === 'Archived')
        );
        return found ?? null;
      },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(refNow);

    const fakeRepo = createInMemoryRepository(dataset);
    vi.spyOn(eventsRepository, 'listPublicEvents').mockImplementation(fakeRepo.listPublicEvents);
    vi.spyOn(eventsRepository, 'findPublicEventById').mockImplementation(fakeRepo.findPublicEventById);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // 1. Happy path: list, detail, and multi-filter combinations
  describe('Happy path & combined filters', () => {
    it('returns all public events with derived time_state and default pagination', async () => {
      const res = await request(app).get('/api/events');

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(6); // 7 records minus 1 Disabled
      expect(res.body.events).toHaveLength(6);
      expect(res.body.limit).toBe(20);
      expect(res.body.offset).toBe(0);

      // Verify Waterloo Hackathon 2026 is upcoming relative to 2026-06-05
      const waterloo = res.body.events.find((e: { title: string }) => e.title.includes('Waterloo'));
      expect(waterloo).toBeDefined();
      expect(waterloo.time_state).toBe('upcoming');

      // Verify Global Virtual AI Hackathon is ongoing (2026-06-01 to 2026-06-10)
      const aiHack = res.body.events.find((e: { title: string }) => e.title.includes('AI Hackathon'));
      expect(aiHack).toBeDefined();
      expect(aiHack.time_state).toBe('ongoing');

      // Verify Winter Hybrid is concluded (ended 2026-01-12)
      const winter = res.body.events.find((e: { title: string }) => e.title.includes('Winter Hybrid'));
      expect(winter).toBeDefined();
      expect(winter.time_state).toBe('concluded');

      // Verify Archived event is concluded
      const legacy = res.body.events.find((e: { title: string }) => e.title.includes('Legacy'));
      expect(legacy).toBeDefined();
      expect(legacy.time_state).toBe('concluded');
    });

    it('filters by keyword, format, and timeState combined with AND logic', async () => {
      const res = await request(app).get(
        '/api/events?q=Waterloo&format=in-person&timeState=upcoming'
      );

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.events[0].id).toBe('e1000000-0000-4000-8000-000000000001');
      expect(res.body.events[0].title).toBe('Waterloo Hackathon 2026');
    });

    it('GET /api/events/:eventId returns public event detail with 200', async () => {
      const res = await request(app).get('/api/events/e1000000-0000-4000-8000-000000000001');

      expect(res.status).toBe(200);
      expect(res.body.event).toMatchObject({
        id: 'e1000000-0000-4000-8000-000000000001',
        title: 'Waterloo Hackathon 2026',
        official_url: 'https://waterloohacks.com',
        format: 'In-Person',
        time_state: 'upcoming',
      });
    });
  });

  // 2. Invalid inputs and validation error schema
  describe('Invalid input validation', () => {
    it('returns 400 with field errors for invalid format', async () => {
      const res = await request(app).get('/api/events?format=Onsite');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid query parameters');
      expect(res.body.fields.format).toBeDefined();
    });

    it('returns 400 with field errors for invalid timeState', async () => {
      const res = await request(app).get('/api/events?timeState=yesterday');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid query parameters');
      expect(res.body.fields.timeState).toBeDefined();
    });

    it('returns 400 for negative offset or out-of-range limit', async () => {
      const res = await request(app).get('/api/events?limit=100&offset=-1');

      expect(res.status).toBe(400);
      expect(res.body.fields.limit).toBeDefined();
      expect(res.body.fields.offset).toBeDefined();
    });

    it('returns 400 for non-UUID eventId parameter', async () => {
      const res = await request(app).get('/api/events/not-a-uuid');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid event id');
    });

    it('accepts case-insensitive format and canonicalizes it', async () => {
      const res = await request(app).get('/api/events?format=vIrTuAl');

      expect(res.status).toBe(200);
      expect(res.body.events.every((e: { format: string }) => e.format === 'Virtual')).toBe(true);
    });
  });

  // 3. Unauthorized access & header isolation
  describe('Public endpoint access', () => {
    it('succeeds without Authorization header and ignores bogus tokens without rejecting 401', async () => {
      const resWithNoAuth = await request(app).get('/api/events');
      expect(resWithNoAuth.status).toBe(200);

      const resWithBogusAuth = await request(app)
        .get('/api/events')
        .set('Authorization', 'Bearer invalid-token-12345');
      expect(resWithBogusAuth.status).toBe(200);
    });
  });

  // 4. Boundaries
  describe('Boundary conditions', () => {
    it('handles exact boundary where now == start_date as ongoing', async () => {
      // Set time exactly to start_date of Waterloo hackathon: 2026-10-01T00:00:00.000Z
      vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));

      const res = await request(app).get(
        '/api/events/e1000000-0000-4000-8000-000000000001'
      );

      expect(res.status).toBe(200);
      expect(res.body.event.time_state).toBe('ongoing');
    });

    it('handles exact boundary where now == end_date as ongoing', async () => {
      // Set time exactly to end_date of Waterloo hackathon: 2026-10-03T00:00:00.000Z
      vi.setSystemTime(new Date('2026-10-03T00:00:00.000Z'));

      const res = await request(app).get(
        '/api/events/e1000000-0000-4000-8000-000000000001'
      );

      expect(res.status).toBe(200);
      expect(res.body.event.time_state).toBe('ongoing');
    });

    it('handles boundary where limit=1 and limit=50', async () => {
      const resLimit1 = await request(app).get('/api/events?limit=1');
      expect(resLimit1.status).toBe(200);
      expect(resLimit1.body.events).toHaveLength(1);
      expect(resLimit1.body.limit).toBe(1);

      const resLimit50 = await request(app).get('/api/events?limit=50');
      expect(resLimit50.status).toBe(200);
      expect(resLimit50.body.limit).toBe(50);
    });

    it('returns empty list when offset is beyond available total', async () => {
      const res = await request(app).get('/api/events?offset=1000');
      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(0);
      expect(res.body.total).toBe(6);
    });
  });

  // 5. Visibility and security leak prevention
  describe('Data visibility and sanitization', () => {
    it('never exposes Disabled events in the list', async () => {
      const res = await request(app).get('/api/events');

      expect(res.status).toBe(200);
      const disabledEvent = res.body.events.find(
        (e: { id: string }) => e.id === 'e1000000-0000-4000-8000-000000000005'
      );
      expect(disabledEvent).toBeUndefined();
    });

    it('returns 404 for Disabled event by id without confirming existence', async () => {
      const res = await request(app).get('/api/events/e1000000-0000-4000-8000-000000000005');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Event not found' });
    });

    it('nulls official_url when is_link_disabled is true', async () => {
      const res = await request(app).get('/api/events/e1000000-0000-4000-8000-000000000006');

      expect(res.status).toBe(200);
      expect(res.body.event.link_disabled).toBe(true);
      expect(res.body.event.official_url).toBeNull();
    });

    it('defensively nulls official_url when database record has insecure non-HTTPS URL', async () => {
      const res = await request(app).get('/api/events/e1000000-0000-4000-8000-000000000007');

      expect(res.status).toBe(200);
      expect(res.body.event.official_url).toBeNull();
    });

    it('never leaks internal database columns (created_at, updated_at, normalized_url)', async () => {
      const res = await request(app).get('/api/events/e1000000-0000-4000-8000-000000000001');

      expect(res.status).toBe(200);
      const keys = Object.keys(res.body.event);
      expect(keys).not.toContain('created_at');
      expect(keys).not.toContain('updated_at');
      expect(keys).not.toContain('normalized_url');
    });
  });

  // 6. Injection hardening (NR-010)
  describe('Filter injection hardening (NR-010)', () => {
    it('handles SQL and PostgREST injection characters safely without 500 error', async () => {
      const res = await request(app).get(
        "/api/events?q=Waterloo%27%3B+DROP+TABLE+events%3B--%2C()%22%5C*&format=in-person"
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.events)).toBe(true);
    });
  });

  // 7. Failure handling
  describe('Failure handling', () => {
    it('returns generic 500 without leaking database error messages when repository throws', async () => {
      vi.spyOn(eventsRepository, 'listPublicEvents').mockRejectedValueOnce(
        new Error('FATAL: connection pool failed to reach postgres://user:secret@db.internal:5432')
      );

      const res = await request(app).get('/api/events');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal Server Error' });
    });
  });
});

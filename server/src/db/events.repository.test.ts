import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { eventsRepository, type EventRecord } from './events.repository.js';
import * as clientModule from './client.js';

describe('eventsRepository unit tests (US-008 / #72, #73)', () => {
  const sampleRecord: EventRecord = {
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

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('listPublicEvents selects only from events table with Published/Archived status', async () => {
    const mockRange = vi.fn().mockResolvedValue({
      data: [sampleRecord],
      count: 1,
      error: null,
    });
    const mockOrder2 = vi.fn().mockReturnValue({ range: mockRange });
    const mockOrder1 = vi.fn().mockReturnValue({ order: mockOrder2 });
    const mockIn = vi.fn().mockReturnValue({ order: mockOrder1 });
    const mockSelect = vi.fn().mockReturnValue({ in: mockIn });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      from: mockFrom,
    } as unknown as SupabaseClient);

    const result = await eventsRepository.listPublicEvents({ limit: 20, offset: 0 });

    expect(mockFrom).toHaveBeenCalledWith('events');
    expect(mockIn).toHaveBeenCalledWith('status', ['Published', 'Archived']);
    expect(mockOrder1).toHaveBeenCalledWith('start_date', { ascending: true });
    expect(mockOrder2).toHaveBeenCalledWith('id', { ascending: true });
    expect(mockRange).toHaveBeenCalledWith(0, 19);
    expect(result.rows).toEqual([sampleRecord]);
    expect(result.total).toBe(1);
  });

  it('applies keyword, format, and upcoming timeState filters correctly', async () => {
    const mockRange = vi.fn().mockResolvedValue({
      data: [sampleRecord],
      count: 1,
      error: null,
    });
    const mockOrder2 = vi.fn().mockReturnValue({ range: mockRange });
    const mockOrder1 = vi.fn().mockReturnValue({ order: mockOrder2 });
    const mockGt = vi.fn().mockReturnValue({ order: mockOrder1 });
    const mockIlike = vi.fn().mockReturnValue({ gt: mockGt });
    const mockOr = vi.fn().mockReturnValue({ ilike: mockIlike });
    const mockIn = vi.fn().mockReturnValue({ or: mockOr });
    const mockSelect = vi.fn().mockReturnValue({ in: mockIn });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      from: mockFrom,
    } as unknown as SupabaseClient);

    const refNow = new Date('2026-09-01T00:00:00.000Z');
    await eventsRepository.listPublicEvents({
      limit: 10,
      offset: 5,
      keyword: 'Hack, North%',
      format: 'In-Person',
      timeState: 'upcoming',
      now: refNow,
    });

    // Verify comma is stripped and percent is escaped in keyword
    expect(mockOr).toHaveBeenCalledWith('title.ilike.%Hack North\\%%,location.ilike.%Hack North\\%%');
    expect(mockIlike).toHaveBeenCalledWith('format', 'In-Person');
    expect(mockGt).toHaveBeenCalledWith('start_date', refNow.toISOString());
    expect(mockRange).toHaveBeenCalledWith(5, 14);
  });

  it('applies ongoing timeState filters with lte and gte', async () => {
    const mockRange = vi.fn().mockResolvedValue({ data: [], count: 0, error: null });
    const mockOrder2 = vi.fn().mockReturnValue({ range: mockRange });
    const mockOrder1 = vi.fn().mockReturnValue({ order: mockOrder2 });
    const mockEqStatus = vi.fn().mockReturnValue({ order: mockOrder1 });
    const mockGte = vi.fn().mockReturnValue({ eq: mockEqStatus });
    const mockLte = vi.fn().mockReturnValue({ gte: mockGte });
    const mockIn = vi.fn().mockReturnValue({ lte: mockLte });
    const mockSelect = vi.fn().mockReturnValue({ in: mockIn });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      from: mockFrom,
    } as unknown as SupabaseClient);

    const refNow = new Date('2026-09-19T00:00:00.000Z');
    await eventsRepository.listPublicEvents({
      limit: 20,
      offset: 0,
      timeState: 'ongoing',
      now: refNow,
    });

    expect(mockLte).toHaveBeenCalledWith('start_date', refNow.toISOString());
    expect(mockGte).toHaveBeenCalledWith('end_date', refNow.toISOString());
    expect(mockEqStatus).toHaveBeenCalledWith('status', 'Published');
  });

  it('applies concluded timeState filters with or on end_date and status', async () => {
    const mockRange = vi.fn().mockResolvedValue({ data: [], count: 0, error: null });
    const mockOrder2 = vi.fn().mockReturnValue({ range: mockRange });
    const mockOrder1 = vi.fn().mockReturnValue({ order: mockOrder2 });
    const mockOr = vi.fn().mockReturnValue({ order: mockOrder1 });
    const mockIn = vi.fn().mockReturnValue({ or: mockOr });
    const mockSelect = vi.fn().mockReturnValue({ in: mockIn });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      from: mockFrom,
    } as unknown as SupabaseClient);

    const refNow = new Date('2026-09-25T00:00:00.000Z');
    await eventsRepository.listPublicEvents({
      limit: 20,
      offset: 0,
      timeState: 'concluded',
      now: refNow,
    });

    expect(mockOr).toHaveBeenCalledWith(`end_date.lt.${refNow.toISOString()},status.eq.Archived`);
  });

  it('findPublicEventById finds verified event matching UUID', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: sampleRecord,
      error: null,
    });
    const mockIn = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockEq = vi.fn().mockReturnValue({ in: mockIn });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      from: mockFrom,
    } as unknown as SupabaseClient);

    const result = await eventsRepository.findPublicEventById(sampleRecord.id);

    expect(mockFrom).toHaveBeenCalledWith('events');
    expect(mockEq).toHaveBeenCalledWith('id', sampleRecord.id);
    expect(mockIn).toHaveBeenCalledWith('status', ['Published', 'Archived']);
    expect(result).toEqual(sampleRecord);
  });

  it('throws when supabase client encounters a database error', async () => {
    const dbError = new Error('Database connection failed');
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: dbError,
    });
    const mockIn = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockEq = vi.fn().mockReturnValue({ in: mockIn });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      from: mockFrom,
    } as unknown as SupabaseClient);

    await expect(eventsRepository.findPublicEventById(sampleRecord.id)).rejects.toThrow(dbError);
  });
});

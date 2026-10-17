import { describe, it, expect, vi } from 'vitest';
import { parseEventListQuery, validateEventIdParam } from './event.validator.js';
import type { Request, Response } from 'express';

describe('event.validator unit tests (US-008 / #73)', () => {
  it('parses empty query with default limit=20 and offset=0', () => {
    const result = parseEventListQuery({});
    expect(result).toEqual({
      ok: true,
      filter: {
        limit: 20,
        offset: 0,
      },
    });
  });

  it('parses valid keyword, format, timeState, limit, and offset', () => {
    const result = parseEventListQuery({
      q: '  hackathon   toronto  ',
      format: 'hybrid',
      timeState: 'UPCOMING',
      limit: '15',
      offset: '30',
    });

    expect(result).toEqual({
      ok: true,
      filter: {
        keyword: 'hackathon toronto',
        format: 'Hybrid', // canonicalized to 'Hybrid'
        timeState: 'upcoming',
        limit: 15,
        offset: 30,
      },
    });
  });

  it('truncates keyword longer than 100 characters', () => {
    const longKeyword = 'a'.repeat(120);
    const result = parseEventListQuery({ q: longKeyword });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filter.keyword).toHaveLength(100);
    }
  });

  it('rejects invalid limit values outside 1-50 or non-integer', () => {
    const resLow = parseEventListQuery({ limit: '0' });
    expect(resLow.ok).toBe(false);
    if (!resLow.ok) {
      expect(resLow.fields.limit).toBe('Limit must be an integer between 1 and 50');
    }

    const resHigh = parseEventListQuery({ limit: '51' });
    expect(resHigh.ok).toBe(false);

    const resStr = parseEventListQuery({ limit: 'abc' });
    expect(resStr.ok).toBe(false);
  });

  it('rejects invalid offset', () => {
    const res = parseEventListQuery({ offset: '-1' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.fields.offset).toBe('Offset must be a non-negative integer');
    }
  });

  it('rejects unapproved format values', () => {
    const res = parseEventListQuery({ format: 'Onsite' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.fields.format).toBe('Format must be one of: In-Person, Virtual, Hybrid');
    }
  });

  it('rejects unapproved timeState values', () => {
    const res = parseEventListQuery({ timeState: 'future' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.fields.timeState).toBe(
        'Time state must be one of: upcoming, ongoing, concluded'
      );
    }
  });

  it('rejects array query parameters', () => {
    const res = parseEventListQuery({
      q: ['keyword1', 'keyword2'],
      format: ['Virtual', 'Hybrid'],
    } as unknown as Record<string, unknown>);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.fields.q).toBe('Keyword must be a single string');
      expect(res.fields.format).toBe('Format must be one of: In-Person, Virtual, Hybrid');
    }
  });

  it('validateEventIdParam passes on valid UUID and rejects invalid UUID', () => {
    const mockNext = vi.fn();
    const mockStatus = vi.fn().mockReturnThis();
    const mockJson = vi.fn();
    const res = { status: mockStatus, json: mockJson } as unknown as Response;

    const reqValid = { params: { eventId: 'e1000000-0000-4000-8000-000000000001' } } as unknown as Request;
    validateEventIdParam(reqValid, res, mockNext);
    expect(mockNext).toHaveBeenCalled();

    const reqInvalid = { params: { eventId: 'not-a-uuid' } } as unknown as Request;
    validateEventIdParam(reqInvalid, res, mockNext);
    expect(mockStatus).toHaveBeenCalledWith(400);
    expect(mockJson).toHaveBeenCalledWith({ error: 'Invalid event id' });
  });
});

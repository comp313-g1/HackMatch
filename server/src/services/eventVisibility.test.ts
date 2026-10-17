import { describe, it, expect } from 'vitest';
import { deriveTimeState, toPublicEvent } from './eventVisibility.js';
import type { EventRecord } from '../db/events.repository.js';

describe('eventVisibility service unit tests (US-008 / #72)', () => {
  const baseRecord: EventRecord = {
    id: 'e1000000-0000-4000-8000-000000000001',
    title: 'Hack The Valley',
    official_url: 'https://hackthevalley.io',
    event_edition: '9',
    start_date: '2026-10-20T10:00:00.000Z',
    end_date: '2026-10-22T18:00:00.000Z',
    format: 'Hybrid',
    location: 'Toronto, ON',
    min_team_size: 2,
    max_team_size: 4,
    is_link_disabled: false,
    status: 'Published',
  };

  it('derives upcoming when reference time is before start_date', () => {
    const now = new Date('2026-10-15T12:00:00.000Z');
    expect(deriveTimeState(baseRecord, now)).toBe('upcoming');
  });

  it('derives ongoing when reference time is between start_date and end_date', () => {
    const now = new Date('2026-10-21T12:00:00.000Z');
    expect(deriveTimeState(baseRecord, now)).toBe('ongoing');
  });

  it('derives ongoing when reference time exactly matches start_date or end_date', () => {
    expect(deriveTimeState(baseRecord, new Date('2026-10-20T10:00:00.000Z'))).toBe('ongoing');
    expect(deriveTimeState(baseRecord, new Date('2026-10-22T18:00:00.000Z'))).toBe('ongoing');
  });

  it('derives concluded when reference time is after end_date', () => {
    const now = new Date('2026-10-22T18:00:01.000Z');
    expect(deriveTimeState(baseRecord, now)).toBe('concluded');
  });

  it('derives concluded when status is Archived even if dates are in future', () => {
    const archivedRecord = { ...baseRecord, status: 'Archived' as const };
    const now = new Date('2026-10-15T12:00:00.000Z');
    expect(deriveTimeState(archivedRecord, now)).toBe('concluded');
  });

  it('toPublicEvent strips internal fields and preserves safe public fields', () => {
    const publicEvent = toPublicEvent(baseRecord, new Date('2026-10-15T12:00:00.000Z'));
    expect(publicEvent).toEqual({
      id: baseRecord.id,
      title: baseRecord.title,
      official_url: baseRecord.official_url,
      link_disabled: false,
      event_edition: baseRecord.event_edition,
      start_date: baseRecord.start_date,
      end_date: baseRecord.end_date,
      format: baseRecord.format,
      location: baseRecord.location,
      min_team_size: baseRecord.min_team_size,
      max_team_size: baseRecord.max_team_size,
      status: 'Published',
      time_state: 'upcoming',
    });
    expect((publicEvent as unknown as Record<string, unknown>).normalized_url).toBeUndefined();
    expect((publicEvent as unknown as Record<string, unknown>).created_at).toBeUndefined();
  });

  it('toPublicEvent nulls official_url when is_link_disabled is true', () => {
    const disabledRecord = { ...baseRecord, is_link_disabled: true };
    const publicEvent = toPublicEvent(disabledRecord);
    expect(publicEvent.official_url).toBeNull();
    expect(publicEvent.link_disabled).toBe(true);
  });

  it('toPublicEvent nulls official_url if non-HTTPS URL exists', () => {
    const insecureRecord = { ...baseRecord, official_url: 'http://insecure.com' };
    const publicEvent = toPublicEvent(insecureRecord);
    expect(publicEvent.official_url).toBeNull();
  });
});

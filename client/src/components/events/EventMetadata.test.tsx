import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventMetadata } from './EventMetadata.js';
import {
  formatEventDates,
  formatTeamLimits,
} from './eventFormatters.js';
import type { PublicEvent } from './eventTypes.js';

describe('EventMetadata component unit tests (US-008 / #75)', () => {
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

  it('renders verified badge, format, title, edition, and formatted metadata fields', () => {
    render(<EventMetadata event={sampleEvent} />);

    expect(screen.getByText(/✓ verified record/i)).toBeInTheDocument();
    expect(screen.getByText('Hack The North 2026')).toBeInTheDocument();
    expect(screen.getByText(/edition: 2026/i)).toBeInTheDocument();
    expect(screen.getAllByText('In-Person')).toHaveLength(2);
    expect(screen.getByText('Waterloo, ON')).toBeInTheDocument();
    expect(screen.getByText('1–4 members')).toBeInTheDocument();
  });

  it('renders Archived badge when status is Archived', () => {
    const archivedEvent: PublicEvent = {
      ...sampleEvent,
      status: 'Archived',
      time_state: 'concluded',
    };
    render(<EventMetadata event={archivedEvent} />);

    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByText('Concluded')).toBeInTheDocument();
  });

  describe('formatEventDates helper', () => {
    it('formats date ranges properly', () => {
      const formatted = formatEventDates(
        '2026-09-18T18:00:00.000Z',
        '2026-09-20T18:00:00.000Z'
      );
      expect(formatted).toMatch(/Sep 18, 2026 – Sep 20, 2026/);
    });

    it('returns Date unavailable gracefully on malformed dates', () => {
      expect(formatEventDates('invalid', 'dates')).toBe('Date unavailable');
    });
  });

  describe('formatTeamLimits helper', () => {
    it('formats min and max combinations properly', () => {
      expect(formatTeamLimits(2, 5)).toBe('2–5 members');
      expect(formatTeamLimits(4, 4)).toBe('4 members');
      expect(formatTeamLimits(1, 1)).toBe('1 member');
      expect(formatTeamLimits(2, null)).toBe('At least 2 members');
      expect(formatTeamLimits(null, 5)).toBe('Up to 5 members');
      expect(formatTeamLimits(null, null)).toBe('Not specified');
    });
  });
});

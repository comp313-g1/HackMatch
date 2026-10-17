import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EventDirectory } from './EventDirectory.js';
import * as eventApiModule from './eventApi.js';
import type { PublicEvent } from './eventTypes.js';

describe('EventDirectory component unit tests (US-008 / #74)', () => {
  const sampleEvents: PublicEvent[] = [
    {
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
    },
    {
      id: 'e1000000-0000-4000-8000-000000000002',
      title: 'Global AI Hackathon',
      official_url: 'https://globalaihack.io',
      link_disabled: false,
      event_edition: 'Fall',
      start_date: '2026-10-10T10:00:00.000Z',
      end_date: '2026-10-12T18:00:00.000Z',
      format: 'Virtual',
      location: null,
      min_team_size: 2,
      max_team_size: 5,
      status: 'Published',
      time_state: 'upcoming',
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('renders loading state initially and then displays hackathon cards', async () => {
    vi.spyOn(eventApiModule, 'fetchPublicEvents').mockResolvedValue({
      events: sampleEvents,
      total: 2,
      limit: 20,
      offset: 0,
    });

    render(<EventDirectory />);

    // Check loading indicator in polite aria-live region
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);

    // Wait for cards to render
    await waitFor(() => {
      expect(screen.getByText('Hack The North 2026')).toBeInTheDocument();
      expect(screen.getByText('Global AI Hackathon')).toBeInTheDocument();
    });

    expect(screen.getByRole('status')).toHaveTextContent('2 hackathons found');
  });

  it('displays empty state when no events exist and no filters are active', async () => {
    vi.spyOn(eventApiModule, 'fetchPublicEvents').mockResolvedValue({
      events: [],
      total: 0,
      limit: 20,
      offset: 0,
    });

    render(<EventDirectory />);

    await waitFor(() => {
      expect(screen.getByText('No upcoming hackathons yet.')).toBeInTheDocument();
    });
    expect(screen.getByRole('status')).toHaveTextContent('0 hackathons found');
  });

  it('displays filter-specific empty state with clear filters button when search yields no matches', async () => {
    vi.spyOn(eventApiModule, 'fetchPublicEvents').mockResolvedValue({
      events: [],
      total: 0,
      limit: 20,
      offset: 0,
    });

    render(<EventDirectory />);

    // Type a keyword filter
    const keywordInput = screen.getByLabelText(/search keyword/i);
    fireEvent.change(keywordInput, { target: { value: 'NonexistentEvent' } });

    await waitFor(() => {
      expect(screen.getByText('No hackathons match your filters.')).toBeInTheDocument();
    });

    const clearBtn = screen.getByRole('button', { name: /clear all filters/i });
    expect(clearBtn).toBeInTheDocument();

    // Clicking clear resets the input
    fireEvent.click(clearBtn);
    expect(keywordInput).toHaveValue('');
  });

  it('displays error alert with retry button on API failure and preserves filter values', async () => {
    const fetchSpy = vi
      .spyOn(eventApiModule, 'fetchPublicEvents')
      .mockRejectedValueOnce(new Error('Server unavailable'))
      .mockResolvedValueOnce({
        events: sampleEvents,
        total: 2,
        limit: 20,
        offset: 0,
      });

    render(<EventDirectory />);

    const keywordInput = screen.getByLabelText(/search keyword/i);
    fireEvent.change(keywordInput, { target: { value: 'AI' } });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Server unavailable')).toBeInTheDocument();
    });

    // Form inputs must be preserved per NR-010
    expect(keywordInput).toHaveValue('AI');

    // Click retry
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText('Global AI Hackathon')).toBeInTheDocument();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

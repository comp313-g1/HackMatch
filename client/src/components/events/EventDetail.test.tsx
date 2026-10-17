import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { EventDetail } from './EventDetail.js';
import * as eventApiModule from './eventApi.js';
import type { PublicEvent } from './eventTypes.js';

describe('EventDetail component unit tests (US-008 / #75)', () => {
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

  it('renders loading state initially and then displays event details and back button', async () => {
    const handleBack = vi.fn();
    vi.spyOn(eventApiModule, 'fetchPublicEventById').mockResolvedValue(sampleEvent);

    render(<EventDetail eventId={sampleEvent.id} onBack={handleBack} />);

    expect(screen.getByRole('status')).toHaveTextContent(/loading event details/i);

    await waitFor(() => {
      expect(screen.getByText('Hack The North 2026')).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /visit official hackathon website/i })
      ).toBeInTheDocument();
    });

    const backButton = screen.getByRole('button', { name: /back to all hackathons/i });
    expect(backButton).toBeInTheDocument();
    fireEvent.click(backButton);
    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  it('renders alert message on 404 with retry button', async () => {
    const handleBack = vi.fn();
    vi.spyOn(eventApiModule, 'fetchPublicEventById').mockRejectedValue(
      new Error('Event not found')
    );

    render(<EventDetail eventId="non-existent" onBack={handleBack} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Event not found')).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
  });

  it('renders disabled link notice when event has link_disabled: true', async () => {
    const handleBack = vi.fn();
    const disabledEvent: PublicEvent = {
      ...sampleEvent,
      official_url: null,
      link_disabled: true,
    };
    vi.spyOn(eventApiModule, 'fetchPublicEventById').mockResolvedValue(disabledEvent);

    render(<EventDetail eventId={disabledEvent.id} onBack={handleBack} />);

    await waitFor(() => {
      expect(screen.getByText('Hack The North 2026')).toBeInTheDocument();
    });

    expect(screen.queryByRole('link', { name: /visit official hackathon website/i })).not.toBeInTheDocument();
    expect(screen.getByText('Official link disabled by an administrator')).toBeInTheDocument();
  });

  it('renders EventTeamBoardSection with visitor prompt when user is not signed in', async () => {
    const handleBack = vi.fn();
    vi.spyOn(eventApiModule, 'fetchPublicEventById').mockResolvedValue(sampleEvent);

    render(<EventDetail eventId={sampleEvent.id} onBack={handleBack} isSignedIn={false} />);

    await waitFor(() => {
      expect(screen.getByText('Hack The North 2026')).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { level: 3, name: /team vacancy board/i })).toBeInTheDocument();
    expect(screen.getByText('No open teams available for this event yet.')).toBeInTheDocument();
    expect(screen.getByText('Sign in to view team details and apply')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('renders EventTeamBoardSection with PART placeholder when user is signed in', async () => {
    const handleBack = vi.fn();
    vi.spyOn(eventApiModule, 'fetchPublicEventById').mockResolvedValue(sampleEvent);

    render(<EventDetail eventId={sampleEvent.id} onBack={handleBack} isSignedIn={true} />);

    await waitFor(() => {
      expect(screen.getByText('Hack The North 2026')).toBeInTheDocument();
    });

    expect(screen.getByText('Team details will appear here once teams are listed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('renders read-only note and no action buttons on concluded event team board', async () => {
    const handleBack = vi.fn();
    const concludedEvent: PublicEvent = {
      ...sampleEvent,
      status: 'Archived',
      time_state: 'concluded',
    };
    vi.spyOn(eventApiModule, 'fetchPublicEventById').mockResolvedValue(concludedEvent);

    render(<EventDetail eventId={concludedEvent.id} onBack={handleBack} isSignedIn={false} />);

    await waitFor(() => {
      expect(screen.getByText('Hack The North 2026')).toBeInTheDocument();
    });

    expect(screen.getByRole('note')).toHaveTextContent(
      'This event has concluded. The team board is read-only.'
    );
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });
});


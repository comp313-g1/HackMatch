import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { EventDirectory } from './EventDirectory.js';
import type { PublicEvent } from './eventTypes.js';
import * as firebaseAuth from 'firebase/auth';
import { auth } from '../../config/firebase.js';

vi.mock('firebase/auth', async () => {
  const actual = await vi.importActual<typeof import('firebase/auth')>('firebase/auth');
  return {
    ...actual,
    onAuthStateChanged: vi.fn(),
  };
});

describe('US-008 Event Directory & Detail Client Integration Tests (Task 7 / #78)', () => {
  const mockEvents: PublicEvent[] = [
    {
      id: 'e1000000-0000-4000-8000-000000000001',
      title: 'Waterloo Hackathon 2026',
      official_url: 'https://waterloohacks.com',
      link_disabled: false,
      event_edition: '2026',
      start_date: '2026-10-01T00:00:00.000Z',
      end_date: '2026-10-03T00:00:00.000Z',
      format: 'In-Person',
      location: 'Waterloo, ON',
      min_team_size: 2,
      max_team_size: 4,
      status: 'Published',
      time_state: 'upcoming',
    },
    {
      id: 'e1000000-0000-4000-8000-000000000002',
      title: 'Global Virtual AI Hackathon',
      official_url: 'https://aihack.global',
      link_disabled: false,
      event_edition: '2026',
      start_date: '2026-06-01T00:00:00.000Z',
      end_date: '2026-06-10T00:00:00.000Z',
      format: 'Virtual',
      location: 'Online Everywhere',
      min_team_size: 1,
      max_team_size: 5,
      status: 'Published',
      time_state: 'ongoing',
    },
    {
      id: 'e1000000-0000-4000-8000-000000000003',
      title: 'Winter Concluded Hackathon',
      official_url: 'https://winterhack.ca',
      link_disabled: false,
      event_edition: '2026',
      start_date: '2026-01-10T00:00:00.000Z',
      end_date: '2026-01-12T00:00:00.000Z',
      format: 'Hybrid',
      location: 'Montreal, QC',
      min_team_size: null,
      max_team_size: null,
      status: 'Published',
      time_state: 'concluded',
    },
    {
      id: 'e1000000-0000-4000-8000-000000000004',
      title: 'Safety Flagged Event',
      official_url: null,
      link_disabled: true,
      event_edition: '2026',
      start_date: '2026-11-01T00:00:00.000Z',
      end_date: '2026-11-03T00:00:00.000Z',
      format: 'In-Person',
      location: 'Toronto, ON',
      min_team_size: 1,
      max_team_size: 4,
      status: 'Published',
      time_state: 'upcoming',
    },
  ];

  let fetchSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock for onAuthStateChanged (unauthenticated visitor)
    vi.mocked(firebaseAuth.onAuthStateChanged).mockImplementation((_auth, cb) => {
      (cb as (user: firebaseAuth.User | null) => void)(null);
      return vi.fn();
    });

    Object.defineProperty(auth, 'currentUser', {
      value: null,
      writable: true,
      configurable: true,
    });

    // Default fetch mock router backed by fixtures
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const urlStr = String(input);
      const url = new URL(urlStr, 'http://localhost');

      // GET /api/events/:id
      const detailMatch = url.pathname.match(/^\/api\/events\/([^/]+)$/);
      if (detailMatch) {
        const id = decodeURIComponent(detailMatch[1]);
        const found = mockEvents.find((e) => e.id === id);
        if (!found) {
          return new Response(JSON.stringify({ error: 'Event not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ event: found }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // GET /api/events (list with filters)
      if (url.pathname === '/api/events') {
        const q = url.searchParams.get('q')?.toLowerCase() ?? '';
        const format = url.searchParams.get('format')?.toLowerCase() ?? '';
        const timeState = url.searchParams.get('timeState')?.toLowerCase() ?? '';

        let results = [...mockEvents];

        if (q) {
          results = results.filter(
            (e) =>
              e.title.toLowerCase().includes(q) ||
              (e.location && e.location.toLowerCase().includes(q))
          );
        }
        if (format) {
          results = results.filter((e) => e.format.toLowerCase() === format);
        }
        if (timeState) {
          results = results.filter((e) => e.time_state.toLowerCase() === timeState);
        }

        return new Response(
          JSON.stringify({
            events: results,
            total: results.length,
            limit: 20,
            offset: 0,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('completes the full journey: directory list -> filter -> view details -> back -> clear filters', async () => {
    render(<EventDirectory />);

    // 1. Initial list loads
    await waitFor(() => {
      expect(screen.getByText('Waterloo Hackathon 2026')).toBeInTheDocument();
      expect(screen.getByText('Global Virtual AI Hackathon')).toBeInTheDocument();
      expect(screen.getByText('Winter Concluded Hackathon')).toBeInTheDocument();
    });

    // 2. Apply filters: Keyword "Waterloo"
    const keywordInput = screen.getByLabelText(/search keyword/i);
    fireEvent.change(keywordInput, { target: { value: 'Waterloo' } });

    await waitFor(() => {
      expect(screen.getByText('Waterloo Hackathon 2026')).toBeInTheDocument();
      expect(screen.queryByText('Global Virtual AI Hackathon')).not.toBeInTheDocument();
    });

    // 3. Open EventDetail
    const viewDetailsBtn = screen.getByRole('button', { name: /view details/i });
    fireEvent.click(viewDetailsBtn);

    // 4. Detail view renders with metadata and safe link
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back to all hackathons/i })).toBeInTheDocument();
    });

    const officialLink = screen.getByRole('link', { name: /visit official hackathon website/i });
    expect(officialLink).toHaveAttribute('href', 'https://waterloohacks.com');
    expect(officialLink).toHaveAttribute('target', '_blank');
    expect(officialLink).toHaveAttribute('rel', 'noopener noreferrer');

    // 5. Team board displays empty state and visitor sign-in prompt
    expect(screen.getByText('No open teams available for this event yet.')).toBeInTheDocument();
    expect(screen.getByText('Sign in to view team details and apply')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();

    // 6. Navigate Back to directory
    const backBtn = screen.getByRole('button', { name: /back to all hackathons/i });
    fireEvent.click(backBtn);

    // 7. Directory is restored with prior filters preserved
    await waitFor(() => {
      expect(screen.getByLabelText(/search keyword/i)).toHaveValue('Waterloo');
      expect(screen.getByText('Waterloo Hackathon 2026')).toBeInTheDocument();
    });

    // 8. Clear filters restores the entire list
    const clearBtn = screen.getByRole('button', { name: /clear filters/i });
    fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(screen.getByText('Global Virtual AI Hackathon')).toBeInTheDocument();
      expect(screen.getByText('Winter Concluded Hackathon')).toBeInTheDocument();
    });
  });

  it('renders disabled link notice when event official URL was flagged by administrator', async () => {
    render(<EventDirectory />);

    await waitFor(() => {
      expect(screen.getByText('Safety Flagged Event')).toBeInTheDocument();
    });

    // Check card notice
    expect(screen.getByText('Official link disabled by an administrator')).toBeInTheDocument();

    // Open detail
    const card = screen.getByText('Safety Flagged Event').closest('li')!;
    const viewDetailsBtn = within(card).getByRole('button', { name: /view details/i });
    fireEvent.click(viewDetailsBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back to all hackathons/i })).toBeInTheDocument();
    });

    // Detail notice
    expect(screen.queryByRole('link', { name: /visit official hackathon website/i })).not.toBeInTheDocument();
    expect(screen.getByText('Official link disabled by an administrator')).toBeInTheDocument();
  });

  it('renders read-only notice and suppresses action buttons for concluded events', async () => {
    render(<EventDirectory />);

    await waitFor(() => {
      expect(screen.getByText('Winter Concluded Hackathon')).toBeInTheDocument();
    });

    const card = screen.getByText('Winter Concluded Hackathon').closest('li')!;
    const viewDetailsBtn = within(card).getByRole('button', { name: /view details/i });
    fireEvent.click(viewDetailsBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back to all hackathons/i })).toBeInTheDocument();
    });

    // Concluded event team board notice
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('This event has concluded. The team board is read-only.');
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('renders authenticated PART copy on the team board when user is signed in', async () => {
    // Simulate signed in user
    Object.defineProperty(auth, 'currentUser', {
      value: { uid: 'part-user-1' } as firebaseAuth.User,
      writable: true,
      configurable: true,
    });
    vi.mocked(firebaseAuth.onAuthStateChanged).mockImplementation((_auth, cb) => {
      (cb as (user: firebaseAuth.User | null) => void)({ uid: 'part-user-1' } as firebaseAuth.User);
      return vi.fn();
    });

    render(<EventDirectory />);

    await waitFor(() => {
      expect(screen.getByText('Waterloo Hackathon 2026')).toBeInTheDocument();
    });

    const card = screen.getByText('Waterloo Hackathon 2026').closest('li')!;
    const viewDetailsBtn = within(card).getByRole('button', { name: /view details/i });
    fireEvent.click(viewDetailsBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back to all hackathons/i })).toBeInTheDocument();
    });

    expect(screen.getByText('Team details will appear here once teams are listed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('shows filter-specific empty state with clear button when filters match 0 results', async () => {
    render(<EventDirectory />);

    await waitFor(() => {
      expect(screen.getByText('Waterloo Hackathon 2026')).toBeInTheDocument();
    });

    const keywordInput = screen.getByLabelText(/search keyword/i);
    fireEvent.change(keywordInput, { target: { value: 'Nonexistent Hackathon 999' } });

    await waitFor(() => {
      expect(screen.getByText(/no hackathons match your filters/i)).toBeInTheDocument();
    });

    const clearButton = screen.getByRole('button', { name: /clear all filters/i });
    expect(clearButton).toBeInTheDocument();
  });

  it('preserves user filter inputs and displays Retry button when fetch fails', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network gateway timeout'));

    render(<EventDirectory />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Network gateway timeout')).toBeInTheDocument();
    });

    // Enter a filter keyword during or before retry
    const keywordInput = screen.getByLabelText(/search keyword/i);
    fireEvent.change(keywordInput, { target: { value: 'AI' } });
    expect(keywordInput).toHaveValue('AI');

    // Click retry
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);

    // Success recovers and filter input is preserved
    await waitFor(() => {
      expect(screen.getByText('Global Virtual AI Hackathon')).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/search keyword/i)).toHaveValue('AI');
  });

  it('ignores stale responses when multiple filter requests are triggered concurrently', async () => {
    let resolveFirstRequest: ((resp: Response) => void) | null = null;

    fetchSpy.mockImplementation(async (input) => {
      const urlStr = String(input);
      if (urlStr.includes('Waterloo')) {
        return new Promise<Response>((resolve) => {
          resolveFirstRequest = resolve;
        });
      }

      // Fast second request
      return new Response(
        JSON.stringify({
          events: [mockEvents[1]], // Global Virtual AI Hackathon
          total: 1,
          limit: 20,
          offset: 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    render(<EventDirectory />);

    // Wait for initial load so controls are enabled
    await waitFor(() => {
      expect(screen.getByText('Global Virtual AI Hackathon')).toBeInTheDocument();
    });

    // Trigger slow request
    const keywordInput = screen.getByLabelText(/search keyword/i);
    fireEvent.change(keywordInput, { target: { value: 'Waterloo' } });

    // Trigger fast request
    fireEvent.change(keywordInput, { target: { value: 'AI' } });

    // Second request finishes and displays AI Hackathon
    await waitFor(() => {
      expect(screen.getByText('Global Virtual AI Hackathon')).toBeInTheDocument();
    });

    // Now resolve first (stale) request with Waterloo
    if (resolveFirstRequest) {
      (resolveFirstRequest as (resp: Response) => void)(
        new Response(
          JSON.stringify({
            events: [mockEvents[0]],
            total: 1,
            limit: 20,
            offset: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    }

    // Verify AI Hackathon remains on screen and is not overwritten by Waterloo
    await waitFor(() => {
      expect(screen.getByText('Global Virtual AI Hackathon')).toBeInTheDocument();
      expect(screen.queryByText('Waterloo Hackathon 2026')).not.toBeInTheDocument();
    });
  });
});

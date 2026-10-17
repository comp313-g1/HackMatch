import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventTeamBoardSection } from './EventTeamBoardSection.js';

describe('EventTeamBoardSection component unit tests (US-008 / #77)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders section with aria-labelledby and team board heading', () => {
    render(<EventTeamBoardSection timeState="upcoming" isSignedIn={false} />);

    const section = screen.getByRole('region', { name: /team vacancy board/i });
    expect(section).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /team vacancy board/i })).toBeInTheDocument();
  });

  it('always renders the empty state text', () => {
    render(<EventTeamBoardSection timeState="ongoing" isSignedIn={true} />);

    expect(
      screen.getByText('No open teams available for this event yet.')
    ).toBeInTheDocument();
  });

  it('renders sign-in guidance and button for visitors on active events', () => {
    const handleSignIn = vi.fn();
    render(
      <EventTeamBoardSection
        timeState="upcoming"
        isSignedIn={false}
        onSignIn={handleSignIn}
      />
    );

    expect(screen.getByText('Sign in to view team details and apply')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /sign in/i });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(handleSignIn).toHaveBeenCalledTimes(1);
  });

  it('renders PART placeholder text and no sign-in button for signed-in users', () => {
    render(<EventTeamBoardSection timeState="ongoing" isSignedIn={true} />);

    expect(
      screen.getByText('Team details will appear here once teams are listed.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('renders read-only note and no action buttons for concluded events (visitor)', () => {
    render(<EventTeamBoardSection timeState="concluded" isSignedIn={false} />);

    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('This event has concluded. The team board is read-only.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(
      screen.getByText('No open teams available for this event yet.')
    ).toBeInTheDocument();
  });

  it('renders read-only note and no action buttons for concluded events (signed in)', () => {
    render(<EventTeamBoardSection timeState="concluded" isSignedIn={true} />);

    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('This event has concluded. The team board is read-only.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

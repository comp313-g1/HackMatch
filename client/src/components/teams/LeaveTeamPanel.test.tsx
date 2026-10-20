import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LeaveTeamPanel } from './LeaveTeamPanel';
import * as teamApi from './teamApi';
import { AuthRequiredError, TeamApiError } from './teamApi';

vi.mock('./teamApi', async () => {
  const actual = await vi.importActual<typeof import('./teamApi')>('./teamApi');
  return {
    ...actual,
    leaveTeam: vi.fn(),
  };
});

describe('LeaveTeamPanel (US-019 / #183 / FR-059)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('confirms leave and reports success notice', async () => {
    const onLeft = vi.fn();
    vi.mocked(teamApi.leaveTeam).mockResolvedValueOnce({
      message: 'You left the team. Your Looking-for-Team availability for this event was restored.',
      availabilityRestored: true,
      leftParticipantId: 'p-member',
      teamId: 't-1',
    });

    render(
      <LeaveTeamPanel teamId="t-1" teamName="HackMatch Innovators" disabled={false} onLeft={onLeft} />
    );

    fireEvent.click(screen.getByRole('button', { name: /leave team/i }));
    expect(
      screen.getByText(/previously canceled invitations or applications for this team stay canceled/i)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /yes, leave team/i }));

    await waitFor(() => {
      expect(teamApi.leaveTeam).toHaveBeenCalledWith('t-1');
      expect(onLeft).toHaveBeenCalledWith(
        expect.stringMatching(/availability/i)
      );
    });
  });

  it('shows API error when leave is rejected for owner', async () => {
    vi.mocked(teamApi.leaveTeam).mockRejectedValueOnce(
      new TeamApiError(
        409,
        'CANNOT_LEAVE_AS_OWNER',
        undefined,
        undefined,
        undefined,
        'Team owners cannot leave. Disband the team instead.'
      )
    );

    render(
      <LeaveTeamPanel teamId="t-1" teamName="HackMatch Innovators" disabled={false} onLeft={vi.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: /leave team/i }));
    expect(
      screen.getByText(/previously canceled invitations or applications for this team stay canceled/i)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /yes, leave team/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/disband/i);
    });
  });

  it('shows sign-in guidance on AuthRequiredError', async () => {
    vi.mocked(teamApi.leaveTeam).mockRejectedValueOnce(new AuthRequiredError());

    render(
      <LeaveTeamPanel teamId="t-1" teamName="HackMatch Innovators" disabled={false} onLeft={vi.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: /leave team/i }));
    expect(
      screen.getByText(/previously canceled invitations or applications for this team stay canceled/i)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /yes, leave team/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/sign in/i);
    });
  });

  it('disables leave control when panel is disabled (locked team)', () => {
    render(
      <LeaveTeamPanel teamId="t-1" teamName="HackMatch Innovators" disabled onLeft={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: /leave team/i })).toBeDisabled();
  });
});

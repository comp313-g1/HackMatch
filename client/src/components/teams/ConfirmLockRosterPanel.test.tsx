import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ConfirmLockRosterPanel } from './ConfirmLockRosterPanel';
import * as teamApi from './teamApi';
import type { RosterLockValidationResult, TeamMemberView, TeamView } from './teamTypes';

vi.mock('./teamApi', async () => {
  const actual = await vi.importActual<typeof import('./teamApi')>('./teamApi');
  return {
    ...actual,
    validateTeamLock: vi.fn(),
    lockTeam: vi.fn(),
  };
});

const members: TeamMemberView[] = [
  {
    participantId: 'p-owner',
    displayName: 'Ada',
    role: 'Owner',
    joinedAt: '2026-10-18T10:00:00.000Z',
  },
  {
    participantId: 'p-member',
    displayName: 'Grace',
    role: 'Member',
    joinedAt: '2026-10-19T10:00:00.000Z',
  },
];

const eligibleResult: RosterLockValidationResult = {
  canLock: true,
  reasons: [],
  memberCount: 2,
  minRequired: 2,
  maxAllowed: 4,
  recruitmentStatus: 'Open',
  lockedAt: null,
  openSlots: 1,
  members: [
    { participantId: 'p-owner', displayName: 'Ada', role: 'Owner' },
    { participantId: 'p-member', displayName: 'Grace', role: 'Member' },
  ],
};

const underfilledResult: RosterLockValidationResult = {
  canLock: false,
  reasons: [
    {
      code: 'BELOW_MIN_MEMBERS',
      message: 'Locking requires at least 2 confirmed members (currently 1).',
      details: { memberCount: 1, minRequired: 2, maxAllowed: 4 },
    },
  ],
  memberCount: 1,
  minRequired: 2,
  maxAllowed: 4,
  recruitmentStatus: 'Open',
  lockedAt: null,
  openSlots: 2,
  members: [{ participantId: 'p-owner', displayName: 'Ada', role: 'Owner' }],
};

const emptyResult: RosterLockValidationResult = {
  ...underfilledResult,
  memberCount: 0,
  members: [],
  reasons: [
    {
      code: 'BELOW_MIN_MEMBERS',
      message: 'Locking requires at least 2 confirmed members (currently 0).',
    },
  ],
};

const lockedTeam: TeamView = {
  id: 't-1',
  eventId: 'e-1',
  name: 'Locked Crew',
  pitch: 'Done',
  goal: 'Project Completion',
  commitmentHours: 10,
  communicationLink: null,
  recruitmentStatus: 'Locked',
  lockedAt: '2026-10-20T16:00:00.000Z',
  createdAt: '2026-10-18T10:00:00.000Z',
  updatedAt: '2026-10-20T16:00:00.000Z',
  members,
  vacancies: [],
  limits: {
    maxTeamSize: 4,
    confirmedMembers: 2,
    openSlots: 0,
    remainingCapacity: 2,
  },
  lifecycle: { mutable: false, reason: 'Locked' },
  viewerRole: 'Owner',
  viewerParticipantId: 'p-owner',
  canLeave: false,
};

describe('ConfirmLockRosterPanel (US-022 / #211)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading then eligible roster review and enables Confirm & Lock (happy path)', async () => {
    vi.mocked(teamApi.validateTeamLock).mockResolvedValueOnce(eligibleResult);

    render(<ConfirmLockRosterPanel teamId="t-1" members={members} />);

    expect(screen.getByTestId('confirm-lock-loading')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('confirm-lock-eligible')).toHaveTextContent(/eligible to lock/i);
    });
    expect(screen.getByTestId('confirm-lock-roster-review')).toHaveTextContent('Grace');
    expect(screen.getByTestId('confirm-lock-open')).toBeEnabled();
  });

  it('opens confirmation dialog, cancel closes without locking (boundary)', async () => {
    vi.mocked(teamApi.validateTeamLock).mockResolvedValue(eligibleResult);

    render(<ConfirmLockRosterPanel teamId="t-1" members={members} />);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-lock-open')).toBeEnabled();
    });

    fireEvent.click(screen.getByTestId('confirm-lock-open'));
    expect(screen.getByTestId('confirm-lock-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-lock-dialog')).toHaveTextContent(/permanently/i);

    fireEvent.click(screen.getByTestId('confirm-lock-cancel'));
    expect(screen.queryByTestId('confirm-lock-dialog')).not.toBeInTheDocument();
    expect(teamApi.lockTeam).not.toHaveBeenCalled();
  });

  it('locks roster on confirm and notifies parent (happy path success)', async () => {
    vi.mocked(teamApi.validateTeamLock).mockResolvedValue(eligibleResult);
    vi.mocked(teamApi.lockTeam).mockResolvedValueOnce({
      message: 'Roster locked. 1 pending request was canceled.',
      lockedAt: lockedTeam.lockedAt!,
      memberCount: 2,
      minRequired: 2,
      maxAllowed: 4,
      canceledRequests: 1,
      team: lockedTeam,
    });
    const onLocked = vi.fn();

    render(
      <ConfirmLockRosterPanel teamId="t-1" members={members} onLocked={onLocked} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('confirm-lock-open')).toBeEnabled();
    });
    fireEvent.click(screen.getByTestId('confirm-lock-open'));
    fireEvent.click(screen.getByTestId('confirm-lock-submit'));

    await waitFor(() => {
      expect(onLocked).toHaveBeenCalledWith(
        expect.objectContaining({
          team: lockedTeam,
          lockedAt: lockedTeam.lockedAt,
          canceledRequests: 1,
        })
      );
    });
    expect(teamApi.lockTeam).toHaveBeenCalledWith('t-1');
    expect(screen.getByTestId('locked-roster-status-note')).toBeInTheDocument();
  });

  it('disables Confirm & Lock when underfilled and shows validation reasons (invalid / validation)', async () => {
    vi.mocked(teamApi.validateTeamLock).mockResolvedValueOnce(underfilledResult);

    render(
      <ConfirmLockRosterPanel
        teamId="t-1"
        members={[members[0]]}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('confirm-lock-blocked')).toBeInTheDocument();
    });
    expect(screen.getByTestId('confirm-lock-reason-BELOW_MIN_MEMBERS')).toHaveTextContent(
      /at least 2/i
    );
    expect(screen.getByTestId('confirm-lock-open')).toBeDisabled();
  });

  it('shows empty guidance when there are no confirmed members (empty)', async () => {
    vi.mocked(teamApi.validateTeamLock).mockResolvedValueOnce(emptyResult);

    render(<ConfirmLockRosterPanel teamId="t-1" members={[]} />);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-lock-empty')).toHaveTextContent(/no confirmed members/i);
    });
    expect(screen.getByTestId('confirm-lock-open')).toBeDisabled();
  });

  it('shows unauthorized messaging on 401 (unauthorized)', async () => {
    vi.mocked(teamApi.validateTeamLock).mockRejectedValueOnce(new teamApi.AuthRequiredError());

    render(<ConfirmLockRosterPanel teamId="t-1" members={members} />);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-lock-error')).toHaveTextContent(/sign in/i);
    });
  });

  it('shows owner-only forbidden messaging on 403 (unauthorized)', async () => {
    vi.mocked(teamApi.validateTeamLock).mockRejectedValueOnce(
      new teamApi.TeamApiError(
        403,
        'FORBIDDEN_NOT_TEAM_OWNER',
        undefined,
        undefined,
        undefined,
        'Forbidden'
      )
    );

    render(<ConfirmLockRosterPanel teamId="t-1" members={members} />);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-lock-error')).toHaveTextContent(/only the team owner/i);
    });
  });

  it('preserves prior validation when re-check fails (failure / keep data)', async () => {
    vi.mocked(teamApi.validateTeamLock)
      .mockResolvedValueOnce(eligibleResult)
      .mockRejectedValueOnce(
        new teamApi.TeamApiError(
          0,
          'NETWORK',
          { _form: 'Network error.' },
          undefined,
          undefined,
          'Network error.'
        )
      );

    render(<ConfirmLockRosterPanel teamId="t-1" members={members} />);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-lock-eligible')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('confirm-lock-recheck'));

    await waitFor(() => {
      expect(screen.getByTestId('confirm-lock-error')).toHaveTextContent(/network error/i);
    });
    expect(screen.getByTestId('confirm-lock-eligible')).toBeInTheDocument();
    expect(screen.getByText(/previous validation result was kept/i)).toBeInTheDocument();
  });

  it('surfaces lock API conflict and re-validates (failure handling)', async () => {
    vi.mocked(teamApi.validateTeamLock)
      .mockResolvedValueOnce(eligibleResult)
      .mockResolvedValueOnce(underfilledResult);
    vi.mocked(teamApi.lockTeam).mockRejectedValueOnce(
      new teamApi.TeamApiError(
        409,
        'BELOW_MIN_MEMBERS',
        undefined,
        undefined,
        undefined,
        'Not enough confirmed members to lock this roster.'
      )
    );

    render(<ConfirmLockRosterPanel teamId="t-1" members={members} />);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-lock-open')).toBeEnabled();
    });
    fireEvent.click(screen.getByTestId('confirm-lock-open'));
    fireEvent.click(screen.getByTestId('confirm-lock-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('confirm-lock-action-error')).toHaveTextContent(
        /not enough confirmed members/i
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('confirm-lock-blocked')).toBeInTheDocument();
    });
  });

  it('shows locked status view when disabled with lockedAt (boundary / already locked)', () => {
    render(
      <ConfirmLockRosterPanel
        teamId="t-1"
        members={members}
        disabled
        lockedAt="2026-10-20T16:00:00.000Z"
      />
    );

    expect(screen.getByTestId('locked-roster-status-note')).toHaveTextContent(/roster locked/i);
    expect(screen.queryByTestId('confirm-lock-open')).not.toBeInTheDocument();
  });
});

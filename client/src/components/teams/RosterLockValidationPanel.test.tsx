import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RosterLockValidationPanel } from './RosterLockValidationPanel';
import * as teamApi from './teamApi';
import type { RosterLockValidationResult, TeamMemberView } from './teamTypes';

vi.mock('./teamApi', async () => {
  const actual = await vi.importActual<typeof import('./teamApi')>('./teamApi');
  return {
    ...actual,
    validateTeamLock: vi.fn(),
  };
});

const members: TeamMemberView[] = [
  {
    participantId: 'p-owner',
    displayName: 'Ada',
    role: 'Owner',
    joinedAt: '2026-10-18T10:00:00.000Z',
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

describe('RosterLockValidationPanel (US-022 / #207)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading then success when the roster is eligible', async () => {
    vi.mocked(teamApi.validateTeamLock).mockResolvedValueOnce(eligibleResult);

    render(<RosterLockValidationPanel teamId="t-1" members={members} />);

    expect(screen.getByTestId('roster-lock-validation-loading')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('roster-lock-validation-success')).toHaveTextContent(
        /eligible to lock/i
      );
    });
    expect(screen.getByTestId('roster-lock-validation-members')).toHaveTextContent('Grace');
  });

  it('shows validation reasons when canLock is false and keeps roster members', async () => {
    vi.mocked(teamApi.validateTeamLock).mockResolvedValueOnce(underfilledResult);

    render(<RosterLockValidationPanel teamId="t-1" members={members} />);

    await waitFor(() => {
      expect(screen.getByTestId('roster-lock-validation-blocked')).toBeInTheDocument();
    });
    expect(screen.getByTestId('roster-lock-reason-BELOW_MIN_MEMBERS')).toHaveTextContent(
      /at least 2/i
    );
    expect(screen.getByTestId('roster-lock-validation-members')).toHaveTextContent('Ada');
  });

  it('shows empty guidance when there are no confirmed members', async () => {
    vi.mocked(teamApi.validateTeamLock).mockResolvedValueOnce(emptyResult);

    render(<RosterLockValidationPanel teamId="t-1" members={[]} />);

    await waitFor(() => {
      expect(screen.getByTestId('roster-lock-validation-empty')).toHaveTextContent(
        /no confirmed members/i
      );
    });
  });

  it('preserves prior validation result when a later request fails (error + keep data)', async () => {
    vi.mocked(teamApi.validateTeamLock)
      .mockResolvedValueOnce(eligibleResult)
      .mockRejectedValueOnce(
        new teamApi.TeamApiError(0, 'NETWORK', { _form: 'Network error.' }, undefined, undefined, 'Network error.')
      );

    render(<RosterLockValidationPanel teamId="t-1" members={members} />);

    await waitFor(() => {
      expect(screen.getByTestId('roster-lock-validation-success')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('roster-lock-validate-retry'));

    await waitFor(() => {
      expect(screen.getByTestId('roster-lock-validation-error')).toHaveTextContent(/network error/i);
    });
    expect(screen.getByTestId('roster-lock-validation-success')).toBeInTheDocument();
    expect(screen.getByText(/previous validation result was kept/i)).toBeInTheDocument();
  });

  it('shows owner-only forbidden messaging on 403', async () => {
    vi.mocked(teamApi.validateTeamLock).mockRejectedValueOnce(
      new teamApi.TeamApiError(403, 'FORBIDDEN_NOT_TEAM_OWNER', undefined, undefined, undefined, 'Forbidden')
    );

    render(<RosterLockValidationPanel teamId="t-1" members={members} />);

    await waitFor(() => {
      expect(screen.getByTestId('roster-lock-validation-error')).toHaveTextContent(
        /only the team owner/i
      );
    });
    expect(screen.getByText(/previous roster details were kept/i)).toBeInTheDocument();
  });
});

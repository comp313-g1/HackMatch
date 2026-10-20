import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TeamWorkspace } from './TeamWorkspace';
import * as teamApi from './teamApi';
import type { TeamView } from './teamTypes';
import { LeaveTeamPanel } from './LeaveTeamPanel';
import { POST_LOCK_UI_NOTICE } from './postLockGuards';

vi.mock('./teamApi', async () => {
  const actual = await vi.importActual<typeof import('./teamApi')>('./teamApi');
  return {
    ...actual,
    fetchMyTeam: vi.fn(),
    validateTeamLock: vi.fn(),
  };
});

const lockedOwnerTeam: TeamView = {
  id: 't-locked',
  eventId: 'e-1',
  name: 'Locked Crew',
  pitch: 'Final roster',
  goal: 'Project Completion',
  commitmentHours: 12,
  communicationLink: null,
  recruitmentStatus: 'Locked',
  lockedAt: '2026-10-20T15:30:00.000Z',
  createdAt: '2026-10-18T10:00:00.000Z',
  updatedAt: '2026-10-20T15:30:00.000Z',
  members: [
    {
      participantId: 'p-owner',
      displayName: 'Owner',
      role: 'Owner',
      joinedAt: '2026-10-18T10:00:00.000Z',
    },
    {
      participantId: 'p-member',
      displayName: 'Member',
      role: 'Member',
      joinedAt: '2026-10-19T10:00:00.000Z',
    },
  ],
  vacancies: [
    {
      id: 'v-1',
      role: 'Frontend',
      skills: ['React'],
      status: 'Open',
    },
  ],
  limits: {
    maxTeamSize: 4,
    confirmedMembers: 2,
    openSlots: 1,
    remainingCapacity: 1,
  },
  lifecycle: { mutable: false, reason: 'Locked' },
  viewerRole: 'Owner',
  viewerParticipantId: 'p-owner',
  canLeave: false,
};

describe('Post-lock UI freeze (US-022 / #210 / FR-067)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(teamApi.validateTeamLock).mockResolvedValue({
      canLock: false,
      reasons: [
        {
          code: 'ALREADY_LOCKED',
          message: 'This roster is already locked.',
        },
      ],
      memberCount: 2,
      minRequired: 2,
      maxAllowed: 4,
      recruitmentStatus: 'Locked',
      lockedAt: lockedOwnerTeam.lockedAt,
      openSlots: 1,
      members: lockedOwnerTeam.members.map((m) => ({
        participantId: m.participantId,
        displayName: m.displayName,
        role: m.role,
      })),
    });
  });

  it('owner workspace freezes slot add, remove, and disband when Locked (happy path)', async () => {
    vi.mocked(teamApi.fetchMyTeam).mockResolvedValueOnce(lockedOwnerTeam);

    render(<TeamWorkspace eventId="e-1" />);

    await waitFor(() => {
      expect(screen.getByRole('note')).toHaveTextContent(POST_LOCK_UI_NOTICE);
    });

    expect(screen.getByRole('button', { name: /\+ add open slot/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /disband team/i })).toBeDisabled();
    // Member remove + open-slot remove are both frozen when Locked.
    const removeButtons = screen.getAllByRole('button', { name: /^remove$/i });
    expect(removeButtons.length).toBeGreaterThan(0);
    for (const btn of removeButtons) {
      expect(btn).toBeDisabled();
    }
  });

  it('member leave control is disabled when panel is locked (boundary)', () => {
    render(
      <LeaveTeamPanel
        teamId="t-locked"
        teamName="Locked Crew"
        disabled
        onLeft={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /leave team/i })).toBeDisabled();
  });
});

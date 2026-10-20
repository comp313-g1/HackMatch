import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluateRosterLockEligibility,
  resolveLockMemberBounds,
  validateRosterLockForOwner,
  DEFAULT_LOCK_MIN_MEMBERS,
  DEFAULT_LOCK_MAX_MEMBERS,
} from './rosterLockValidation.js';
import type { Team } from '../db/types.js';

const ownerId = 'p1000000-0000-4000-8000-000000000001';
const memberId = 'p2000000-0000-4000-8000-000000000002';
const teamId = 't1000000-0000-4000-8000-000000000001';
const eventId = 'e1000000-0000-4000-8000-000000000001';

function baseTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: teamId,
    event_id: eventId,
    owner_participant_id: ownerId,
    name: 'Lockable Crew',
    pitch: 'Pitch',
    goal: 'Project Completion',
    commitment_hours: 20,
    communication_link: null,
    recruitment_status: 'Open',
    locked_at: null,
    disbanded_at: null,
    created_at: '2026-10-18T10:00:00.000Z',
    updated_at: '2026-10-18T10:00:00.000Z',
    ...overrides,
  };
}

const recruitingEvent = {
  min_team_size: 2,
  max_team_size: 4,
  status: 'Published' as const,
  end_date: '2099-01-01T00:00:00.000Z',
};

const twoMembers = [
  {
    participant_id: ownerId,
    role: 'Owner' as const,
    handle: 'lead',
    full_name: 'Team Lead',
  },
  {
    participant_id: memberId,
    role: 'Member' as const,
    handle: 'mate',
    full_name: 'Team Mate',
  },
];

describe('resolveLockMemberBounds (US-022 / #207)', () => {
  it('defaults to 2–4 when event sizes are null', () => {
    expect(resolveLockMemberBounds({ min_team_size: null, max_team_size: null })).toEqual({
      minRequired: DEFAULT_LOCK_MIN_MEMBERS,
      maxAllowed: DEFAULT_LOCK_MAX_MEMBERS,
    });
  });

  it('raises the floor to at least 2 when event min is 1', () => {
    expect(resolveLockMemberBounds({ min_team_size: 1, max_team_size: 4 })).toEqual({
      minRequired: 2,
      maxAllowed: 4,
    });
  });

  it('honors a higher official event minimum', () => {
    expect(resolveLockMemberBounds({ min_team_size: 3, max_team_size: 5 })).toEqual({
      minRequired: 3,
      maxAllowed: 5,
    });
  });
});

describe('evaluateRosterLockEligibility (US-022 / #207 / FR-066)', () => {
  it('allows lock for an open recruiting team with members in [min, max] (happy path)', () => {
    const result = evaluateRosterLockEligibility({
      actorParticipantId: ownerId,
      team: baseTeam(),
      event: recruitingEvent,
      members: twoMembers,
      openSlots: 1,
    });

    expect(result.canLock).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.memberCount).toBe(2);
    expect(result.minRequired).toBe(2);
    expect(result.maxAllowed).toBe(4);
    expect(result.members).toHaveLength(2);
  });

  it('rejects underfilled roster with BELOW_MIN_MEMBERS (boundary)', () => {
    const result = evaluateRosterLockEligibility({
      actorParticipantId: ownerId,
      team: baseTeam(),
      event: recruitingEvent,
      members: [twoMembers[0]],
      openSlots: 2,
    });

    expect(result.canLock).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain('BELOW_MIN_MEMBERS');
    expect(result.reasons[0].message).toMatch(/at least 2/i);
  });

  it('rejects overfilled roster with ABOVE_MAX_MEMBERS (boundary)', () => {
    const extras = Array.from({ length: 5 }, (_, i) => ({
      participant_id: `p${i}`,
      role: (i === 0 ? 'Owner' : 'Member') as 'Owner' | 'Member',
      handle: `u${i}`,
      full_name: `User ${i}`,
    }));
    extras[0].participant_id = ownerId;

    const result = evaluateRosterLockEligibility({
      actorParticipantId: ownerId,
      team: baseTeam(),
      event: { ...recruitingEvent, max_team_size: 4 },
      members: extras,
      openSlots: 0,
    });

    expect(result.canLock).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain('ABOVE_MAX_MEMBERS');
  });

  it('rejects already locked teams without clearing other diagnostics', () => {
    const result = evaluateRosterLockEligibility({
      actorParticipantId: ownerId,
      team: baseTeam({
        recruitment_status: 'Locked',
        locked_at: '2026-10-19T12:00:00.000Z',
      }),
      event: recruitingEvent,
      members: twoMembers,
      openSlots: 0,
    });

    expect(result.canLock).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain('ALREADY_LOCKED');
    expect(result.lockedAt).toBe('2026-10-19T12:00:00.000Z');
  });

  it('rejects when event is not recruiting', () => {
    const result = evaluateRosterLockEligibility({
      actorParticipantId: ownerId,
      team: baseTeam(),
      event: { ...recruitingEvent, status: 'Disabled' },
      members: twoMembers,
      openSlots: 0,
      now: new Date('2026-10-20T12:00:00.000Z'),
    });

    expect(result.canLock).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain('EVENT_NOT_RECRUITING');
  });

  it('rejects non-owner actors (unauthorized soft reason)', () => {
    const result = evaluateRosterLockEligibility({
      actorParticipantId: memberId,
      team: baseTeam(),
      event: recruitingEvent,
      members: twoMembers,
      openSlots: 0,
    });

    expect(result.canLock).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain('FORBIDDEN_NOT_TEAM_OWNER');
  });

  it('rejects FR-083 membership conflicts', () => {
    const result = evaluateRosterLockEligibility({
      actorParticipantId: ownerId,
      team: baseTeam(),
      event: recruitingEvent,
      members: twoMembers,
      openSlots: 0,
      membersConfirmedElsewhere: [memberId],
    });

    expect(result.canLock).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain('MEMBER_CONFIRMED_ELSEWHERE');
  });
});

describe('validateRosterLockForOwner (US-022 / #207)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads team parts and returns canLock for a valid roster', async () => {
    const repo = {
      getTeamViewParts: vi.fn().mockResolvedValue({
        team: baseTeam(),
        event: recruitingEvent,
        members: twoMembers.map((m) => ({ ...m, joined_at: '2026-10-18T10:00:00.000Z' })),
        vacancies: [{ id: 'v1', status: 'Open' }],
      }),
      findConfirmedTeamIdForParticipant: vi.fn().mockImplementation(async (participantId: string) => {
        if (participantId === ownerId || participantId === memberId) return teamId;
        return null;
      }),
    };

    const result = await validateRosterLockForOwner(ownerId, teamId, { repo });
    expect(result.canLock).toBe(true);
    expect(repo.getTeamViewParts).toHaveBeenCalledWith(teamId);
    expect(repo.findConfirmedTeamIdForParticipant).toHaveBeenCalled();
  });

  it('flags members confirmed on another team for the same event', async () => {
    const otherTeamId = 't9999999-0000-4000-8000-000000000099';
    const repo = {
      getTeamViewParts: vi.fn().mockResolvedValue({
        team: baseTeam(),
        event: recruitingEvent,
        members: twoMembers.map((m) => ({ ...m, joined_at: '2026-10-18T10:00:00.000Z' })),
        vacancies: [],
      }),
      findConfirmedTeamIdForParticipant: vi.fn().mockImplementation(async (participantId: string) => {
        if (participantId === memberId) return otherTeamId;
        return teamId;
      }),
    };

    const result = await validateRosterLockForOwner(ownerId, teamId, { repo });
    expect(result.canLock).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain('MEMBER_CONFIRMED_ELSEWHERE');
  });
});

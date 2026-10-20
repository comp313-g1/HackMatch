import { describe, it, expect } from 'vitest';
import {
  isTeamFullAfterPlacement,
  planCompetingRequestCancellation,
  type CompetingRequestRow,
} from './placementCascade.js';

const winning: CompetingRequestRow = {
  id: 'win',
  participantId: 'part-a',
  eventId: 'event-1',
  teamId: 'team-1',
  vacancyId: 'vac-1',
  requestType: 'Invitation',
  status: 'Pending',
};

describe('placementCascade pure planners (US-019 / #181 / FR-056 / FR-057)', () => {
  it('cancels other event invitations and withdraws other applications for the same PART', () => {
    const pending: CompetingRequestRow[] = [
      winning,
      {
        id: 'inv-other-team',
        participantId: 'part-a',
        eventId: 'event-1',
        teamId: 'team-2',
        vacancyId: 'vac-9',
        requestType: 'Invitation',
        status: 'Pending',
      },
      {
        id: 'app-same-event',
        participantId: 'part-a',
        eventId: 'event-1',
        teamId: 'team-3',
        vacancyId: 'vac-8',
        requestType: 'Application',
        status: 'Pending',
      },
      {
        id: 'inv-other-event',
        participantId: 'part-a',
        eventId: 'event-2',
        teamId: 'team-4',
        vacancyId: 'vac-7',
        requestType: 'Invitation',
        status: 'Pending',
      },
    ];

    const plan = planCompetingRequestCancellation(winning, pending, false);

    expect(plan.eventInvitationIds).toEqual(['inv-other-team']);
    expect(plan.eventApplicationIds).toEqual(['app-same-event']);
    expect(plan.eventInvitationIds).not.toContain('inv-other-event');
  });

  it('cancels remaining Pending requests for the filled slot', () => {
    const pending: CompetingRequestRow[] = [
      winning,
      {
        id: 'peer-invite',
        participantId: 'part-b',
        eventId: 'event-1',
        teamId: 'team-1',
        vacancyId: 'vac-1',
        requestType: 'Invitation',
        status: 'Pending',
      },
      {
        id: 'peer-app',
        participantId: 'part-c',
        eventId: 'event-1',
        teamId: 'team-1',
        vacancyId: 'vac-1',
        requestType: 'Application',
        status: 'Pending',
      },
      {
        id: 'other-slot',
        participantId: 'part-d',
        eventId: 'event-1',
        teamId: 'team-1',
        vacancyId: 'vac-2',
        requestType: 'Invitation',
        status: 'Pending',
      },
    ];

    const plan = planCompetingRequestCancellation(winning, pending, false);

    expect(plan.slotRequestIds.sort()).toEqual(['peer-app', 'peer-invite']);
    expect(plan.slotRequestIds).not.toContain('other-slot');
    expect(plan.teamRequestIds).toEqual([]);
  });

  it('when team is full, cancels every remaining Pending request on the team', () => {
    const pending: CompetingRequestRow[] = [
      winning,
      {
        id: 'other-slot-invite',
        participantId: 'part-b',
        eventId: 'event-1',
        teamId: 'team-1',
        vacancyId: 'vac-2',
        requestType: 'Invitation',
        status: 'Pending',
      },
      {
        id: 'other-team',
        participantId: 'part-c',
        eventId: 'event-1',
        teamId: 'team-2',
        vacancyId: 'vac-3',
        requestType: 'Application',
        status: 'Pending',
      },
    ];

    const plan = planCompetingRequestCancellation(winning, pending, true);

    expect(plan.teamRequestIds).toEqual(['other-slot-invite']);
    expect(plan.teamRequestIds).not.toContain('other-team');
  });

  it('detects team-full boundary after placement', () => {
    expect(isTeamFullAfterPlacement(3, 4)).toBe(false);
    expect(isTeamFullAfterPlacement(4, 4)).toBe(true);
    expect(isTeamFullAfterPlacement(5, 4)).toBe(true);
  });
});

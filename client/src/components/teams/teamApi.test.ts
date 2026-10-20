import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchMyTeam,
  fetchTeam,
  createTeam,
  updateTeam,
  addVacancy,
  updateVacancy,
  removeVacancy,
  removeMember,
  disbandTeam,
  leaveTeam,
} from './teamApi';
import { authFetch, AuthRequiredError } from '../../config/authFetch';
import type { TeamView } from './teamTypes';

vi.mock('../../config/authFetch', () => {
  class MockAuthRequiredError extends Error {
    readonly code = 'AUTH_REQUIRED';
    constructor() {
      super('You need to sign in first.');
      this.name = 'AuthRequiredError';
    }
  }

  return {
    authFetch: vi.fn(),
    AuthRequiredError: MockAuthRequiredError,
  };
});

describe('teamApi client unit tests (US-012 / Task 8 / #125)', () => {
  const mockTeam: TeamView = {
    id: 't-123',
    eventId: 'e-123',
    name: 'HackMatch Team',
    pitch: 'Building accessible software',
    goal: 'Project Completion',
    commitmentHours: 20,
    communicationLink: 'https://discord.gg/test',
    recruitmentStatus: 'Open',
    lockedAt: null,
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-18T10:00:00.000Z',
    members: [],
    vacancies: [],
    limits: {
      maxTeamSize: 4,
      confirmedMembers: 1,
      openSlots: 0,
      remainingCapacity: 3,
    },
    lifecycle: {
      mutable: true,
      reason: null,
    },
    viewerRole: 'Owner',
    viewerParticipantId: 'p-1',
    canLeave: false,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchMyTeam calls /api/teams/mine and returns team or null', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ team: mockTeam }), { status: 200 })
    );

    const team = await fetchMyTeam('e-123');
    expect(authFetch).toHaveBeenCalledWith('/api/teams/mine?eventId=e-123', {
      method: 'GET',
    });
    expect(team).toEqual(mockTeam);
  });

  it('fetchTeam calls /api/teams/:teamId and returns team', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ team: mockTeam }), { status: 200 })
    );

    const team = await fetchTeam('t-123');
    expect(authFetch).toHaveBeenCalledWith('/api/teams/t-123', { method: 'GET' });
    expect(team).toEqual(mockTeam);
  });

  it('createTeam sends JSON payload to POST /api/teams', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ team: mockTeam }), { status: 201 })
    );

    const payload = {
      eventId: 'e-123',
      name: 'HackMatch Team',
      pitch: 'Building accessible software',
      goal: 'Project Completion' as const,
      commitmentHours: 20,
      communicationLink: 'https://discord.gg/test',
    };

    const team = await createTeam(payload);
    expect(authFetch).toHaveBeenCalledWith('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(team).toEqual(mockTeam);
  });

  it('updateTeam sends PATCH to /api/teams/:teamId', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ team: mockTeam }), { status: 200 })
    );

    const patch = { pitch: 'Updated pitch' };
    const team = await updateTeam('t-123', patch);
    expect(authFetch).toHaveBeenCalledWith('/api/teams/t-123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    expect(team).toEqual(mockTeam);
  });

  it('addVacancy sends POST to /api/teams/:teamId/vacancies', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ team: mockTeam }), { status: 201 })
    );

    const payload = { role: 'Frontend' as const, skills: ['React'] };
    const team = await addVacancy('t-123', payload);
    expect(authFetch).toHaveBeenCalledWith('/api/teams/t-123/vacancies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(team).toEqual(mockTeam);
  });

  it('updateVacancy sends PATCH to /api/teams/:teamId/vacancies/:vacancyId', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ team: mockTeam }), { status: 200 })
    );

    const payload = { role: 'Backend' as const, skills: ['Node.js'] };
    const team = await updateVacancy('t-123', 'v-123', payload);
    expect(authFetch).toHaveBeenCalledWith('/api/teams/t-123/vacancies/v-123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(team).toEqual(mockTeam);
  });

  it('removeVacancy sends DELETE to /api/teams/:teamId/vacancies/:vacancyId', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ canceledRequests: 2, team: mockTeam }), { status: 200 })
    );

    const result = await removeVacancy('t-123', 'v-123');
    expect(authFetch).toHaveBeenCalledWith('/api/teams/t-123/vacancies/v-123', {
      method: 'DELETE',
    });
    expect(result.canceledRequests).toBe(2);
    expect(result.team).toEqual(mockTeam);
  });

  it('removeMember sends POST to /api/teams/:teamId/members/:participantId/remove', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: 'Team member removed.',
          availabilityRestored: true,
          team: mockTeam,
        }),
        { status: 200 }
      )
    );

    const result = await removeMember('t-123', 'p-456', 'No longer available');
    expect(authFetch).toHaveBeenCalledWith('/api/teams/t-123/members/p-456/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'No longer available' }),
    });
    expect(result.availabilityRestored).toBe(true);
    expect(result.team).toEqual(mockTeam);
  });

  it('disbandTeam sends POST to /api/teams/:teamId/disband', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: 'Team disbanded.',
          releasedMembers: 3,
          canceledRequests: 1,
        }),
        { status: 200 }
      )
    );

    const result = await disbandTeam('t-123');
    expect(authFetch).toHaveBeenCalledWith('/api/teams/t-123/disband', {
      method: 'POST',
    });
    expect(result.releasedMembers).toBe(3);
    expect(result.canceledRequests).toBe(1);
  });

  it('leaveTeam sends POST to /api/teams/:teamId/leave (#183)', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: 'You left the team. Your Looking-for-Team availability for this event was restored.',
          availabilityRestored: true,
          leftParticipantId: 'p-456',
          teamId: 't-123',
        }),
        { status: 200 }
      )
    );

    const result = await leaveTeam('t-123');
    expect(authFetch).toHaveBeenCalledWith('/api/teams/t-123/leave', {
      method: 'POST',
    });
    expect(result.availabilityRestored).toBe(true);
    expect(result.message).toMatch(/availability/i);
  });

  it('maps HTTP errors into TeamApiError with structured details and code', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'CAPACITY_EXCEEDED',
          error: 'Team capacity exceeded.',
          errors: { vacancies: 'This team is full.' },
          limits: { maxTeamSize: 4, confirmedMembers: 3, openSlots: 1 },
        }),
        { status: 409 }
      )
    );

    await expect(
      addVacancy('t-123', { role: 'Frontend', skills: [] })
    ).rejects.toMatchObject({
      name: 'TeamApiError',
      status: 409,
      code: 'CAPACITY_EXCEEDED',
      errors: { vacancies: 'This team is full.' },
      limits: { maxTeamSize: 4, confirmedMembers: 3, openSlots: 1 },
    });
  });

  it('converts network failures into TeamApiError with status 0 and NETWORK code', async () => {
    vi.mocked(authFetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(fetchMyTeam('e-123')).rejects.toMatchObject({
      name: 'TeamApiError',
      status: 0,
      code: 'NETWORK',
      errors: { _form: 'Network error. Your entered values have been kept.' },
    });
  });

  it('propagates AuthRequiredError without converting to TeamApiError', async () => {
    vi.mocked(authFetch).mockRejectedValueOnce(new AuthRequiredError());

    await expect(fetchMyTeam('e-123')).rejects.toBeInstanceOf(AuthRequiredError);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { teamsRepository, type CreateTeamWithOwnerInput } from './teams.repository.js';
import * as clientModule from './client.js';
import type { Team, TeamMembership } from './types.js';

describe('teamsRepository unit tests (US-012 / #119)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const sampleInput: CreateTeamWithOwnerInput = {
    ownerParticipantId: 'p1000000-0000-4000-8000-000000000001',
    eventId: 'e1000000-0000-4000-8000-000000000001',
    name: 'Hackers United',
    pitch: 'Building an innovative AI tool',
    goal: 'Project Completion',
    commitmentHours: 20.0,
    communicationLink: 'https://discord.gg/example',
  };

  const sampleTeam: Team = {
    id: 't1000000-0000-4000-8000-000000000001',
    event_id: sampleInput.eventId,
    owner_participant_id: sampleInput.ownerParticipantId,
    name: sampleInput.name,
    pitch: sampleInput.pitch,
    goal: sampleInput.goal,
    commitment_hours: sampleInput.commitmentHours,
    communication_link: sampleInput.communicationLink,
    recruitment_status: 'Open',
    disbanded_at: null,
    created_at: '2026-10-18T10:00:00.000Z',
    updated_at: '2026-10-18T10:00:00.000Z',
  };

  const sampleMembership: TeamMembership = {
    id: 'm1000000-0000-4000-8000-000000000001',
    team_id: sampleTeam.id,
    event_id: sampleInput.eventId,
    participant_id: sampleInput.ownerParticipantId,
    role: 'Owner',
    status: 'Confirmed',
    removal_reason: null,
    joined_at: '2026-10-18T10:00:00.000Z',
    ended_at: null,
    created_at: '2026-10-18T10:00:00.000Z',
    updated_at: '2026-10-18T10:00:00.000Z',
  };

  it('calls create_team_with_owner RPC with exactly mapped p_* parameters and returns result', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: { team: sampleTeam, membership: sampleMembership },
      error: null,
    });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      rpc: mockRpc,
    } as unknown as SupabaseClient);

    const result = await teamsRepository.createTeamWithOwner(sampleInput);

    expect(mockRpc).toHaveBeenCalledWith('create_team_with_owner', {
      p_owner_id: sampleInput.ownerParticipantId,
      p_event_id: sampleInput.eventId,
      p_name: sampleInput.name,
      p_pitch: sampleInput.pitch,
      p_goal: sampleInput.goal,
      p_commitment_hours: sampleInput.commitmentHours,
      p_communication_link: sampleInput.communicationLink,
    });

    expect(result).toEqual({
      team: sampleTeam,
      membership: sampleMembership,
    });
  });

  it('throws when client.rpc returns an error object', async () => {
    const rpcError = {
      message: 'ALREADY_CONFIRMED_MEMBER',
      code: 'P0001',
    };

    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: rpcError,
    });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      rpc: mockRpc,
    } as unknown as SupabaseClient);

    await expect(teamsRepository.createTeamWithOwner(sampleInput)).rejects.toEqual(rpcError);
  });

  it('findTeamById queries teams table by id and returns single row', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: sampleTeam, error: null });
    const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      from: mockFrom,
    } as unknown as SupabaseClient);

    const result = await teamsRepository.findTeamById(sampleTeam.id);
    expect(mockFrom).toHaveBeenCalledWith('teams');
    expect(mockEq).toHaveBeenCalledWith('id', sampleTeam.id);
    expect(result).toEqual(sampleTeam);
  });

  it('findConfirmedTeamIdForParticipant queries confirmed team_memberships for participant and event', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: { team_id: sampleTeam.id }, error: null });
    const mockEq3 = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockEq2 = vi.fn().mockReturnValue({ eq: mockEq3 });
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      from: mockFrom,
    } as unknown as SupabaseClient);

    const result = await teamsRepository.findConfirmedTeamIdForParticipant('p1', 'e1');
    expect(mockFrom).toHaveBeenCalledWith('team_memberships');
    expect(result).toBe(sampleTeam.id);
  });

  it('updateTeamListing calls update_team_listing RPC with actor, team, and p_patch', async () => {
    const updatedTeam = { ...sampleTeam, pitch: 'New pitch' };
    const mockRpc = vi.fn().mockResolvedValue({
      data: { team: updatedTeam },
      error: null,
    });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      rpc: mockRpc,
    } as unknown as SupabaseClient);

    const result = await teamsRepository.updateTeamListing('actor-1', sampleTeam.id, { pitch: 'New pitch' });
    expect(mockRpc).toHaveBeenCalledWith('update_team_listing', {
      p_actor: 'actor-1',
      p_team: sampleTeam.id,
      p_patch: { pitch: 'New pitch' },
    });
    expect(result).toEqual(updatedTeam);
  });

  it('addTeamVacancy calls add_team_vacancy RPC and returns created vacancy', async () => {
    const mockVacancy = {
      id: 'v1',
      team_id: sampleTeam.id,
      role: 'Frontend' as const,
      skills: ['React'],
      status: 'Open',
    };
    const mockRpc = vi.fn().mockResolvedValue({
      data: { vacancy: mockVacancy },
      error: null,
    });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      rpc: mockRpc,
    } as unknown as SupabaseClient);

    const result = await teamsRepository.addTeamVacancy('actor-1', sampleTeam.id, 'Frontend', ['React']);
    expect(mockRpc).toHaveBeenCalledWith('add_team_vacancy', {
      p_actor: 'actor-1',
      p_team: sampleTeam.id,
      p_role: 'Frontend',
      p_skills: ['React'],
    });
    expect(result).toEqual(mockVacancy);
  });

  it('updateTeamVacancy calls update_team_vacancy RPC and returns updated vacancy', async () => {
    const mockVacancy = {
      id: 'v1',
      team_id: sampleTeam.id,
      role: 'Backend' as const,
      skills: ['Node.js'],
      status: 'Open',
    };
    const mockRpc = vi.fn().mockResolvedValue({
      data: { vacancy: mockVacancy },
      error: null,
    });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      rpc: mockRpc,
    } as unknown as SupabaseClient);

    const result = await teamsRepository.updateTeamVacancy('actor-1', sampleTeam.id, 'v1', 'Backend', ['Node.js']);
    expect(mockRpc).toHaveBeenCalledWith('update_team_vacancy', {
      p_actor: 'actor-1',
      p_team: sampleTeam.id,
      p_vacancy: 'v1',
      p_role: 'Backend',
      p_skills: ['Node.js'],
    });
    expect(result).toEqual(mockVacancy);
  });
});

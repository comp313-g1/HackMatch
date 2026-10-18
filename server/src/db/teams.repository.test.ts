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
});

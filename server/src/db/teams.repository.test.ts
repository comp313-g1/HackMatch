import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { teamsRepository, type CreateTeamWithOwnerInput } from './teams.repository.js';
import * as clientModule from './client.js';
import type { Team, TeamMembership, TeamRequest, TeamVacancy } from './types.js';

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

  it('removeTeamVacancy calls remove_team_vacancy RPC and returns canceledRequests count', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: { vacancyId: 'v1', canceledRequests: 2 },
      error: null,
    });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      rpc: mockRpc,
    } as unknown as SupabaseClient);

    const result = await teamsRepository.removeTeamVacancy('actor-1', sampleTeam.id, 'v1');
    expect(mockRpc).toHaveBeenCalledWith('remove_team_vacancy', {
      p_actor: 'actor-1',
      p_team: sampleTeam.id,
      p_vacancy: 'v1',
    });
    expect(result).toEqual({ vacancyId: 'v1', canceledRequests: 2 });
  });

  it('disbandTeam calls disband_team RPC and returns releasedMembers and canceledRequests counts', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: { releasedMembers: 3, canceledRequests: 4 },
      error: null,
    });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      rpc: mockRpc,
    } as unknown as SupabaseClient);

    const result = await teamsRepository.disbandTeam('actor-1', sampleTeam.id);
    expect(mockRpc).toHaveBeenCalledWith('disband_team', {
      p_actor: 'actor-1',
      p_team: sampleTeam.id,
    });
    expect(result).toEqual({ releasedMembers: 3, canceledRequests: 4 });
  });

  it('leaveTeam calls leave_team RPC and returns availability restoration (#183)', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        leftParticipantId: 'actor-2',
        teamId: sampleTeam.id,
        availabilityRestored: true,
        notice: 'You left the team. Your Looking-for-Team availability for this event was restored.',
      },
      error: null,
    });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      rpc: mockRpc,
    } as unknown as SupabaseClient);

    const result = await teamsRepository.leaveTeam('actor-2', sampleTeam.id);
    expect(mockRpc).toHaveBeenCalledWith('leave_team', {
      p_actor: 'actor-2',
      p_team: sampleTeam.id,
    });
    expect(result.availabilityRestored).toBe(true);
    expect(result.leftParticipantId).toBe('actor-2');
  });

  it('listConfirmedParticipantIdsForEvent selects Confirmed memberships for the event (FR-046)', async () => {
    const eventId = sampleInput.eventId;
    const ownerId = sampleInput.ownerParticipantId;
    const otherId = 'p2000000-0000-4000-8000-000000000002';
    const eqStatus = vi.fn().mockResolvedValue({
      data: [{ participant_id: ownerId }, { participant_id: otherId }, { participant_id: ownerId }],
      error: null,
    });
    const eqEvent = vi.fn().mockReturnValue({ eq: eqStatus });
    const select = vi.fn().mockReturnValue({ eq: eqEvent });
    const from = vi.fn().mockReturnValue({ select });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      from,
    } as unknown as SupabaseClient);

    const ids = await teamsRepository.listConfirmedParticipantIdsForEvent(eventId);

    expect(from).toHaveBeenCalledWith('team_memberships');
    expect(select).toHaveBeenCalledWith('participant_id');
    expect(eqEvent).toHaveBeenCalledWith('event_id', eventId);
    expect(eqStatus).toHaveBeenCalledWith('status', 'Confirmed');
    expect(ids).toEqual([ownerId, otherId]);
  });

  it('listConfirmedParticipantIdsForTeam selects Confirmed memberships for the team and deduplicates (US-015)', async () => {
    const teamId = sampleTeam.id;
    const ownerId = sampleInput.ownerParticipantId;
    const otherId = 'p2000000-0000-4000-8000-000000000002';
    const eqStatus = vi.fn().mockResolvedValue({
      data: [{ participant_id: ownerId }, { participant_id: otherId }, { participant_id: ownerId }],
      error: null,
    });
    const eqTeam = vi.fn().mockReturnValue({ eq: eqStatus });
    const select = vi.fn().mockReturnValue({ eq: eqTeam });
    const from = vi.fn().mockReturnValue({ select });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      from,
    } as unknown as SupabaseClient);

    const ids = await teamsRepository.listConfirmedParticipantIdsForTeam(teamId);

    expect(from).toHaveBeenCalledWith('team_memberships');
    expect(select).toHaveBeenCalledWith('participant_id');
    expect(eqTeam).toHaveBeenCalledWith('team_id', teamId);
    expect(eqStatus).toHaveBeenCalledWith('status', 'Confirmed');
    expect(ids).toEqual([ownerId, otherId]);
  });

  it('findPendingApplicationForTeam returns only the applicant pending Application (#176)', async () => {
    const participantId = 'p2000000-0000-4000-8000-000000000002';
    const application = { id: 'a1000000-0000-4000-8000-000000000001' };
    const maybeSingle = vi.fn().mockResolvedValue({ data: application, error: null });
    const eqStatus = vi.fn().mockReturnValue({ maybeSingle });
    const eqType = vi.fn().mockReturnValue({ eq: eqStatus });
    const eqTeam = vi.fn().mockReturnValue({ eq: eqType });
    const eqParticipant = vi.fn().mockReturnValue({ eq: eqTeam });
    const select = vi.fn().mockReturnValue({ eq: eqParticipant });
    const from = vi.fn().mockReturnValue({ select });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      from,
    } as unknown as SupabaseClient);

    const result = await teamsRepository.findPendingApplicationForTeam(
      participantId,
      sampleTeam.id
    );

    expect(from).toHaveBeenCalledWith('team_requests');
    expect(select).toHaveBeenCalledWith('id');
    expect(eqParticipant).toHaveBeenCalledWith('participant_id', participantId);
    expect(eqTeam).toHaveBeenCalledWith('team_id', sampleTeam.id);
    expect(eqType).toHaveBeenCalledWith('request_type', 'Application');
    expect(eqStatus).toHaveBeenCalledWith('status', 'Pending');
    expect(result).toEqual(application);
  });

  it('listTeamApplications queries only Pending Applications newest-first and projects permitted profile data (#188)', async () => {
    const applicantId = 'p2000000-0000-4000-8000-000000000002';
    const application = {
      id: 'a1000000-0000-4000-8000-000000000001',
      team_id: sampleTeam.id,
      event_id: sampleTeam.event_id,
      vacancy_id: 'v1000000-0000-4000-8000-000000000001',
      participant_id: applicantId,
      request_type: 'Application',
      status: 'Pending',
      message: 'Ready to contribute',
      cancel_reason: null,
      resolved_at: null,
      expires_at: null,
      created_at: '2026-10-20T16:00:00.000Z',
      updated_at: '2026-10-20T16:00:00.000Z',
      vacancy: { role: 'Backend' },
    };

    const requestOrder = vi.fn().mockResolvedValue({ data: [application], error: null });
    const requestStatus = vi.fn().mockReturnValue({ order: requestOrder });
    const requestType = vi.fn().mockReturnValue({ eq: requestStatus });
    const requestTeam = vi.fn().mockReturnValue({ eq: requestType });
    const teamMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: sampleTeam.id, name: sampleTeam.name },
      error: null,
    });
    const profileIn = vi.fn().mockResolvedValue({
      data: [
        {
          participant_id: applicantId,
          handle: 'backend_dev',
          primary_role: 'Backend',
          institution: 'George Brown College',
        },
      ],
      error: null,
    });
    const participantIn = vi.fn().mockResolvedValue({
      data: [{ id: applicantId, full_name: 'Grace Hopper' }],
      error: null,
    });
    const skillOrder = vi.fn().mockResolvedValue({
      data: [{ participant_id: applicantId, skill_name: 'PostgreSQL' }],
      error: null,
    });
    const portfolioOrder = vi.fn().mockResolvedValue({
      data: [
        {
          participant_id: applicantId,
          url: 'https://example.com/grace',
          label: 'Projects',
        },
      ],
      error: null,
    });

    const from = vi.fn((table: string) => {
      if (table === 'teams') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ maybeSingle: teamMaybeSingle }),
          }),
        };
      }
      if (table === 'team_requests') {
        return { select: vi.fn().mockReturnValue({ eq: requestTeam }) };
      }
      if (table === 'participants') {
        return { select: vi.fn().mockReturnValue({ in: participantIn }) };
      }
      if (table === 'participant_profiles') {
        return { select: vi.fn().mockReturnValue({ in: profileIn }) };
      }
      if (table === 'participant_skills') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({ order: skillOrder }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({ order: portfolioOrder }),
        }),
      };
    });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      from,
    } as unknown as SupabaseClient);

    const result = await teamsRepository.listTeamApplications(sampleTeam.id);

    expect(requestTeam).toHaveBeenCalledWith('team_id', sampleTeam.id);
    expect(requestType).toHaveBeenCalledWith('request_type', 'Application');
    expect(requestStatus).toHaveBeenCalledWith('status', 'Pending');
    expect(requestOrder).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result).toEqual([
      expect.objectContaining({
        vacancyRole: 'Backend',
        teamName: sampleTeam.name,
        applicant: {
          displayName: 'Grace Hopper',
          handle: 'backend_dev',
          primaryRole: 'Backend',
          institution: 'George Brown College',
          skills: ['PostgreSQL'],
          portfolios: [{ url: 'https://example.com/grace', label: 'Projects' }],
        },
      }),
    ]);
    expect(result[0].application).not.toHaveProperty('vacancy');
  });

  it('acceptTeamInvitation calls the atomic RPC and returns membership state (#180)', async () => {
    const invitation = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      team_id: sampleTeam.id,
      event_id: sampleTeam.event_id,
      vacancy_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      participant_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      request_type: 'Invitation',
      status: 'Accepted',
      cancel_reason: null,
      resolved_at: '2026-10-20T12:00:00.000Z',
      expires_at: '2026-10-21T12:00:00.000Z',
      message: null,
      created_at: '2026-10-19T12:00:00.000Z',
      updated_at: '2026-10-20T12:00:00.000Z',
    } satisfies TeamRequest;
    const vacancy = {
      id: invitation.vacancy_id!,
      team_id: sampleTeam.id,
      role: 'Frontend',
      skills: ['React'],
      status: 'Filled',
      removed_at: null,
      created_at: '2026-10-19T12:00:00.000Z',
      updated_at: '2026-10-20T12:00:00.000Z',
    } satisfies TeamVacancy;
    const membership = {
      ...sampleMembership,
      participant_id: invitation.participant_id,
      role: 'Member',
    } satisfies TeamMembership;
    const payload = {
      accepted: true,
      invitation,
      membership,
      vacancy,
      teamName: sampleTeam.name,
      vacancyRole: vacancy.role,
      memberCount: 2,
      maxTeamSize: 4,
      availabilityCleared: true,
      membershipCommitted: true,
      cascade: {
        winningRequestId: invitation.id,
        eventInvitationsCanceled: 0,
        eventApplicationsWithdrawn: 1,
        slotRequestsCanceled: 1,
        teamRequestsCanceled: 0,
        teamNowFull: false,
      },
      notice: 'Invitation accepted.',
    };
    const mockRpc = vi.fn().mockResolvedValue({ data: payload, error: null });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      rpc: mockRpc,
    } as unknown as SupabaseClient);

    const result = await teamsRepository.acceptTeamInvitation(
      invitation.participant_id,
      invitation.id
    );

    expect(mockRpc).toHaveBeenCalledWith('accept_team_invitation', {
      p_actor: invitation.participant_id,
      p_invitation: invitation.id,
    });
    expect(result).toEqual(payload);
    expect(result.cascade.eventApplicationsWithdrawn).toBe(1);
  });

  it('approveTeamApplication calls the atomic approval RPC and returns committed state (#190)', async () => {
    const payload = {
      approved: true,
      application: { id: 'application-1' },
      membership: { id: 'membership-1' },
      vacancy: { id: 'vacancy-1' },
      teamName: sampleTeam.name,
      vacancyRole: 'Backend',
      memberCount: 2,
      maxTeamSize: 4,
      availabilityCleared: true,
      membershipCommitted: true,
      notice: 'Application approved.',
    };
    const rpc = vi.fn().mockResolvedValue({ data: payload, error: null });
    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({ rpc } as unknown as SupabaseClient);

    const result = await teamsRepository.approveTeamApplication('owner-1', 'application-1');

    expect(rpc).toHaveBeenCalledWith('approve_team_application', {
      p_actor: 'owner-1',
      p_application: 'application-1',
    });
    expect(result).toMatchObject({
      approved: true,
      availabilityCleared: true,
      membershipCommitted: true,
    });
  });

  it('acceptTeamInvitation converts a committed expiry payload into a domain failure', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        error: 'INVITATION_EXPIRED',
        details: { status: 'Expired', expiresAt: '2026-10-19T12:00:00.000Z' },
      },
      error: null,
    });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      rpc: mockRpc,
    } as unknown as SupabaseClient);

    await expect(
      teamsRepository.acceptTeamInvitation('actor-id', 'invitation-id')
    ).rejects.toMatchObject({
      message: 'INVITATION_EXPIRED',
      code: 'P0001',
    });
  });

  it('declineTeamInvitation returns persisted owner alert and unchanged roster effects (#182)', async () => {
    const invitation = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      team_id: sampleTeam.id,
      event_id: sampleTeam.event_id,
      vacancy_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      participant_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      request_type: 'Invitation',
      status: 'Declined',
      cancel_reason: 'INVITEE_DECLINED',
      resolved_at: '2026-10-20T12:00:00.000Z',
      expires_at: '2026-10-21T12:00:00.000Z',
      message: null,
      created_at: '2026-10-19T12:00:00.000Z',
      updated_at: '2026-10-20T12:00:00.000Z',
    } satisfies TeamRequest;
    const payload = {
      invitation,
      changed: true,
      idempotent: false,
      teamName: sampleTeam.name,
      vacancyRole: 'Frontend',
      alerts: [
        {
          audience: 'owner',
          type: 'team_invitation_declined',
          message: 'An invitee declined the pending invitation.',
          notificationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          createdAt: '2026-10-20T12:00:00.000Z',
        },
      ],
      effects: {
        invitationChanged: true,
        ownerAlertCreated: true,
        inviteeAlertCreated: true,
        availabilityChanged: false as const,
        membershipChanged: false as const,
        vacancyChanged: false as const,
      },
      notice: 'Invitation declined. The team owner has been notified.',
    };
    const mockRpc = vi.fn().mockResolvedValue({ data: payload, error: null });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      rpc: mockRpc,
    } as unknown as SupabaseClient);

    const result = await teamsRepository.declineTeamInvitation(
      invitation.participant_id,
      invitation.id
    );

    expect(mockRpc).toHaveBeenCalledWith('decline_team_invitation', {
      p_actor: invitation.participant_id,
      p_invitation: invitation.id,
    });
    expect(result).toEqual(payload);
  });

  it('declineTeamInvitation converts committed clock expiry into INVITATION_EXPIRED', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        error: 'INVITATION_EXPIRED',
        details: { status: 'Expired', expiresAt: '2026-10-19T12:00:00.000Z' },
      },
      error: null,
    });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      rpc: mockRpc,
    } as unknown as SupabaseClient);

    await expect(
      teamsRepository.declineTeamInvitation('actor-id', 'invitation-id')
    ).rejects.toMatchObject({
      message: 'INVITATION_EXPIRED',
      code: 'P0001',
      detail: expect.stringContaining('Expired'),
    });
  });
});


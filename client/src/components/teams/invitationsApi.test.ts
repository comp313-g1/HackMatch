import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cancelTeamInvitation,
  fetchTeamInvitations,
  issueTeamInvitation,
  revalidateInvitationAcceptance,
} from './invitationsApi';

const authFetchMock = vi.fn();

vi.mock('../../config/authFetch', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  AuthRequiredError: class AuthRequiredError extends Error {
    constructor() {
      super('AUTH_REQUIRED');
      this.name = 'AuthRequiredError';
    }
  },
}));

describe('teams invitationsApi (US-017 / #167 shared client)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  it('GETs owner invitation list', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          teamId: 't1',
          invitations: [],
          empty: true,
          message: 'No invitations yet.',
        }),
        { status: 200 }
      )
    );

    const result = await fetchTeamInvitations('t1');
    expect(authFetchMock).toHaveBeenCalledWith('/api/teams/t1/invitations', { method: 'GET' });
    expect(result.empty).toBe(true);
  });

  it('POSTs direct invitation issuance', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          invitation: {
            id: 'inv-1',
            teamId: 't1',
            eventId: 'e1',
            vacancyId: 'v1',
            inviteeParticipantId: 'p1',
            status: 'Pending',
            requestType: 'Invitation',
            expiresAt: '2026-10-21T00:00:00.000Z',
            createdAt: '2026-10-19T00:00:00.000Z',
            teamName: 'Team',
            vacancyRole: 'Frontend',
            source: 'direct',
            notice: 'Pending invitation created.',
          },
        }),
        { status: 201 }
      )
    );

    const invitation = await issueTeamInvitation('t1', {
      vacancyId: 'v1',
      inviteeParticipantId: 'p1',
      source: 'direct',
    });

    expect(authFetchMock).toHaveBeenCalledWith(
      '/api/teams/t1/invitations',
      expect.objectContaining({ method: 'POST' })
    );
    expect(invitation.status).toBe('Pending');
    expect(invitation.source).toBe('direct');
  });

  it('POSTs acceptance-time revalidation and returns eligible (#165)', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          eligible: true,
          invitation: {
            id: 'inv-1',
            teamId: 't1',
            eventId: 'e1',
            vacancyId: 'v1',
            inviteeParticipantId: 'p1',
            status: 'Pending',
            expiresAt: '2026-10-21T00:00:00.000Z',
            teamName: 'Team',
            vacancyRole: 'Frontend',
          },
          notice: 'Invitation is still valid within its 48-hour window.',
        }),
        { status: 200 }
      )
    );

    const result = await revalidateInvitationAcceptance('inv-1');
    expect(authFetchMock).toHaveBeenCalledWith(
      '/api/invitations/inv-1/accept',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.eligible).toBe(true);
  });

  it('surfaces INVITATION_EXPIRED field errors when past 48h (#165 / T3)', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'INVITATION_EXPIRED',
          error: 'This invitation has expired after 48 hours and can no longer be accepted.',
          errors: {
            invitationId:
              'This invitation has expired after 48 hours and can no longer be accepted.',
          },
        }),
        { status: 409 }
      )
    );

    await expect(revalidateInvitationAcceptance('inv-1')).rejects.toMatchObject({
      name: 'InvitationsApiError',
      code: 'INVITATION_EXPIRED',
      status: 409,
      errors: {
        invitationId: expect.stringMatching(/expired/i),
      },
    });
  });

  it('DELETEs invitation cancel and returns status alerts (#166)', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          invitation: {
            id: 'inv-1',
            teamId: 't1',
            eventId: 'e1',
            vacancyId: 'v1',
            inviteeParticipantId: 'p1',
            status: 'Canceled',
            requestType: 'Invitation',
            expiresAt: '2026-10-21T00:00:00.000Z',
            resolvedAt: '2026-10-19T15:00:00.000Z',
            cancelReason: 'OWNER_CANCELED',
            teamName: 'Team',
            vacancyRole: 'Frontend',
          },
          changed: true,
          idempotent: false,
          alerts: [
            {
              audience: 'owner',
              type: 'team_invitation_canceled',
              message: 'You canceled the pending invitation.',
            },
          ],
          notice: 'Pending invitation canceled.',
        }),
        { status: 200 }
      )
    );

    const result = await cancelTeamInvitation('inv-1');
    expect(authFetchMock).toHaveBeenCalledWith('/api/invitations/inv-1', {
      method: 'DELETE',
    });
    expect(result.invitation.status).toBe('Canceled');
    expect(result.alerts[0].type).toBe('team_invitation_canceled');
  });
});

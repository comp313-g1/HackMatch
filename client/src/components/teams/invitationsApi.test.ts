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

  it('POSTs atomic acceptance and returns confirmed membership (#180)', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          accepted: true,
          invitation: {
            id: 'inv-1',
            teamId: 't1',
            eventId: 'e1',
            vacancyId: 'v1',
            inviteeParticipantId: 'p1',
            status: 'Accepted',
            expiresAt: '2026-10-21T00:00:00.000Z',
            teamName: 'Team',
            vacancyRole: 'Frontend',
          },
          membership: {
            id: 'm1',
            teamId: 't1',
            eventId: 'e1',
            participantId: 'p1',
            role: 'Member',
            status: 'Confirmed',
            joinedAt: '2026-10-20T00:00:00.000Z',
          },
          vacancy: { id: 'v1', status: 'Filled', role: 'Frontend' },
          memberCount: 2,
          maxTeamSize: 4,
          availabilityCleared: true,
          notice: 'Invitation accepted. Team membership is confirmed.',
        }),
        { status: 200 }
      )
    );

    const result = await revalidateInvitationAcceptance('inv-1');
    expect(authFetchMock).toHaveBeenCalledWith(
      '/api/invitations/inv-1/accept',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.accepted).toBe(true);
    expect(result.membership.status).toBe('Confirmed');
    expect(result.vacancy.status).toBe('Filled');
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

  it('surfaces MFA_REQUIRED permission failures from issue endpoint (#168)', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'MFA_REQUIRED',
          error: 'Multi-factor authentication is required.',
        }),
        { status: 403 }
      )
    );

    await expect(
      issueTeamInvitation('t1', {
        vacancyId: 'v1',
        inviteeParticipantId: 'p1',
        source: 'direct',
      })
    ).rejects.toMatchObject({
      name: 'InvitationsApiError',
      code: 'MFA_REQUIRED',
      status: 403,
    });
  });

  it('surfaces FORBIDDEN_NOT_TEAM_OWNER on list (#168)', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'FORBIDDEN_NOT_TEAM_OWNER',
          error: 'You are not the owner of this team.',
        }),
        { status: 403 }
      )
    );

    await expect(fetchTeamInvitations('t1')).rejects.toMatchObject({
      name: 'InvitationsApiError',
      code: 'FORBIDDEN_NOT_TEAM_OWNER',
      status: 403,
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

  it('fetches my invitations, detail, and respond (#179)', async () => {
    const {
      fetchMyInvitations,
      fetchInvitationDetail,
      respondToInvitation,
    } = await import('./invitationsApi');

    authFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          invitations: [
            {
              id: 'inv-1',
              teamId: 't1',
              eventId: 'e1',
              vacancyId: 'v1',
              inviteeParticipantId: 'p1',
              status: 'Pending',
              statusLabel: 'Pending',
              requestType: 'Invitation',
              expiresAt: '2099-10-21T12:00:00.000Z',
              createdAt: '2026-10-19T12:00:00.000Z',
              resolvedAt: null,
              cancelReason: null,
              teamName: 'Team',
              vacancyRole: 'Frontend',
              expiredByClock: false,
              canRespond: true,
            },
          ],
          empty: false,
          message: null,
        }),
        { status: 200 }
      )
    );

    const listed = await fetchMyInvitations();
    expect(authFetchMock).toHaveBeenCalledWith('/api/invitations/mine', { method: 'GET' });
    expect(listed.invitations[0].canRespond).toBe(true);

    authFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          invitation: {
            ...listed.invitations[0],
            permittedDetails: {
              teamName: 'Team',
              vacancyRole: 'Frontend',
              expiresAt: '2099-10-21T12:00:00.000Z',
              statusLabel: 'Pending',
            },
          },
        }),
        { status: 200 }
      )
    );

    const detail = await fetchInvitationDetail('inv-1');
    expect(authFetchMock).toHaveBeenCalledWith('/api/invitations/inv-1', { method: 'GET' });
    expect(detail.permittedDetails?.teamName).toBe('Team');

    authFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          decision: 'decline',
          membershipCommitted: false,
          invitation: {
            id: 'inv-1',
            teamId: 't1',
            eventId: 'e1',
            vacancyId: 'v1',
            inviteeParticipantId: 'p1',
            status: 'Declined',
            statusLabel: 'Declined',
            requestType: 'Invitation',
            expiresAt: '2099-10-21T12:00:00.000Z',
            resolvedAt: '2026-10-19T16:00:00.000Z',
            cancelReason: 'INVITEE_DECLINED',
            teamName: 'Team',
            vacancyRole: 'Frontend',
          },
          changed: true,
          idempotent: false,
          alerts: [
            { audience: 'invitee', type: 'team_invitation_declined', message: 'You declined.' },
            { audience: 'owner', type: 'team_invitation_declined', message: 'Invitee declined.' },
          ],
          effects: {
            invitationChanged: true,
            ownerAlertCreated: true,
            inviteeAlertCreated: true,
            availabilityChanged: false,
            membershipChanged: false,
            vacancyChanged: false,
          },
          notice: 'Invitation declined.',
        }),
        { status: 200 }
      )
    );

    const declined = await respondToInvitation('inv-1', 'decline');
    expect(authFetchMock).toHaveBeenCalledWith(
      '/api/invitations/inv-1/respond',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'decline' }),
      })
    );
    expect(declined.invitation.status).toBe('Declined');
    expect(declined.effects).toMatchObject({
      ownerAlertCreated: true,
      availabilityChanged: false,
      membershipChanged: false,
      vacancyChanged: false,
    });
  });
});

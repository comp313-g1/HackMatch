import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchTeamInvitations, issueTeamInvitation } from './invitationsApi';

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

describe('teams invitationsApi (US-017 / #162)', () => {
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
});

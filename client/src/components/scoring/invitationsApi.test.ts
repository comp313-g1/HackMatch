import { describe, it, expect, vi, beforeEach } from 'vitest';
import { issueTeamInvitation } from './invitationsApi';

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

describe('issueTeamInvitation (FR-048)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  it('posts recommendation-sourced invitation and returns payload', async () => {
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
            source: 'recommendation',
            notice: 'Pending invitation created.',
          },
        }),
        { status: 201 }
      )
    );

    const invitation = await issueTeamInvitation('t1', {
      vacancyId: 'v1',
      inviteeParticipantId: 'p1',
      source: 'recommendation',
    });

    expect(authFetchMock).toHaveBeenCalledWith(
      '/api/teams/t1/invitations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          vacancyId: 'v1',
          inviteeParticipantId: 'p1',
          source: 'recommendation',
        }),
      })
    );
    expect(invitation.status).toBe('Pending');
    expect(invitation.source).toBe('recommendation');
  });

  it('throws InvitationsApiError on duplicate pending invite', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'DUPLICATE_PENDING_INVITATION',
          error: 'A pending invitation already exists for this candidate on this team.',
        }),
        { status: 409 }
      )
    );

    await expect(
      issueTeamInvitation('t1', {
        vacancyId: 'v1',
        inviteeParticipantId: 'p1',
      })
    ).rejects.toMatchObject({
      name: 'InvitationsApiError',
      code: 'DUPLICATE_PENDING_INVITATION',
      status: 409,
    });
  });

  it('surfaces #163 field errors for open-slot and availability failures', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'VACANCY_NOT_OPEN',
          error: 'This vacancy is not open. Invitations require an open slot.',
          errors: {
            vacancyId: 'This vacancy is not open. Invitations require an open slot.',
          },
        }),
        { status: 409 }
      )
    );

    await expect(
      issueTeamInvitation('t1', {
        vacancyId: 'v1',
        inviteeParticipantId: 'p1',
        source: 'recommendation',
      })
    ).rejects.toMatchObject({
      name: 'InvitationsApiError',
      code: 'VACANCY_NOT_OPEN',
      status: 409,
      errors: {
        vacancyId: expect.stringMatching(/open slot/i),
      },
    });
  });
});

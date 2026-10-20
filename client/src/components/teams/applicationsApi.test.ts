import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  APPLICATION_MESSAGE_MAX_LENGTH,
  MAX_PENDING_APPLICATIONS_PER_EVENT,
  approveTeamApplication,
  fetchMyApplications,
  fetchTeamApplications,
  isApplicationMessageTooLong,
  normalizeApplicationMessage,
  submitTeamApplication,
  withdrawTeamApplication,
} from './applicationsApi';

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

describe('applicationsApi (US-018 / #171)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  it('normalizes blank messages and detects >250 length without truncating', () => {
    expect(normalizeApplicationMessage('  hi  ')).toBe('hi');
    expect(normalizeApplicationMessage('   ')).toBeNull();
    expect(isApplicationMessageTooLong('a'.repeat(APPLICATION_MESSAGE_MAX_LENGTH))).toBe(false);
    expect(isApplicationMessageTooLong('a'.repeat(APPLICATION_MESSAGE_MAX_LENGTH + 1))).toBe(true);
  });

  it('POSTs application with optional message to team-scoped endpoint', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          application: {
            id: 'app-1',
            teamId: 't1',
            eventId: 'e1',
            vacancyId: 'v1',
            applicantParticipantId: 'p1',
            status: 'Pending',
            requestType: 'Application',
            message: 'Interested',
            createdAt: '2026-10-19T12:00:00.000Z',
            teamName: 'Team',
            vacancyRole: 'Frontend',
            notice: 'Pending Review application created.',
          },
        }),
        { status: 201 }
      )
    );

    const result = await submitTeamApplication('t1', {
      vacancyId: 'v1',
      message: '  Interested  ',
    });

    expect(authFetchMock).toHaveBeenCalledWith(
      '/api/teams/t1/applications',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ vacancyId: 'v1', message: 'Interested' }),
      })
    );
    expect(result.status).toBe('Pending');
    expect(result.message).toBe('Interested');
  });

  it('surfaces APPLICATION_MESSAGE_TOO_LONG field errors (#171 / T2)', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'APPLICATION_MESSAGE_TOO_LONG',
          error: 'Message must be at most 250 characters.',
          errors: {
            message: 'Message must be at most 250 characters.',
          },
        }),
        { status: 400 }
      )
    );

    await expect(
      submitTeamApplication('t1', {
        vacancyId: 'v1',
        message: 'x'.repeat(251),
      })
    ).rejects.toMatchObject({
      name: 'ApplicationsApiError',
      code: 'APPLICATION_MESSAGE_TOO_LONG',
      status: 400,
      errors: {
        message: expect.stringMatching(/250/i),
      },
    });
  });

  it('surfaces DUPLICATE_PENDING_APPLICATION failures', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'DUPLICATE_PENDING_APPLICATION',
          error:
            'You already have a pending application for this team. Withdraw it or wait for a decision before applying again.',
          errors: {
            _form:
              'You already have a pending application for this team. Withdraw it or wait for a decision before applying again.',
          },
          details: {
            teamId: 't1',
            existingApplicationId: 'app-existing',
          },
        }),
        { status: 409 }
      )
    );

    await expect(
      submitTeamApplication('t1', { vacancyId: 'v1', message: null })
    ).rejects.toMatchObject({
      name: 'ApplicationsApiError',
      code: 'DUPLICATE_PENDING_APPLICATION',
      status: 409,
      errors: {
        _form: expect.stringMatching(/withdraw it or wait/i),
      },
      details: {
        teamId: 't1',
        existingApplicationId: 'app-existing',
      },
    });
  });

  it('fetches My Applications and withdraws Pending rows (#175 / FR-055)', async () => {
    authFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          applications: [
            {
              id: 'app-1',
              teamId: 't1',
              eventId: 'e1',
              vacancyId: 'v1',
              applicantParticipantId: 'p1',
              status: 'Pending',
              statusLabel: 'Pending Review',
              requestType: 'Application',
              message: null,
              createdAt: '2026-10-19T12:00:00.000Z',
              resolvedAt: null,
              cancelReason: null,
              teamName: 'Team',
              vacancyRole: 'Frontend',
              withdrawable: true,
            },
          ],
          empty: false,
          message: null,
        }),
        { status: 200 }
      )
    );

    const listed = await fetchMyApplications();
    expect(authFetchMock).toHaveBeenCalledWith('/api/applications/mine');
    expect(listed.applications[0].statusLabel).toBe('Pending Review');

    authFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          application: {
            id: 'app-1',
            teamId: 't1',
            eventId: 'e1',
            vacancyId: 'v1',
            applicantParticipantId: 'p1',
            status: 'Withdrawn',
            statusLabel: 'Withdrawn',
            requestType: 'Application',
            message: null,
            resolvedAt: '2026-10-19T16:00:00.000Z',
            cancelReason: 'APPLICANT_WITHDRAWN',
            teamName: 'Team',
            vacancyRole: 'Frontend',
          },
          changed: true,
          idempotent: false,
          alerts: [
            { audience: 'applicant', type: 'team_application_withdrawn', message: 'You withdrew.' },
            { audience: 'owner', type: 'team_application_withdrawn', message: 'Applicant withdrew.' },
          ],
          notice: 'Pending Review application withdrawn.',
        }),
        { status: 200 }
      )
    );

    const withdrawn = await withdrawTeamApplication('app-1');
    expect(authFetchMock).toHaveBeenCalledWith(
      '/api/applications/app-1/withdraw',
      expect.objectContaining({ method: 'POST' })
    );
    expect(withdrawn.application.status).toBe('Withdrawn');
    expect(withdrawn.alerts).toHaveLength(2);
  });

  it('fetches the owner application review queue (#188 / FR-060)', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          teamId: 't1',
          applications: [],
          empty: true,
          message: 'No pending applications to review.',
        }),
        { status: 200 }
      )
    );

    const result = await fetchTeamApplications('t1');

    expect(authFetchMock).toHaveBeenCalledWith('/api/teams/t1/applications', {
      method: 'GET',
    });
    expect(result.empty).toBe(true);
  });

  it('POSTs an owner approval to the atomic application endpoint (#190)', async () => {
    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          approved: true,
          application: {
            id: 'app-1',
            teamId: 't1',
            eventId: 'e1',
            vacancyId: 'v1',
            applicantParticipantId: 'p1',
            status: 'Accepted',
            statusLabel: 'Accepted',
            requestType: 'Application',
            resolvedAt: '2026-10-20T18:00:00.000Z',
            teamName: 'Team',
            vacancyRole: 'Backend',
          },
          membership: {
            id: 'member-1',
            teamId: 't1',
            eventId: 'e1',
            participantId: 'p1',
            role: 'Member',
            status: 'Confirmed',
            joinedAt: '2026-10-20T18:00:00.000Z',
          },
          vacancy: { id: 'v1', role: 'Backend', status: 'Filled' },
          memberCount: 3,
          maxTeamSize: 4,
          availabilityCleared: true,
          membershipCommitted: true,
          notice: 'Application approved and membership confirmed.',
        }),
        { status: 200 }
      )
    );

    const result = await approveTeamApplication('app-1');

    expect(authFetchMock).toHaveBeenCalledWith('/api/applications/app-1/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(result).toMatchObject({
      approved: true,
      application: { status: 'Accepted' },
      membership: { status: 'Confirmed' },
      vacancy: { status: 'Filled' },
    });
  });

  it('surfaces APPLICATION_PENDING_LIMIT with details (#174 / FR-054)', async () => {
    expect(MAX_PENDING_APPLICATIONS_PER_EVENT).toBe(3);

    authFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'APPLICATION_PENDING_LIMIT',
          error:
            'You already have 3 pending applications for this event. Withdraw one or wait for a decision before applying again.',
          errors: {
            _form:
              'You already have 3 pending applications for this event. Withdraw one or wait for a decision before applying again.',
          },
          details: { limit: 3, pendingCount: 3 },
        }),
        { status: 409 }
      )
    );

    await expect(
      submitTeamApplication('t1', { vacancyId: 'v1', message: 'Still want in' })
    ).rejects.toMatchObject({
      name: 'ApplicationsApiError',
      code: 'APPLICATION_PENDING_LIMIT',
      status: 409,
      details: { limit: 3, pendingCount: 3 },
      message: expect.stringMatching(/3 pending/i),
    });
  });
});

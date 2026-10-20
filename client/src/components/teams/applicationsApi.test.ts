import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  APPLICATION_MESSAGE_MAX_LENGTH,
  isApplicationMessageTooLong,
  normalizeApplicationMessage,
  submitTeamApplication,
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
          error: 'You already have a pending application for this team.',
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
    });
  });
});

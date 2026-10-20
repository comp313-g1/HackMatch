import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createModerationCase,
  fetchModerationCaseDetail,
  fetchModerationCases,
  probeAdminModerationAccess,
  sortCasesNewestFirst,
  ModerationApiError,
} from './moderationApi';
import type { ModerationCaseView } from './moderationTypes';

vi.mock('../../config/authFetch', () => ({
  authFetch: vi.fn(),
  AuthRequiredError: class AuthRequiredError extends Error {
    readonly code = 'AUTH_REQUIRED';
    constructor() {
      super('You need to sign in first.');
      this.name = 'AuthRequiredError';
    }
  },
}));

import { authFetch } from '../../config/authFetch';

const authFetchMock = vi.mocked(authFetch);

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('moderationApi (US-026 / #241)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sortCasesNewestFirst orders by createdAt descending', () => {
    const cases: ModerationCaseView[] = [
      {
        id: 'a',
        targetType: 'team',
        targetId: 't1',
        reason: 'old',
        status: 'Open',
        reportCount: 0,
        flaggedUrl: null,
        createdAt: '2026-10-18T10:00:00.000Z',
        createdBy: 'admin',
      },
      {
        id: 'b',
        targetType: 'profile',
        targetId: 'p1',
        reason: 'new',
        status: 'Open',
        reportCount: 1,
        flaggedUrl: null,
        createdAt: '2026-10-18T12:00:00.000Z',
        createdBy: 'admin',
      },
    ];
    expect(sortCasesNewestFirst(cases).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('probeAdminModerationAccess returns granted on 200', async () => {
    authFetchMock.mockResolvedValueOnce(jsonResponse(200, { access: 'granted', role: 'ADMIN' }));
    await expect(probeAdminModerationAccess()).resolves.toBe('granted');
  });

  it('probeAdminModerationAccess returns denied on 403', async () => {
    authFetchMock.mockResolvedValueOnce(
      jsonResponse(403, { code: 'FORBIDDEN_ROLE', error: 'denied' })
    );
    await expect(probeAdminModerationAccess()).resolves.toBe('denied');
  });

  it('fetchModerationCases returns cases array on success', async () => {
    authFetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        cases: [
          {
            id: '1',
            targetType: 'team',
            targetId: 't',
            reason: 'spam',
            status: 'Open',
            reportCount: 0,
            flaggedUrl: null,
            createdAt: '2026-10-18T12:00:00.000Z',
            createdBy: 'a',
          },
        ],
      })
    );
    const cases = await fetchModerationCases();
    expect(cases).toHaveLength(1);
    expect(cases[0].reason).toBe('spam');
  });

  it('fetchModerationCaseDetail returns case + target', async () => {
    authFetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        case: {
          id: '1',
          targetType: 'team',
          targetId: 't',
          reason: 'spam',
          status: 'Open',
          reportCount: 0,
          flaggedUrl: null,
          createdAt: '2026-10-18T12:00:00.000Z',
          createdBy: 'a',
        },
        target: {
          type: 'team',
          team: {
            id: 't',
            name: 'Phishy',
            pitch: 'x',
            goal: 'Learning',
            commitmentHours: 10,
            communicationLink: null,
            recruitmentStatus: 'Open',
            eventId: 'e',
            ownerHandle: 'ada',
            ownerDisplayName: 'Ada',
          },
        },
      })
    );
    const detail = await fetchModerationCaseDetail('1');
    expect(detail.case.id).toBe('1');
    expect(detail.target.type).toBe('team');
  });

  it('createModerationCase echoes submitted field errors on 400', async () => {
    const input = {
      targetType: 'team' as const,
      targetId: 'not-uuid',
      reason: 'x',
    };
    authFetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        code: 'VALIDATION_ERROR',
        error: 'Validation failed.',
        errors: { targetId: 'targetId must be a valid UUID.' },
        submitted: input,
      })
    );

    await expect(createModerationCase(input)).rejects.toMatchObject({
      name: 'ModerationApiError',
      status: 400,
      code: 'VALIDATION_ERROR',
      errors: { targetId: 'targetId must be a valid UUID.' },
      submitted: input,
    } satisfies Partial<ModerationApiError>);
  });
});

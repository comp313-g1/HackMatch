import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authFetch } from '../../config/authFetch';
import { submitModerationReport } from './reportsApi';
import type { SubmitReportPayload } from './reportTypes';

const mockAuthState = {
  currentUser: null as unknown,
};

vi.mock('../../config/firebase', () => ({
  get auth() {
    return mockAuthState;
  },
}));

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

describe('submitModerationReport (US-025)', () => {
  const samplePayload: SubmitReportPayload = {
    targetType: 'team',
    targetId: '11111111-1111-4111-8111-111111111111',
    category: 'Harassment',
    explanation: 'Harassing content.',
    flaggedUrl: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.currentUser = null;
    vi.stubGlobal('fetch', vi.fn());
  });

  it('uses explicit authToken when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        data: {
          reportId: '99999999-9999-4999-8999-999999999999',
          caseId: '88888888-8888-4888-8888-888888888888',
          status: 'Received',
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await submitModerationReport(samplePayload, 'my-explicit-token');

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/reports',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer my-explicit-token',
        }),
      })
    );
  });

  it('uses authFetch when authToken is omitted and auth.currentUser is logged in', async () => {
    mockAuthState.currentUser = { uid: 'user-123' };
    vi.mocked(authFetch).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        data: {
          reportId: '99999999-9999-4999-8999-999999999999',
          caseId: '88888888-8888-4888-8888-888888888888',
          status: 'Received',
        },
      }),
    } as unknown as Response);

    const result = await submitModerationReport(samplePayload);

    expect(result.ok).toBe(true);
    expect(authFetch).toHaveBeenCalledWith(
      '/api/reports',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('returns client 401 when authToken is omitted and auth.currentUser is null', async () => {
    mockAuthState.currentUser = null;

    const result = await submitModerationReport(samplePayload);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error.code).toBe('UNAUTHORIZED');
      expect(result.error.message).toMatch(/You must be signed in/i);
    }
    expect(authFetch).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('handles 429 RATE_LIMITED response from server', async () => {
    mockAuthState.currentUser = { uid: 'user-123' };
    vi.mocked(authFetch).mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        error: {
          code: 'RATE_LIMITED',
          message: 'Rate limit exceeded: You may submit at most 5 reports per rolling hour.',
          retryAfterSeconds: 1200,
        },
      }),
    } as unknown as Response);

    const result = await submitModerationReport(samplePayload);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(429);
      expect(result.error.code).toBe('RATE_LIMITED');
      expect(result.error.retryAfterSeconds).toBe(1200);
    }
  });

  it('handles network failure gracefully', async () => {
    mockAuthState.currentUser = { uid: 'user-123' };
    vi.mocked(authFetch).mockRejectedValue(new Error('Connection lost'));

    const result = await submitModerationReport(samplePayload);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(0);
      expect(result.error.code).toBe('NETWORK_ERROR');
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getIdToken, type User } from 'firebase/auth';
import { authFetch, AuthRequiredError } from './authFetch';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return { ...actual, getIdToken: vi.fn() };
});

const mockGetIdToken = vi.mocked(getIdToken);
const user = { uid: 'fb-uid-1' } as User;

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const authHeaderOf = (call: unknown[]) => new Headers((call[1] as RequestInit).headers).get('Authorization');

describe('authFetch', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    mockGetIdToken.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    mockGetIdToken.mockResolvedValueOnce('token-1').mockResolvedValueOnce('token-2');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws AuthRequiredError when nobody is signed in', async () => {
    await expect(authFetch('/api/auth/me', {}, null)).rejects.toBeInstanceOf(AuthRequiredError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends the current ID token as a Bearer header and keeps other headers and options', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const response = await authFetch(
      '/api/teams',
      { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } },
      user
    );

    expect(response.status).toBe(200);
    expect(mockGetIdToken).toHaveBeenCalledWith(user, false);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/teams');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer token-1');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('force-refreshes the token and retries once when the server says TOKEN_EXPIRED', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(401, { code: 'TOKEN_EXPIRED' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const response = await authFetch('/api/auth/me', {}, user);

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockGetIdToken).toHaveBeenLastCalledWith(user, true);
    expect(authHeaderOf(mockFetch.mock.calls[1] as unknown[])).toBe('Bearer token-2');
  });

  it('retries only once if the refreshed token is still rejected', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(401, { code: 'TOKEN_EXPIRED' }))
      .mockResolvedValueOnce(jsonResponse(401, { code: 'TOKEN_EXPIRED' }));

    const response = await authFetch('/api/auth/me', {}, user);

    expect(response.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, { code: 'TOKEN_REVOKED' }],
    [401, { code: 'INVALID_TOKEN' }],
    [403, { code: 'MFA_REQUIRED' }],
    [500, { error: 'Internal Server Error' }],
  ])('does not retry on HTTP %i %j', async (status, body) => {
    mockFetch.mockResolvedValueOnce(jsonResponse(status, body));

    const response = await authFetch('/api/auth/me', {}, user);

    expect(response.status).toBe(status);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual(body);
  });

  it('does not retry on a 401 without a JSON body', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const response = await authFetch('/api/auth/me', {}, user);

    expect(response.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('propagates token refresh failures (e.g. offline) to the caller', async () => {
    mockGetIdToken.mockReset();
    mockFetch.mockResolvedValue(jsonResponse(200, {}));
    mockGetIdToken.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'auth/network-request-failed' }));

    await expect(authFetch('/api/auth/me', {}, user)).rejects.toMatchObject({
      code: 'auth/network-request-failed',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

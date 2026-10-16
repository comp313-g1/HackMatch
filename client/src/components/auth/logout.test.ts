import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getIdToken, signOut, type User } from 'firebase/auth';
import { logout } from './logout';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    getIdToken: vi.fn(),
    signOut: vi.fn(),
  };
});

const mockGetIdToken = vi.mocked(getIdToken);
const mockSignOut = vi.mocked(signOut);
const user = { uid: 'fb-uid-1' } as User;

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('logout', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    mockGetIdToken.mockReset();
    mockSignOut.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    mockGetIdToken.mockResolvedValue('id-token');
    mockSignOut.mockResolvedValue(undefined);
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      writable: true,
      value: '',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends Bearer + CSRF, revokes on the server, then signs out locally', async () => {
    document.cookie = 'hm_csrf=csrf-token-value';
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { code: 'LOGGED_OUT' }));

    await logout(user);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/auth/session',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': 'csrf-token-value',
          Authorization: 'Bearer id-token',
        },
      })
    );
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('treats NO_SESSION as success and still clears the local Firebase session', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, { code: 'NO_SESSION' }));

    await expect(logout(user)).resolves.toBeUndefined();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('throws a CSRF error after clearing the local session', async () => {
    document.cookie = 'hm_csrf=csrf-token-value';
    mockFetch.mockResolvedValueOnce(jsonResponse(403, { code: 'CSRF_TOKEN_INVALID' }));

    await expect(logout(user)).rejects.toMatchObject({
      kind: 'csrf',
      code: 'CSRF_TOKEN_INVALID',
    });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('throws a revocation warning when the server could not revoke all devices', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(503, { code: 'REVOCATION_FAILED' }));

    await expect(logout(user)).rejects.toMatchObject({ kind: 'revocation' });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('throws a network error when fetch fails, after local sign-out', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(logout(user)).rejects.toMatchObject({ kind: 'network' });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('still calls the API when getIdToken fails (cookie-only logout)', async () => {
    document.cookie = 'hm_csrf=csrf-token-value';
    mockGetIdToken.mockRejectedValueOnce(new Error('no token'));
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { code: 'LOGGED_OUT' }));

    await logout(user);

    const init = mockFetch.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-token-value');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});

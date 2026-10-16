import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getIdToken, signOut, type User } from 'firebase/auth';
import { assertAccountActive } from './accountStatus';

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

describe('assertAccountActive', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    mockGetIdToken.mockReset();
    mockSignOut.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    mockGetIdToken.mockResolvedValue('id-token');
    mockSignOut.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves when the account is active', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { active: true }));

    await expect(assertAccountActive(user)).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith('/api/auth/account-status', {
      headers: { Authorization: 'Bearer id-token' },
    });
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('signs out and throws ACCOUNT_SUSPENDED when the account is suspended', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(403, { code: 'ACCOUNT_SUSPENDED', error: 'suspended' })
    );

    await expect(assertAccountActive(user)).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('signs out and throws ACCOUNT_DISABLED when Firebase disabled the user', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(403, { code: 'ACCOUNT_DISABLED' }));

    await expect(assertAccountActive(user)).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('maps network failures to auth/network-request-failed', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(assertAccountActive(user)).rejects.toMatchObject({
      code: 'auth/network-request-failed',
    });
  });
});

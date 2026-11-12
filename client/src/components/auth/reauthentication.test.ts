import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  type User,
} from 'firebase/auth';
import { githubProvider, googleProvider } from '../../config/firebase';
import {
  describeReauthError,
  primaryReauthMethods,
  reauthenticateWithPassword,
  reauthenticateWithProvider,
} from './reauthentication';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    reauthenticateWithCredential: vi.fn(),
    reauthenticateWithPopup: vi.fn(),
  };
});

const user = (providers: string[], email: string | null = 'owner@example.com') =>
  ({
    uid: 'fb-owner',
    email,
    providerData: providers.map((providerId) => ({ providerId })),
  }) as unknown as User;

describe('Firebase primary reauthentication (US-029 / #269)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists only the linked primary methods, password first', () => {
    expect(primaryReauthMethods(user(['github.com', 'password', 'google.com']))).toEqual([
      'password',
      'google',
      'github',
    ]);
    expect(primaryReauthMethods(user(['google.com']))).toEqual(['google']);
    expect(primaryReauthMethods(user(['phone', 'oidc.unknown']))).toEqual([]);
  });

  it('reauthenticates the signed-in owner with an email/password credential', async () => {
    const owner = user(['password']);
    vi.mocked(reauthenticateWithCredential).mockResolvedValue({} as never);
    await reauthenticateWithPassword(owner, 'Correct-Horse-1');
    expect(reauthenticateWithCredential).toHaveBeenCalledWith(
      owner,
      EmailAuthProvider.credential('owner@example.com', 'Correct-Horse-1')
    );
  });

  it('refuses password reauthentication without an account email', async () => {
    await expect(reauthenticateWithPassword(user(['password'], null), 'x')).rejects.toMatchObject({
      code: 'auth/missing-email',
    });
    expect(reauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it('reauthenticates linked OAuth owners with the existing configured providers', async () => {
    const owner = user(['google.com', 'github.com']);
    vi.mocked(reauthenticateWithPopup).mockResolvedValue({} as never);
    await reauthenticateWithProvider(owner, 'google');
    await reauthenticateWithProvider(owner, 'github');
    expect(reauthenticateWithPopup).toHaveBeenNthCalledWith(1, owner, googleProvider);
    expect(reauthenticateWithPopup).toHaveBeenNthCalledWith(2, owner, githubProvider);
  });

  it.each([
    ['auth/wrong-password', 'credentials', /incorrect password/i],
    ['auth/invalid-credential', 'credentials', /incorrect password/i],
    ['auth/popup-closed-by-user', 'cancelled', /cancelled/i],
    ['auth/popup-blocked', 'cancelled', /blocked/i],
    ['auth/user-mismatch', 'mismatch', /different account/i],
    ['auth/user-token-expired', 'session', /session has ended/i],
    ['auth/too-many-requests', 'throttled', /too many/i],
    ['auth/network-request-failed', 'network', /network/i],
    ['auth/internal-error', 'unknown', /could not verify/i],
  ])('maps %s to a safe %s message', (code, kind, message) => {
    const result = describeReauthError(Object.assign(new Error('firebase internals'), { code }));
    expect(result.kind).toBe(kind);
    expect(result.message).toMatch(message);
    expect(result.message).not.toMatch(/firebase|auth\//i);
  });
});

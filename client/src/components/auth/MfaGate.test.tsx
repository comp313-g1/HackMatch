import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  onAuthStateChanged,
  getIdTokenResult,
  signOut,
  type User,
  type IdTokenResult,
} from 'firebase/auth';
import { MfaGate } from './MfaGate';
import { MFA_CLAIM } from './mfaClaim';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    onAuthStateChanged: vi.fn(),
    getIdTokenResult: vi.fn(),
    signOut: vi.fn(),
  };
});

const mockOnAuthStateChanged = vi.mocked(onAuthStateChanged);
const mockGetIdTokenResult = vi.mocked(getIdTokenResult);
const mockSignOut = vi.mocked(signOut);

const AUTH_TIME = 1_792_000_000;
const user = { uid: 'fb-uid-1', email: 'jane@example.com' } as User;

const tokenResult = (claims: Record<string, unknown>) =>
  ({ claims: { auth_time: AUTH_TIME, ...claims } }) as unknown as IdTokenResult;

const verifiedToken = tokenResult({ [MFA_CLAIM]: AUTH_TIME });
const passwordOnlyToken = tokenResult({});

const firebaseError = (code: string) => Object.assign(new Error(code), { code });

let emitAuthState: (u: User | null) => void = () => {};
const unsubscribe = vi.fn();

const renderGate = (onNavigateToSignIn = vi.fn()) => {
  render(
    <MfaGate onNavigateToSignIn={onNavigateToSignIn}>
      {(u) => <p>Protected content for {u.email}</p>}
    </MfaGate>
  );
  return { onNavigateToSignIn };
};

describe('MfaGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnAuthStateChanged.mockImplementation(((_auth: unknown, cb: (u: User | null) => void) => {
      emitAuthState = cb;
      return unsubscribe;
    }) as unknown as typeof onAuthStateChanged);
    mockSignOut.mockResolvedValue(undefined);
  });

  it('shows a loading state until Firebase reports the auth state', () => {
    renderGate();

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent(/checking your session/i);
    expect(screen.queryByText(/protected content/i)).not.toBeInTheDocument();
  });

  it('shows the signed-out (empty) state and links to sign in', () => {
    const { onNavigateToSignIn } = renderGate();

    act(() => emitAuthState(null));

    expect(screen.getByText(/you are not signed in/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /go to sign in/i }));
    expect(onNavigateToSignIn).toHaveBeenCalledTimes(1);
    expect(mockGetIdTokenResult).not.toHaveBeenCalled();
  });

  it('renders protected content only when the current sign-in has passed MFA', async () => {
    mockGetIdTokenResult.mockResolvedValueOnce(verifiedToken);
    renderGate();

    act(() => emitAuthState(user));

    expect(await screen.findByText('Protected content for jane@example.com')).toBeInTheDocument();
    expect(mockGetIdTokenResult).toHaveBeenCalledWith(user, false);
  });

  it('blocks password-only sessions and asks for the email code', async () => {
    mockGetIdTokenResult.mockResolvedValueOnce(passwordOnlyToken);
    renderGate();

    act(() => emitAuthState(user));

    expect(await screen.findByText(/email code required/i)).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.queryByText(/protected content/i)).not.toBeInTheDocument();
  });

  it('blocks a session whose MFA claim belongs to an earlier sign-in', async () => {
    mockGetIdTokenResult.mockResolvedValueOnce(tokenResult({ [MFA_CLAIM]: AUTH_TIME - 3600 }));
    renderGate();

    act(() => emitAuthState(user));

    expect(await screen.findByText(/email code required/i)).toBeInTheDocument();
  });

  it('force-refreshes the token on recheck and unlocks once the claim arrives', async () => {
    mockGetIdTokenResult.mockResolvedValueOnce(passwordOnlyToken).mockResolvedValueOnce(verifiedToken);
    renderGate();
    act(() => emitAuthState(user));
    await screen.findByText(/email code required/i);

    fireEvent.click(screen.getByRole('button', { name: /i've entered my code/i }));

    expect(await screen.findByText('Protected content for jane@example.com')).toBeInTheDocument();
    expect(mockGetIdTokenResult).toHaveBeenLastCalledWith(user, true);
  });

  it('shows a loading label while rechecking and a warning if the code is still not confirmed', async () => {
    let resolveRecheck: (value: IdTokenResult) => void = () => {};
    mockGetIdTokenResult
      .mockResolvedValueOnce(passwordOnlyToken)
      .mockReturnValueOnce(new Promise<IdTokenResult>((resolve) => { resolveRecheck = resolve; }));
    renderGate();
    act(() => emitAuthState(user));
    await screen.findByText(/email code required/i);

    fireEvent.click(screen.getByRole('button', { name: /i've entered my code/i }));
    const busy = screen.getByRole('button', { name: /checking/i });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(mockGetIdTokenResult).toHaveBeenCalledTimes(2);

    await act(async () => resolveRecheck(passwordOnlyToken));

    expect(screen.getByRole('alert')).toHaveTextContent(/has not been confirmed yet/i);
    expect(screen.queryByText(/protected content/i)).not.toBeInTheDocument();
  });

  it('shows a retryable error when the session check fails on the network', async () => {
    mockGetIdTokenResult
      .mockRejectedValueOnce(firebaseError('auth/network-request-failed'))
      .mockResolvedValueOnce(verifiedToken);
    renderGate();

    act(() => emitAuthState(user));

    expect(await screen.findByRole('alert')).toHaveTextContent(/network error/i);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Protected content for jane@example.com')).toBeInTheDocument();
  });

  it('sends the user back to sign in when the session has ended', async () => {
    mockGetIdTokenResult.mockRejectedValueOnce(firebaseError('auth/user-token-expired'));
    const { onNavigateToSignIn } = renderGate();

    act(() => emitAuthState(user));

    expect(await screen.findByRole('alert')).toHaveTextContent(/session has ended/i);
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /go to sign in/i }));
    expect(onNavigateToSignIn).toHaveBeenCalled();
  });

  it('signs out from the MFA-required state', async () => {
    mockGetIdTokenResult.mockResolvedValueOnce(passwordOnlyToken);
    renderGate();
    act(() => emitAuthState(user));
    await screen.findByText(/email code required/i);

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(mockSignOut).toHaveBeenCalledTimes(1);

    act(() => emitAuthState(null));
    expect(await screen.findByText(/you are not signed in/i)).toBeInTheDocument();
  });

  it('shows an error if signing out fails', async () => {
    mockGetIdTokenResult.mockResolvedValueOnce(passwordOnlyToken);
    mockSignOut.mockRejectedValueOnce(firebaseError('auth/network-request-failed'));
    renderGate();
    act(() => emitAuthState(user));
    await screen.findByText(/email code required/i);

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/network error/i);
  });

  it('locks protected content again when the user signs out elsewhere', async () => {
    mockGetIdTokenResult.mockResolvedValueOnce(verifiedToken);
    renderGate();
    act(() => emitAuthState(user));
    await screen.findByText(/protected content/i);

    act(() => emitAuthState(null));

    expect(screen.queryByText(/protected content/i)).not.toBeInTheDocument();
    expect(screen.getByText(/you are not signed in/i)).toBeInTheDocument();
  });

  it('unsubscribes from Firebase auth state on unmount', () => {
    const { unmount } = render(<MfaGate>{() => null}</MfaGate>);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

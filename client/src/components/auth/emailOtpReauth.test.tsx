import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getIdToken, type User } from 'firebase/auth';
import { ReauthenticationPanel } from './ReauthenticationPanel';
import { reauthenticateWithPassword } from './reauthentication';
import { requestMfaChallenge, _resetMfaChallengeInflight } from './mfaChallenge';
import { verifyMfaCode } from './mfaVerify';

/**
 * US-029 / #271 React regression: the #269 reauthentication step 2 is the
 * unmodified US-004 OtpEntryForm, so ordinary email OTP semantics (attempt
 * errors, the 15-minute lock UI, fresh-auth guidance, forced token refresh)
 * apply unchanged. Layer: React. The real ReauthenticationPanel and real
 * OtpEntryForm render; Firebase and the OTP API functions are mocked.
 */

const mockAuth = vi.hoisted(() => ({ currentUser: null as unknown }));
vi.mock('../../config/firebase', () => ({ auth: mockAuth, googleProvider: {}, githubProvider: {} }));
vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return { ...actual, getIdToken: vi.fn() };
});
vi.mock('./reauthentication', async (importOriginal) => {
  const original = await importOriginal<typeof import('./reauthentication')>();
  return { ...original, reauthenticateWithPassword: vi.fn(), reauthenticateWithProvider: vi.fn() };
});
vi.mock('./mfaChallenge', async (importOriginal) => {
  const original = await importOriginal<typeof import('./mfaChallenge')>();
  return { ...original, requestMfaChallenge: vi.fn() };
});
vi.mock('./mfaVerify', () => ({ verifyMfaCode: vi.fn() }));
vi.mock('./logout', () => ({ logout: vi.fn().mockResolvedValue(undefined) }));

const owner = { uid: 'fb-owner', email: 'owner@example.com', providerData: [{ providerId: 'password' }] } as unknown as User;
const challenge = {
  requiresOtp: true as const,
  challengeId: 'challenge-reauth-1',
  email: 'o***r@example.com',
  expiresInSeconds: 600,
  message: 'A 6-digit verification code has been sent to your email.',
};
const otpError = (code: string, message: string, retryAfter?: number) =>
  Object.assign(new Error(message), { code, retryAfter });

const consoleLines: string[] = [];

async function reachEmailStep() {
  const onReauthenticated = vi.fn();
  render(
    <ReauthenticationPanel
      purpose="turn off your authenticator app"
      onReauthenticated={onReauthenticated}
      onCancel={vi.fn()}
    />
  );
  fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'Right-Pass-1' } });
  fireEvent.click(screen.getByRole('button', { name: /verify password/i }));
  await screen.findByRole('heading', { name: /step 2 of 2/i });
  return { onReauthenticated };
}

function submitCode(code: string) {
  fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: /verify code/i }));
}

describe('#269 reauthentication step 2 keeps US-004 email OTP semantics (#271)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetMfaChallengeInflight();
    mockAuth.currentUser = owner;
    consoleLines.length = 0;
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(reauthenticateWithPassword).mockResolvedValue(undefined);
    vi.mocked(requestMfaChallenge).mockResolvedValue(challenge);
    vi.mocked(getIdToken).mockResolvedValue('refreshed-token');
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleLines.push(args.map(String).join(' '));
      });
    }
  });

  afterEach(() => vi.restoreAllMocks());

  it('requests the existing email challenge, verifies, force-refreshes the token, then resumes once', async () => {
    vi.mocked(verifyMfaCode).mockResolvedValueOnce({ verified: true, message: 'ok' });
    const { onReauthenticated } = await reachEmailStep();

    expect(await screen.findByText(/o\*\*\*r@example\.com/)).toBeInTheDocument();
    expect(requestMfaChallenge).toHaveBeenCalledWith(owner);
    submitCode('482913');

    await waitFor(() => expect(onReauthenticated).toHaveBeenCalledTimes(1));
    expect(verifyMfaCode).toHaveBeenCalledWith(owner, 'challenge-reauth-1', '482913');
    // The refreshed token carries the new mfa_auth_time for the new auth_time.
    expect(getIdToken).toHaveBeenCalledWith(owner, true);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('482913');
    expect(window.location.href).not.toContain('482913');
    expect(consoleLines.join('\n')).not.toContain('482913');
  });

  it('counts wrong codes and shows the 15-minute lock exactly like sign-in; never resumes while locked', async () => {
    vi.mocked(verifyMfaCode)
      .mockRejectedValueOnce(otpError('INVALID_OTP', 'Incorrect verification code. Please try again.'))
      .mockRejectedValueOnce(
        otpError(
          'ACCOUNT_LOCKED',
          'Account temporarily locked due to too many failed OTP attempts. Please wait 15 minutes before trying again.',
          900
        )
      );
    const { onReauthenticated } = await reachEmailStep();
    await screen.findByLabelText(/6-digit code/i);

    submitCode('111111');
    expect(await screen.findByText(/incorrect verification code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/6-digit code/i)).toHaveValue(''); // wrong code is cleared

    submitCode('222222');
    expect(await screen.findByText(/locked for/i)).toHaveTextContent('15:00');
    expect(screen.getByRole('button', { name: /verify code/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /locked \(15:00\)/i })).toBeDisabled();
    expect(onReauthenticated).not.toHaveBeenCalled();
    expect(getIdToken).not.toHaveBeenCalled();
  });

  it('shows the lock immediately when reauthentication starts during an active lock', async () => {
    vi.mocked(requestMfaChallenge).mockRejectedValueOnce(
      otpError('ACCOUNT_LOCKED', 'Account temporarily locked due to too many failed OTP attempts.', 600)
    );
    const { onReauthenticated } = await reachEmailStep();
    expect(await screen.findByText(/account locked/i)).toHaveTextContent('10:00');
    expect(screen.getByRole('button', { name: /try sending again/i })).toBeDisabled();
    expect(verifyMfaCode).not.toHaveBeenCalled();
    expect(onReauthenticated).not.toHaveBeenCalled();
  });

  it('presents the aligned FRESH_AUTH_REQUIRED response as safe guidance with a sign-out path', async () => {
    vi.mocked(requestMfaChallenge).mockRejectedValueOnce(
      otpError(
        'FRESH_AUTH_REQUIRED',
        'Your account was previously locked. Please sign in again with your password or credentials before requesting a new code.'
      )
    );
    const { onReauthenticated } = await reachEmailStep();
    expect(await screen.findByRole('alert')).toHaveTextContent(/previously locked.*sign in again/i);
    expect(screen.getByRole('button', { name: /sign out/i })).toBeEnabled();
    expect(onReauthenticated).not.toHaveBeenCalled();
  });
});

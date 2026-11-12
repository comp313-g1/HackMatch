import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getIdTokenResult, onAuthStateChanged, type IdTokenResult, type User } from 'firebase/auth';
import { MfaGate } from './MfaGate';
import { SignedInPanel } from './SignedInPanel';
import { MFA_CLAIM } from './mfaClaim';
import {
  AuthenticatorEnrollmentApiError,
  beginAuthenticatorEnrollment,
  confirmAuthenticatorEnrollment,
  generateRecoveryCodes,
  getAuthenticatorEnrollmentStatus,
  getRecoveryCodeStatus,
  type PendingAuthenticatorEnrollment,
} from './authenticatorEnrollmentApi';

/**
 * US-029 / #270 React isolation suite.
 *
 * Layer: React. Renders the real MfaGate → SignedInPanel →
 * AuthenticatorEnrollmentCard/RecoveryCodesPanel tree. Firebase auth state and
 * the authenticator API module are mocked; no network or server is involved.
 */

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return { ...actual, onAuthStateChanged: vi.fn(), getIdTokenResult: vi.fn() };
});

vi.mock('./logout', () => ({ logout: vi.fn().mockResolvedValue(undefined) }));

vi.mock('./authenticatorEnrollmentApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('./authenticatorEnrollmentApi')>();
  return {
    ...original,
    beginAuthenticatorEnrollment: vi.fn(),
    confirmAuthenticatorEnrollment: vi.fn(),
    generateRecoveryCodes: vi.fn(),
    getAuthenticatorEnrollmentStatus: vi.fn(),
    getRecoveryCodeStatus: vi.fn(),
  };
});

vi.mock('./ReauthenticationPanel', () => ({
  ReauthenticationPanel: ({ onReauthenticated }: { onReauthenticated: () => void }) => (
    <div data-testid="reauthentication-panel">
      <button type="button" onClick={onReauthenticated}>
        Complete verification
      </button>
    </div>
  ),
}));

const AUTH_TIME = 1_792_000_000;
const PART_A = { uid: 'fb-part-a', email: 'part-a@example.com' } as User;
const ADMIN_B = { uid: 'fb-admin-b', email: 'admin-b@example.com' } as User;
const PART_B = { uid: 'fb-part-b', email: 'part-b@example.com' } as User;

const SETUP_KEY = 'ACCOUNTAONLYSECRETKEY234567ABCD';
const SETUP_URI = `otpauth://totp/HackMatch%3AHackMatch%20account?secret=${SETUP_KEY}&issuer=HackMatch`;
const RECOVERY = ['AAAA-BBBB-CC22', 'DDDD-EEEE-FF33'];

const pendingForA: PendingAuthenticatorEnrollment = {
  authenticator: {
    status: 'pending',
    enrollmentId: 'enrollment_account_a',
    expiresAt: '2026-11-11T18:10:00.000Z',
    issuer: 'HackMatch',
    accountLabel: 'HackMatch account',
    algorithm: 'SHA1',
    digits: 6,
    periodSeconds: 30,
  },
  setup: { otpauthUri: SETUP_URI, manualEntryKey: SETUP_KEY },
  availableChallengeMethods: ['email_otp'],
  emailOtpFallback: true,
};

const notEnrolled = {
  authenticator: { status: 'not_enrolled' as const },
  availableChallengeMethods: ['email_otp'] as Array<'authenticator_totp' | 'email_otp'>,
  emailOtpFallback: true as const,
};
const active = {
  authenticator: { status: 'active' as const, activatedAt: '2026-11-11T18:05:00.000Z' },
  availableChallengeMethods: ['authenticator_totp', 'email_otp'] as Array<'authenticator_totp' | 'email_otp'>,
  emailOtpFallback: true as const,
};

let emitAuthState: (user: User | null) => void = () => {};
const consoleLines: string[] = [];

function renderApp() {
  return render(
    <MfaGate>{(user) => <SignedInPanel email={user.email} />}</MfaGate>
  );
}

async function signIn(user: User) {
  await act(async () => emitAuthState(user));
  await screen.findByTestId('authenticator-enrollment-card');
}

async function signOut() {
  await act(async () => emitAuthState(null));
  await screen.findByText(/you are not signed in/i);
}

function expectNoAccountASecretsAnywhere() {
  const dom = document.body.innerHTML;
  for (const secret of [SETUP_KEY, SETUP_URI, 'enrollment_account_a', ...RECOVERY]) {
    expect(dom).not.toContain(secret);
  }
  expect(screen.queryByTestId('authenticator-qr-code')).not.toBeInTheDocument();
  expect(screen.queryByTestId('recovery-codes-list')).not.toBeInTheDocument();
  expect(screen.queryByTestId('reauthentication-panel')).not.toBeInTheDocument();
}

function expectNoSecretsPersistedOrInUrl() {
  const persisted = JSON.stringify({ ...localStorage, ...sessionStorage });
  const url = window.location.href;
  for (const secret of [SETUP_KEY, 'otpauth', ...RECOVERY]) {
    expect(persisted).not.toContain(secret);
    expect(url).not.toContain(secret);
  }
  expect(window.history.pushState).not.toHaveBeenCalled();
  expect(window.history.replaceState).not.toHaveBeenCalled();
  expect(consoleLines.join('\n')).not.toMatch(new RegExp([SETUP_KEY, ...RECOVERY].join('|')));
}

describe('authenticator secret isolation in the React tree (#270)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleLines.length = 0;
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(onAuthStateChanged).mockImplementation(((_auth: unknown, cb: (u: User | null) => void) => {
      emitAuthState = cb;
      return vi.fn();
    }) as unknown as typeof onAuthStateChanged);
    vi.mocked(getIdTokenResult).mockResolvedValue({
      claims: { auth_time: AUTH_TIME, [MFA_CLAIM]: AUTH_TIME },
    } as unknown as IdTokenResult);
    vi.mocked(getAuthenticatorEnrollmentStatus).mockResolvedValue(notEnrolled);
    vi.mocked(getRecoveryCodeStatus).mockResolvedValue({ status: 'not_generated', total: 0, remaining: 0 });
    vi.spyOn(window.history, 'pushState');
    vi.spyOn(window.history, 'replaceState');
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleLines.push(args.map((arg) => String(arg)).join(' '));
      });
    }
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['PART → ADMIN', ADMIN_B],
    ['PART → PART', PART_B],
  ])('%s: account A’s QR and setup key never reach account B after sign-out', async (_label, nextUser) => {
    vi.mocked(beginAuthenticatorEnrollment).mockResolvedValueOnce(pendingForA);
    renderApp();
    await signIn(PART_A);
    fireEvent.click(await screen.findByRole('button', { name: /set up authenticator app/i }));
    expect(await screen.findByText(SETUP_KEY)).toBeInTheDocument();
    expect(screen.getByTestId('authenticator-qr-code')).toBeInTheDocument();

    await signOut();
    expectNoAccountASecretsAnywhere();

    await signIn(nextUser);
    expect(await screen.findByRole('button', { name: /set up authenticator app/i })).toBeEnabled();
    expectNoAccountASecretsAnywhere();
    expectNoSecretsPersistedOrInUrl();
  });

  it('account A’s one-time recovery codes never reach account B', async () => {
    vi.mocked(getAuthenticatorEnrollmentStatus).mockResolvedValueOnce(active);
    vi.mocked(generateRecoveryCodes).mockResolvedValueOnce({
      status: 'generated',
      batchId: '30000000-0000-4000-8000-00000000000a',
      total: 2,
      remaining: 2,
      generatedAt: '2026-11-11T18:20:00.000Z',
      codes: RECOVERY,
    });
    renderApp();
    await signIn(PART_A);
    fireEvent.click(await screen.findByRole('button', { name: /^generate recovery codes$/i }));
    expect(await screen.findByTestId('recovery-codes-list')).toHaveValue(RECOVERY.join('\n'));

    await signOut();
    await signIn(ADMIN_B);
    await screen.findByRole('button', { name: /set up authenticator app/i });
    expectNoAccountASecretsAnywhere();
    expectNoSecretsPersistedOrInUrl();
  });

  it('a pending reauthentication queued by account A is discarded on account change', async () => {
    vi.mocked(beginAuthenticatorEnrollment).mockRejectedValueOnce(
      new AuthenticatorEnrollmentApiError(401, 'REAUTHENTICATION_REQUIRED', 'Recent reauthentication is required.')
    );
    renderApp();
    await signIn(PART_A);
    fireEvent.click(await screen.findByRole('button', { name: /set up authenticator app/i }));
    await screen.findByTestId('reauthentication-panel');

    await signOut();
    await signIn(ADMIN_B);
    await screen.findByRole('button', { name: /set up authenticator app/i });
    expectNoAccountASecretsAnywhere();
    // A's queued "begin" was never retried on B's behalf.
    expect(beginAuthenticatorEnrollment).toHaveBeenCalledTimes(1);
  });

  it('a late setup response for account A is dropped after the account changes', async () => {
    let resolveA: (value: PendingAuthenticatorEnrollment) => void = () => {};
    vi.mocked(beginAuthenticatorEnrollment).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveA = resolve;
      })
    );
    renderApp();
    await signIn(PART_A);
    fireEvent.click(await screen.findByRole('button', { name: /set up authenticator app/i }));
    expect(screen.getByRole('button', { name: /starting setup/i })).toBeDisabled();

    await signOut();
    await signIn(ADMIN_B);
    await act(async () => resolveA(pendingForA));
    await waitFor(() => expect(screen.getByRole('button', { name: /set up authenticator app/i })).toBeEnabled());
    expectNoAccountASecretsAnywhere();
  });

  it('an unrecoverable session failure during confirmation clears setup material', async () => {
    vi.mocked(beginAuthenticatorEnrollment).mockResolvedValueOnce(pendingForA);
    vi.mocked(confirmAuthenticatorEnrollment).mockRejectedValueOnce(
      new AuthenticatorEnrollmentApiError(401, 'TOKEN_REVOKED', 'Session revoked.')
    );
    renderApp();
    await signIn(PART_A);
    fireEvent.click(await screen.findByRole('button', { name: /set up authenticator app/i }));
    await screen.findByText(SETUP_KEY);
    fireEvent.change(screen.getByLabelText(/authenticator code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm authenticator/i }));

    await waitFor(() => expect(screen.queryByText(SETUP_KEY)).not.toBeInTheDocument());
    expect(screen.queryByTestId('authenticator-qr-code')).not.toBeInTheDocument();
    expect(confirmAuthenticatorEnrollment).toHaveBeenCalledWith('enrollment_account_a', '123456');
    expect(await screen.findByTestId('authenticator-enrollment-error')).toHaveTextContent(/session revoked/i);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { getIdToken, type User } from 'firebase/auth';
import { SignedInPanel } from './SignedInPanel';
import { authFetch } from '../../config/authFetch';
import { reauthenticateWithPassword } from './reauthentication';
import { requestMfaChallenge, _resetMfaChallengeInflight } from './mfaChallenge';
import { verifyMfaCode } from './mfaVerify';

/**
 * US-029 / #272 React journey (integration-style).
 *
 * Renders the real SignedInPanel → AuthenticatorEnrollmentCard →
 * RecoveryCodesPanel → ReauthenticationPanel → OtpEntryForm tree and the REAL
 * authenticator API client + response parsers. Only `authFetch` is replaced,
 * by a stateful fake server that returns the server's JSON contract shapes;
 * Firebase and the email-OTP API calls are mocked. The real Express/PostgreSQL
 * path is covered server-side by authenticatorLifecycle.pglite.integration.test.ts.
 */

const mockAuth = vi.hoisted(() => ({ currentUser: null as unknown }));
vi.mock('../../config/firebase', () => ({ auth: mockAuth, googleProvider: {}, githubProvider: {} }));
vi.mock('../../config/authFetch', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../config/authFetch')>();
  return { ...original, authFetch: vi.fn() };
});
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

const VALID_TOTP = '246810';
const user = { uid: 'fb-part', email: 'part@example.com', providerData: [{ providerId: 'password' }] } as unknown as User;

/** Stateful contract double for /api/auth/mfa/authenticator/*. */
class FakeAuthenticatorServer {
  status: 'not_enrolled' | 'pending' | 'active' = 'not_enrolled';
  pendingId: string | null = null;
  pendingKind: 'enroll' | 'replace' = 'enroll';
  secret = '';
  recentAuth = true;
  batch: { id: string; total: number } | null = null;
  seq = 0;
  issuedSecrets: string[] = [];
  issuedCodes: string[] = [];
  failNext: { path: string; status: number; body: object } | null = null;
  networkDownFor: string | null = null;

  private json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }
  private setup(kind: 'enroll' | 'replace') {
    this.seq += 1;
    this.pendingId = `enrollment_${this.seq}${kind}`;
    this.pendingKind = kind;
    this.secret = `SECRETKEY${this.seq}ABCDEFGHJKLMNP`;
    this.issuedSecrets.push(this.secret);
    if (kind === 'enroll') this.status = 'pending';
    return {
      authenticator: {
        status: 'pending',
        enrollmentId: this.pendingId,
        expiresAt: '2026-11-12T10:10:00.000Z',
        issuer: 'HackMatch',
        accountLabel: 'HackMatch account',
        algorithm: 'SHA1',
        digits: 6,
        periodSeconds: 30,
      },
      setup: {
        otpauthUri: `otpauth://totp/HackMatch%3AHackMatch%20account?secret=${this.secret}&issuer=HackMatch`,
        manualEntryKey: this.secret,
      },
      ...(kind === 'replace' ? { currentAuthenticator: { status: 'active' } } : {}),
      availableChallengeMethods: kind === 'replace' ? ['authenticator_totp', 'email_otp'] : ['email_otp'],
      emailOtpFallback: true,
    };
  }
  private newCodes() {
    this.seq += 1;
    const id = `30000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`;
    // Unique per code and per batch; only symbols from the server's unambiguous alphabet.
    const letters = 'ABCDEFGHJK';
    const digits = '23456789AB';
    const codes = Array.from(
      { length: 10 },
      (_, i) => `${letters[i]}${letters[this.seq % 10]}QR-STUV-WX${digits[i]}${digits[this.seq % 10]}`
    );
    this.issuedCodes.push(...codes);
    this.batch = { id, total: 10 };
    return { status: 'generated', batchId: id, total: 10, remaining: 10, generatedAt: '2026-11-12T10:05:00.000Z', codes };
  }
  private statusBody() {
    return {
      authenticator:
        this.status === 'active'
          ? { status: 'active', activatedAt: '2026-11-12T10:01:00.000Z' }
          : this.status === 'pending'
            ? { status: 'pending', expiresAt: '2026-11-12T10:10:00.000Z' }
            : { status: 'not_enrolled' },
      availableChallengeMethods: this.status === 'active' ? ['authenticator_totp', 'email_otp'] : ['email_otp'],
      emailOtpFallback: true,
    };
  }

  handle = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input).replace('/api/auth/mfa/authenticator', '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (this.networkDownFor === url) {
      this.networkDownFor = null;
      throw new TypeError('Failed to fetch');
    }
    if (this.failNext?.path === url) {
      const { status, body: failure } = this.failNext;
      this.failNext = null;
      return this.json(failure, status);
    }
    if (!this.recentAuth) {
      return this.json({ error: 'Recent reauthentication is required.', code: 'REAUTHENTICATION_REQUIRED' }, 401);
    }
    const route = `${method} ${url}`;
    switch (route) {
      case 'GET /enrollment':
        return this.json(this.statusBody());
      case 'POST /enrollment':
        if (this.status !== 'not_enrolled') return this.json({ error: 'busy', code: 'AUTHENTICATOR_ENROLLMENT_PENDING' }, 409);
        return this.json(this.setup('enroll'), 201);
      case 'POST /enrollment/restart':
        return this.json(this.setup('enroll'), 201);
      case 'POST /enrollment/confirm':
      case 'POST /replacement/confirm': {
        if (body.enrollmentId !== this.pendingId) {
          return this.json({ error: 'This authenticator enrollment is no longer current.', code: 'AUTHENTICATOR_ENROLLMENT_STALE' }, 409);
        }
        if (body.code !== VALID_TOTP) {
          return this.json({ error: 'The authenticator code is incorrect or expired.', code: 'INVALID_AUTHENTICATOR_CODE' }, 401);
        }
        const replacing = route === 'POST /replacement/confirm';
        this.status = 'active';
        this.pendingId = null;
        const active = { status: 'active', activatedAt: '2026-11-12T10:01:00.000Z' };
        return this.json(
          replacing
            ? { authenticator: active, recoveryCodes: this.newCodes(), availableChallengeMethods: ['authenticator_totp', 'email_otp'], emailOtpFallback: true }
            : { authenticator: active, availableChallengeMethods: ['authenticator_totp', 'email_otp'], emailOtpFallback: true }
        );
      }
      case 'POST /replacement':
        return this.json(this.setup('replace'), 201);
      case 'POST /disable':
        this.status = 'not_enrolled';
        this.batch = null;
        return this.json({
          authenticator: { status: 'not_enrolled' },
          disabledAt: '2026-11-12T10:20:00.000Z',
          recoveryCodes: { status: 'not_generated', total: 0, remaining: 0 },
          availableChallengeMethods: ['email_otp'],
          emailOtpFallback: true,
        });
      case 'GET /recovery-codes':
        return this.json({
          recoveryCodes: this.batch
            ? { status: 'generated', batchId: this.batch.id, total: 10, remaining: 10, generatedAt: '2026-11-12T10:05:00.000Z' }
            : { status: 'not_generated', total: 0, remaining: 0 },
        });
      case 'POST /recovery-codes':
        if ((this.batch?.id ?? null) !== body.expectedBatchId) {
          return this.json({ error: 'Changed in another session.', code: 'RECOVERY_CODES_STALE' }, 409);
        }
        return this.json({ recoveryCodes: this.newCodes() }, 201);
      default:
        return this.json({ error: 'Not Found' }, 404);
    }
  };
}

let server: FakeAuthenticatorServer;

function expectNothingPersistedOrInUrl() {
  const persisted = JSON.stringify({ ...localStorage, ...sessionStorage });
  for (const secret of [...server.issuedSecrets, ...server.issuedCodes, VALID_TOTP]) {
    expect(persisted).not.toContain(secret);
    expect(window.location.href).not.toContain(secret);
  }
}

async function enterCode(code: string, button: RegExp) {
  fireEvent.change(await screen.findByLabelText(/^authenticator code$/i), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: button }));
}

describe('authenticator journey through the real React tree and API client (#272)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetMfaChallengeInflight();
    server = new FakeAuthenticatorServer();
    vi.mocked(authFetch).mockImplementation(server.handle);
    mockAuth.currentUser = user;
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(getIdToken).mockResolvedValue('refreshed-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PART: not enrolled → setup → invalid → retry → active → codes once → replace (codes rotate) → disable', async () => {
    render(<SignedInPanel email="part@example.com" />);
    // Loading state is rendered synchronously, before the status response arrives.
    expect(screen.getByText(/checking authenticator status/i)).toBeInTheDocument();
    expect(screen.getByTestId('authenticator-enrollment-card')).toHaveTextContent(/checking/i);

    fireEvent.click(await screen.findByRole('button', { name: /set up authenticator app/i }));
    // QR plus an accessible textual alternative (manual key) and labeled code input.
    expect(await screen.findByTitle(/authenticator enrollment qr code/i)).toBeInTheDocument();
    expect(screen.getByTestId('authenticator-manual-key')).toHaveTextContent(server.secret);
    expect(screen.getByLabelText(/^authenticator code$/i)).toHaveAttribute('autocomplete', 'one-time-code');

    await enterCode('135791', /^confirm authenticator$/i);
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect or expired/i);
    expect(screen.getByLabelText(/^authenticator code$/i)).toHaveValue('135791'); // preserved for correction

    await enterCode(VALID_TOTP, /^confirm authenticator$/i);
    expect(await screen.findByText(/your authenticator app is active/i)).toBeInTheDocument();
    expect(screen.queryByTestId('authenticator-qr-code')).not.toBeInTheDocument();
    expect(screen.getByText(/email verification codes remain available/i)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /^generate recovery codes$/i }));
    const list = await screen.findByTestId('recovery-codes-list');
    const firstCodes = (list as HTMLTextAreaElement).value.split('\n');
    expect(firstCodes).toHaveLength(10);
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /i have saved these codes/i }));
    expect(await screen.findByText(/of 10 recovery codes unused/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(firstCodes[0]);

    fireEvent.click(screen.getByRole('button', { name: /replace authenticator app/i }));
    expect(await screen.findByTestId('authenticator-replacement-notice')).toHaveTextContent(/keep working until you confirm/i);
    await enterCode(VALID_TOTP, /confirm new authenticator/i);
    const rotated = await screen.findByTestId('recovery-codes-list');
    expect(screen.getByTestId('recovery-codes-replacement-note')).toHaveTextContent(/previous recovery codes no longer work/i);
    expect((rotated as HTMLTextAreaElement).value.split('\n')).not.toEqual(firstCodes);
    fireEvent.click(screen.getByRole('button', { name: /i have saved these codes/i }));

    fireEvent.click(screen.getByRole('button', { name: /^turn off authenticator app$/i }));
    fireEvent.click(within(screen.getByText(/turn off your authenticator app\?/i).parentElement!).getByRole('button', { name: /^turn off authenticator app$/i }));
    expect(await screen.findByTestId('authenticator-enrollment-notice')).toHaveTextContent(/email verification codes still protect/i);
    expect(screen.getByRole('button', { name: /set up authenticator app/i })).toBeEnabled();
    expect(screen.queryByTestId('recovery-codes-panel')).not.toBeInTheDocument();
    expectNothingPersistedOrInUrl();
  });

  it('refresh mid-setup: pending detected without secrets, restart issues fresh material, old key is gone', async () => {
    const first = render(<SignedInPanel email="part@example.com" />);
    fireEvent.click(await screen.findByRole('button', { name: /set up authenticator app/i }));
    const oldSecret = server.secret;
    expect(await screen.findByText(oldSecret)).toBeInTheDocument();
    first.unmount(); // page refresh

    render(<SignedInPanel email="part@example.com" />);
    expect(await screen.findByText(/authenticator setup is pending/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(oldSecret);
    fireEvent.click(screen.getByRole('button', { name: /restart authenticator setup/i }));
    expect(await screen.findByText(server.secret)).toBeInTheDocument();
    expect(server.secret).not.toBe(oldSecret);
    expect(document.body.textContent).not.toContain(oldSecret);
    await enterCode(VALID_TOTP, /^confirm authenticator$/i);
    expect(await screen.findByText(/your authenticator app is active/i)).toBeInTheDocument();
  });

  it('stale sign-in: real reauthentication panel → password → email OTP → the original action retries once', async () => {
    render(<SignedInPanel email="part@example.com" />);
    const setupButton = await screen.findByRole('button', { name: /set up authenticator app/i });
    // Status loaded; the sign-in then goes stale before the user starts the sensitive action.
    server.recentAuth = false;
    vi.mocked(reauthenticateWithPassword).mockResolvedValueOnce(undefined);
    vi.mocked(requestMfaChallenge).mockResolvedValueOnce({
      requiresOtp: true,
      challengeId: 'challenge-1',
      email: 'p***t@example.com',
      expiresInSeconds: 600,
      message: 'sent',
    });
    vi.mocked(verifyMfaCode).mockImplementationOnce(async () => {
      server.recentAuth = true; // the new auth_time now carries a matching mfa_auth_time
      return { verified: true, message: 'ok' };
    });

    fireEvent.click(setupButton);
    const panel = await screen.findByTestId('reauthentication-panel');
    expect(within(panel).getByText(/before you set up an authenticator app/i)).toBeInTheDocument();
    expect(server.issuedSecrets).toHaveLength(0); // nothing was created by the stale request
    expect(within(panel).getByLabelText(/current password/i)).toHaveAttribute('type', 'password');
    fireEvent.change(within(panel).getByLabelText(/current password/i), { target: { value: 'Right-Pass-1' } });
    fireEvent.click(within(panel).getByRole('button', { name: /verify password/i }));
    fireEvent.change(await screen.findByLabelText(/6-digit code/i), { target: { value: '482913' } });
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    expect(await screen.findByTitle(/authenticator enrollment qr code/i)).toBeInTheDocument();
    expect(screen.queryByTestId('reauthentication-panel')).not.toBeInTheDocument();
    expect(server.issuedSecrets).toHaveLength(1); // the original begin was retried exactly once
    expect(verifyMfaCode).toHaveBeenCalledWith(user, 'challenge-1', '482913');
    expect(getIdToken).toHaveBeenCalledWith(user, true);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toMatch(/Right-Pass-1|482913/);
  });

  it('network and server failures are shown accessibly, keep setup material, and recover on retry', async () => {
    render(<SignedInPanel email="part@example.com" />);
    fireEvent.click(await screen.findByRole('button', { name: /set up authenticator app/i }));
    const secret = server.secret;
    await screen.findByText(secret);

    server.networkDownFor = '/enrollment/confirm';
    await enterCode(VALID_TOTP, /^confirm authenticator$/i);
    expect(await screen.findByRole('alert')).toHaveTextContent(/network error/i);
    expect(screen.getByText(secret)).toBeInTheDocument();

    server.failNext = {
      path: '/enrollment/confirm',
      status: 503,
      body: { error: 'Authenticator enrollment is temporarily unavailable. Please try again later.', code: 'AUTHENTICATOR_ENROLLMENT_UNAVAILABLE', retryable: true },
    };
    fireEvent.click(screen.getByRole('button', { name: /^confirm authenticator$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily unavailable/i);
    expect(screen.getByText(secret)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^confirm authenticator$/i }));
    expect(await screen.findByText(/your authenticator app is active/i)).toBeInTheDocument();
  });

  it('account switch clears another account’s setup material and one-time codes', async () => {
    const { rerender } = render(<SignedInPanel email="part@example.com" />);
    fireEvent.click(await screen.findByRole('button', { name: /set up authenticator app/i }));
    const secret = server.secret;
    await enterCode(VALID_TOTP, /^confirm authenticator$/i);
    fireEvent.click(await screen.findByRole('button', { name: /^generate recovery codes$/i }));
    const codes = ((await screen.findByTestId('recovery-codes-list')) as HTMLTextAreaElement).value;

    server.status = 'not_enrolled';
    server.batch = null;
    rerender(<SignedInPanel email="admin@example.com" />);
    await waitFor(() => expect(screen.queryByTestId('recovery-codes-list')).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: /set up authenticator app/i })).toBeEnabled();
    expect(document.body.textContent).not.toContain(secret);
    expect(document.body.textContent).not.toContain(codes.split('\n')[0]);
    expectNothingPersistedOrInUrl();
  });
});

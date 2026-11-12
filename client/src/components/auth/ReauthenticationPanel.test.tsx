import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { User } from 'firebase/auth';
import { ReauthenticationPanel } from './ReauthenticationPanel';
import { reauthenticateWithPassword, reauthenticateWithProvider } from './reauthentication';

const mockAuth = vi.hoisted(() => ({ currentUser: null as unknown }));

vi.mock('../../config/firebase', () => ({
  auth: mockAuth,
  googleProvider: {},
  githubProvider: {},
}));

vi.mock('./reauthentication', async (importOriginal) => {
  const original = await importOriginal<typeof import('./reauthentication')>();
  return {
    ...original,
    reauthenticateWithPassword: vi.fn(),
    reauthenticateWithProvider: vi.fn(),
  };
});

// The real US-004 form is covered by its own suite; this stub models its contract.
vi.mock('./OtpEntryForm', () => ({
  OtpEntryForm: ({ onVerified }: { onVerified: () => void }) => (
    <div data-testid="email-otp-form">
      <label htmlFor="otp-stub">6-digit code</label>
      <input id="otp-stub" />
      <button type="button" onClick={onVerified}>
        Verify code
      </button>
    </div>
  ),
}));

const owner = (providers: string[] = ['password'], uid = 'fb-owner') =>
  ({
    uid,
    email: 'owner@example.com',
    providerData: providers.map((providerId) => ({ providerId })),
  }) as unknown as User;

function renderPanel() {
  const onReauthenticated = vi.fn();
  const onCancel = vi.fn();
  render(
    <ReauthenticationPanel
      purpose="turn off your authenticator app"
      onReauthenticated={onReauthenticated}
      onCancel={onCancel}
    />
  );
  return { onReauthenticated, onCancel };
}

describe('ReauthenticationPanel (US-029 / #269)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.currentUser = owner();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('explains why verification is needed and focuses the heading', async () => {
    renderPanel();
    const heading = screen.getByRole('heading', { name: /verify it’s you/i });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText(/before you turn off your authenticator app/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/current password/i)).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText(/current password/i)).toHaveAttribute('autocomplete', 'current-password');
  });

  it('validates an empty password without contacting Firebase', () => {
    const { onReauthenticated } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /verify password/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/enter your current password/i);
    expect(screen.getByLabelText(/current password/i)).toHaveAttribute('aria-invalid', 'true');
    expect(reauthenticateWithPassword).not.toHaveBeenCalled();
    expect(onReauthenticated).not.toHaveBeenCalled();
  });

  it('rejects an invalid credential, clears it, and does not complete the operation', async () => {
    vi.mocked(reauthenticateWithPassword).mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'auth/wrong-password' })
    );
    const { onReauthenticated } = renderPanel();
    const input = screen.getByLabelText(/current password/i);
    fireEvent.change(input, { target: { value: 'Wrong-Pass-1' } });
    fireEvent.click(screen.getByRole('button', { name: /verify password/i }));

    expect(await screen.findByTestId('reauthentication-error')).toHaveTextContent(/incorrect password/i);
    expect(input).toHaveValue('');
    expect(screen.queryByTestId('email-otp-form')).not.toBeInTheDocument();
    expect(onReauthenticated).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('Wrong-Pass-1');
  });

  it('#270: never logs, persists, or URL-encodes the password and hides Firebase internals', async () => {
    const lines: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      })
    );
    vi.mocked(reauthenticateWithPassword).mockRejectedValueOnce(
      Object.assign(new Error('Firebase: Error (auth/wrong-password). identitytoolkit key=AIza-internal'), {
        code: 'auth/wrong-password',
        customData: { email: 'owner@example.com' },
      })
    );
    renderPanel();
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'Leak-Check-Pass-9' } });
    fireEvent.click(screen.getByRole('button', { name: /verify password/i }));
    const alert = await screen.findByTestId('reauthentication-error');

    expect(alert.textContent).not.toMatch(/firebase|identitytoolkit|AIza|auth\//i);
    expect(lines.join('\n')).not.toContain('Leak-Check-Pass-9');
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('Leak-Check-Pass-9');
    expect(window.location.href).not.toContain('Leak-Check-Pass-9');
    expect(document.body.innerHTML).not.toContain('Leak-Check-Pass-9');
    spies.forEach((spy) => spy.mockRestore());
  });

  it('shows loading, then requires the email code before returning to the operation', async () => {
    let resolveFirebase: () => void = () => {};
    vi.mocked(reauthenticateWithPassword).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveFirebase = resolve;
      })
    );
    const { onReauthenticated } = renderPanel();
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'Right-Pass-1' } });
    fireEvent.click(screen.getByRole('button', { name: /verify password/i }));

    expect(screen.getByRole('button', { name: /verifying password/i })).toBeDisabled();
    expect(screen.getByLabelText(/current password/i)).toHaveValue('');
    expect(reauthenticateWithPassword).toHaveBeenCalledWith(mockAuth.currentUser, 'Right-Pass-1');

    resolveFirebase();
    expect(await screen.findByTestId('email-otp-form')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /step 2 of 2/i })).toBeInTheDocument();
    // The intended operation is not resumed until the email OTP succeeds.
    expect(onReauthenticated).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));
    expect(onReauthenticated).toHaveBeenCalledTimes(1);
  });

  it('supports OAuth-only owners and reports a cancelled provider window', async () => {
    mockAuth.currentUser = owner(['google.com']);
    vi.mocked(reauthenticateWithProvider).mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'auth/popup-closed-by-user' })
    );
    renderPanel();
    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /verify with google/i }));
    expect(await screen.findByTestId('reauthentication-error')).toHaveTextContent(/cancelled/i);
    expect(reauthenticateWithProvider).toHaveBeenCalledWith(mockAuth.currentUser, 'google');

    vi.mocked(reauthenticateWithProvider).mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: /verify with google/i }));
    expect(await screen.findByTestId('email-otp-form')).toBeInTheDocument();
  });

  it('lets the user cancel before any change and without completing the operation', () => {
    const { onCancel, onReauthenticated } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onReauthenticated).not.toHaveBeenCalled();
  });

  it('does not resume the operation when the signed-in account changes mid-verification', async () => {
    vi.mocked(reauthenticateWithPassword).mockResolvedValueOnce(undefined);
    const { onReauthenticated } = renderPanel();
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'Right-Pass-1' } });
    fireEvent.click(screen.getByRole('button', { name: /verify password/i }));
    await screen.findByTestId('email-otp-form');

    mockAuth.currentUser = owner(['password'], 'fb-someone-else');
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    expect(await screen.findByTestId('reauthentication-error')).toHaveTextContent(/account changed/i);
    expect(onReauthenticated).not.toHaveBeenCalled();
    expect(screen.queryByTestId('email-otp-form')).not.toBeInTheDocument();
  });

  it('reports an ended session when nobody is signed in', () => {
    mockAuth.currentUser = null;
    const { onCancel } = renderPanel();
    expect(screen.getByText(/session has ended/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('maps an account mismatch to a clear error and keeps the user on step 1', async () => {
    vi.mocked(reauthenticateWithPassword).mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'auth/user-mismatch' })
    );
    renderPanel();
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: /verify password/i }));
    expect(await screen.findByTestId('reauthentication-error')).toHaveTextContent(/different account/i);
    expect(screen.getByLabelText(/current password/i)).toBeEnabled();
  });
});

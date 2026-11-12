import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthenticatorEnrollmentCard } from './AuthenticatorEnrollmentCard';
import {
  AuthenticatorEnrollmentApiError,
  beginAuthenticatorEnrollment,
  confirmAuthenticatorEnrollment,
  getAuthenticatorEnrollmentStatus,
  restartAuthenticatorEnrollment,
  type ActiveAuthenticatorEnrollment,
  type PendingAuthenticatorEnrollment,
} from './authenticatorEnrollmentApi';

vi.mock('./authenticatorEnrollmentApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('./authenticatorEnrollmentApi')>();
  return {
    ...original,
    beginAuthenticatorEnrollment: vi.fn(),
    confirmAuthenticatorEnrollment: vi.fn(),
    getAuthenticatorEnrollmentStatus: vi.fn(),
    restartAuthenticatorEnrollment: vi.fn(),
  };
});

const pending: PendingAuthenticatorEnrollment = {
  authenticator: {
    status: 'pending',
    enrollmentId: 'enrollment_1234',
    expiresAt: '2026-11-11T18:10:00.000Z',
    issuer: 'HackMatch',
    accountLabel: 'HackMatch account',
    algorithm: 'SHA1',
    digits: 6,
    periodSeconds: 30,
  },
  setup: {
    otpauthUri: 'otpauth://totp/HackMatch%3AHackMatch%20account?secret=OWNERONLY&issuer=HackMatch',
    manualEntryKey: 'OWNERONLY',
  },
  availableChallengeMethods: ['email_otp'],
  emailOtpFallback: true,
};

const active: ActiveAuthenticatorEnrollment = {
  authenticator: { status: 'active', activatedAt: '2026-11-11T18:05:00.000Z' },
  availableChallengeMethods: ['authenticator_totp', 'email_otp'],
  emailOtpFallback: true,
};

const restarted: PendingAuthenticatorEnrollment = {
  ...pending,
  authenticator: {
    ...pending.authenticator,
    enrollmentId: 'enrollment_5678',
    expiresAt: '2026-11-11T18:20:00.000Z',
  },
  setup: {
    otpauthUri: 'otpauth://totp/HackMatch%3AHackMatch%20account?secret=FRESHOWNER&issuer=HackMatch',
    manualEntryKey: 'FRESHOWNER',
  },
};

async function beginSetup() {
  vi.mocked(beginAuthenticatorEnrollment).mockResolvedValueOnce(pending);
  fireEvent.click(await screen.findByRole('button', { name: /set up authenticator app/i }));
  expect(await screen.findByTestId('authenticator-qr-code')).toBeInTheDocument();
}

describe('AuthenticatorEnrollmentCard (US-029 / #268)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatorEnrollmentStatus).mockResolvedValue({
      authenticator: { status: 'not_enrolled' },
      availableChallengeMethods: ['email_otp'],
      emailOtpFallback: true,
    });
    localStorage.clear();
    sessionStorage.clear();
  });

  it('starts once, shows loading, then renders the returned QR and manual setup path', async () => {
    let resolveBegin: (value: PendingAuthenticatorEnrollment) => void = () => {};
    vi.mocked(beginAuthenticatorEnrollment).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveBegin = resolve;
      })
    );
    render(<AuthenticatorEnrollmentCard identityKey="part-1" />);

    fireEvent.click(await screen.findByRole('button', { name: /set up authenticator app/i }));
    const loadingButton = screen.getByRole('button', { name: /starting setup/i });
    expect(loadingButton).toBeDisabled();
    fireEvent.click(loadingButton);
    expect(beginAuthenticatorEnrollment).toHaveBeenCalledTimes(1);

    resolveBegin(pending);
    expect(await screen.findByTitle(/authenticator enrollment qr code/i)).toBeInTheDocument();
    expect(screen.getByTestId('authenticator-manual-key')).toHaveTextContent('OWNERONLY');
    expect(screen.getByText(/email verification codes remain available/i)).toBeInTheDocument();
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it('rejects malformed codes client-side while preserving the entered value', async () => {
    render(<AuthenticatorEnrollmentCard identityKey="part-1" />);
    await beginSetup();
    const input = screen.getByLabelText(/authenticator code/i);
    fireEvent.change(input, { target: { value: '12ab' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm authenticator/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/exactly 6 digits/i);
    expect(input).toHaveValue('12ab');
    expect(confirmAuthenticatorEnrollment).not.toHaveBeenCalled();
  });

  it('activates only after server confirmation and clears QR, key, and code', async () => {
    vi.mocked(confirmAuthenticatorEnrollment).mockResolvedValueOnce(active);
    render(<AuthenticatorEnrollmentCard identityKey="admin-1" />);
    await beginSetup();
    fireEvent.change(screen.getByLabelText(/authenticator code/i), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm authenticator/i }));

    expect(await screen.findByText(/authenticator app is active/i)).toBeInTheDocument();
    expect(confirmAuthenticatorEnrollment).toHaveBeenCalledWith('enrollment_1234', '123456');
    expect(screen.queryByTestId('authenticator-qr-code')).not.toBeInTheDocument();
    expect(screen.queryByText('OWNERONLY')).not.toBeInTheDocument();
    expect(screen.getByText(/email codes remain available/i)).toBeInTheDocument();
  });

  it('keeps pending material and code available after an incorrect-code response', async () => {
    vi.mocked(confirmAuthenticatorEnrollment).mockRejectedValueOnce(
      new AuthenticatorEnrollmentApiError(
        401,
        'INVALID_AUTHENTICATOR_CODE',
        'The authenticator code is incorrect or expired.'
      )
    );
    render(<AuthenticatorEnrollmentCard identityKey="part-1" />);
    await beginSetup();
    const input = screen.getByLabelText(/authenticator code/i);
    fireEvent.change(input, { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm authenticator/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect or expired/i);
    expect(input).toHaveValue('654321');
    expect(screen.getByTestId('authenticator-manual-key')).toHaveTextContent('OWNERONLY');
    expect(screen.getByRole('button', { name: /confirm authenticator/i })).toBeEnabled();
  });

  it('clears stale setup material and offers a safe restart', async () => {
    vi.mocked(confirmAuthenticatorEnrollment).mockRejectedValueOnce(
      new AuthenticatorEnrollmentApiError(
        410,
        'AUTHENTICATOR_ENROLLMENT_EXPIRED',
        'The authenticator enrollment has expired. Start enrollment again.'
      )
    );
    render(<AuthenticatorEnrollmentCard identityKey="part-1" />);
    await beginSetup();
    fireEvent.change(screen.getByLabelText(/authenticator code/i), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm authenticator/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/expired/i);
    expect(screen.queryByTestId('authenticator-manual-key')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set up authenticator app/i })).toBeEnabled();
  });

  it('handles recent-authentication failures without retaining setup credentials', async () => {
    vi.mocked(confirmAuthenticatorEnrollment).mockRejectedValueOnce(
      new AuthenticatorEnrollmentApiError(
        401,
        'REAUTHENTICATION_REQUIRED',
        'server wording'
      )
    );
    render(<AuthenticatorEnrollmentCard identityKey="part-1" />);
    await beginSetup();
    fireEvent.change(screen.getByLabelText(/authenticator code/i), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm authenticator/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/sign out and sign in again/i);
    expect(screen.queryByTestId('authenticator-qr-code')).not.toBeInTheDocument();
    expect(screen.queryByText('OWNERONLY')).not.toBeInTheDocument();
  });

  it('recognizes an already-active response without exposing setup material', async () => {
    vi.mocked(beginAuthenticatorEnrollment).mockRejectedValueOnce(
      new AuthenticatorEnrollmentApiError(
        409,
        'AUTHENTICATOR_ALREADY_ACTIVE',
        'An authenticator is already active for this account.'
      )
    );
    render(<AuthenticatorEnrollmentCard identityKey="admin-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /set up authenticator app/i }));

    expect(await screen.findByText(/authenticator app is active/i)).toBeInTheDocument();
    expect(screen.queryByTestId('authenticator-manual-key')).not.toBeInTheDocument();
  });

  it('clears owner-specific material on cancel and account identity change', async () => {
    const { rerender } = render(<AuthenticatorEnrollmentCard identityKey="part-1" />);
    await beginSetup();
    fireEvent.click(screen.getByRole('button', { name: /cancel setup/i }));
    expect(screen.queryByText('OWNERONLY')).not.toBeInTheDocument();

    vi.mocked(beginAuthenticatorEnrollment).mockResolvedValueOnce(pending);
    fireEvent.click(screen.getByRole('button', { name: /set up authenticator app/i }));
    expect(await screen.findByText('OWNERONLY')).toBeInTheDocument();
    rerender(<AuthenticatorEnrollmentCard identityKey="admin-2" />);
    await waitFor(() => expect(screen.queryByText('OWNERONLY')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /set up authenticator app/i })).toBeEnabled();
  });

  it('loads active and pending status without exposing stored setup credentials', async () => {
    vi.mocked(getAuthenticatorEnrollmentStatus).mockResolvedValueOnce({
      authenticator: { status: 'active', activatedAt: '2026-11-11T18:05:00.000Z' },
      availableChallengeMethods: ['authenticator_totp', 'email_otp'],
      emailOtpFallback: true,
    });
    const { unmount } = render(<AuthenticatorEnrollmentCard identityKey="admin-1" />);
    expect(await screen.findByText(/authenticator app is active/i)).toBeInTheDocument();
    expect(screen.queryByTestId('authenticator-manual-key')).not.toBeInTheDocument();
    unmount();

    vi.mocked(getAuthenticatorEnrollmentStatus).mockResolvedValueOnce({
      authenticator: { status: 'pending', expiresAt: '2026-11-11T18:10:00.000Z' },
      availableChallengeMethods: ['email_otp'],
      emailOtpFallback: true,
    });
    render(<AuthenticatorEnrollmentCard identityKey="part-1" />);
    expect(await screen.findByText(/setup is pending/i)).toBeInTheDocument();
    expect(screen.queryByTestId('authenticator-manual-key')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check status again/i })).toBeEnabled();
  });

  it('recovers after begin then refresh by replacing pending setup with fresh owner-only material', async () => {
    const firstRender = render(<AuthenticatorEnrollmentCard identityKey="part-1" />);
    await beginSetup();
    expect(screen.getByText('OWNERONLY')).toBeInTheDocument();
    firstRender.unmount();

    vi.mocked(getAuthenticatorEnrollmentStatus).mockResolvedValueOnce({
      authenticator: { status: 'pending', expiresAt: '2026-11-11T18:10:00.000Z' },
      availableChallengeMethods: ['email_otp'],
      emailOtpFallback: true,
    });
    vi.mocked(restartAuthenticatorEnrollment).mockResolvedValueOnce(restarted);
    render(<AuthenticatorEnrollmentCard identityKey="part-1" />);

    expect(await screen.findByText(/setup is pending/i)).toBeInTheDocument();
    expect(screen.queryByText('OWNERONLY')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /restart authenticator setup/i }));

    expect(await screen.findByText('FRESHOWNER')).toBeInTheDocument();
    expect(screen.getByTestId('authenticator-qr-code')).toBeInTheDocument();
    expect(restartAuthenticatorEnrollment).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('OWNERONLY')).not.toBeInTheDocument();
  });

  it('shows an accessible status-loading failure and recovers on retry', async () => {
    vi.mocked(getAuthenticatorEnrollmentStatus)
      .mockRejectedValueOnce(
        new AuthenticatorEnrollmentApiError(
          503,
          'AUTHENTICATOR_ENROLLMENT_UNAVAILABLE',
          'Authenticator enrollment is temporarily unavailable.'
        )
      )
      .mockResolvedValueOnce({
        authenticator: { status: 'not_enrolled' },
        availableChallengeMethods: ['email_otp'],
        emailOtpFallback: true,
      });
    render(<AuthenticatorEnrollmentCard identityKey="part-1" />);

    expect(screen.getByRole('status')).toHaveTextContent(/checking authenticator status/i);
    expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily unavailable/i);
    fireEvent.click(screen.getByRole('button', { name: /check authenticator status again/i }));
    expect(await screen.findByRole('button', { name: /set up authenticator app/i })).toBeEnabled();
  });
});

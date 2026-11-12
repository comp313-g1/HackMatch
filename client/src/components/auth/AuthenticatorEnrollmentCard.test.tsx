import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthenticatorEnrollmentCard } from './AuthenticatorEnrollmentCard';
import {
  AuthenticatorEnrollmentApiError,
  beginAuthenticatorEnrollment,
  beginAuthenticatorReplacement,
  confirmAuthenticatorEnrollment,
  confirmAuthenticatorReplacement,
  disableAuthenticator,
  generateRecoveryCodes,
  getAuthenticatorEnrollmentStatus,
  getRecoveryCodeStatus,
  restartAuthenticatorEnrollment,
  type ActiveAuthenticatorEnrollment,
  type PendingAuthenticatorEnrollment,
  type PendingAuthenticatorReplacement,
} from './authenticatorEnrollmentApi';

vi.mock('./authenticatorEnrollmentApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('./authenticatorEnrollmentApi')>();
  return {
    ...original,
    beginAuthenticatorEnrollment: vi.fn(),
    beginAuthenticatorReplacement: vi.fn(),
    confirmAuthenticatorEnrollment: vi.fn(),
    confirmAuthenticatorReplacement: vi.fn(),
    disableAuthenticator: vi.fn(),
    generateRecoveryCodes: vi.fn(),
    getAuthenticatorEnrollmentStatus: vi.fn(),
    getRecoveryCodeStatus: vi.fn(),
    restartAuthenticatorEnrollment: vi.fn(),
  };
});

// The real panel (Firebase + email OTP) has its own suite; this stub models its contract.
vi.mock('./ReauthenticationPanel', () => ({
  ReauthenticationPanel: ({
    purpose,
    onReauthenticated,
    onCancel,
  }: {
    purpose: string;
    onReauthenticated: () => void;
    onCancel: () => void;
  }) => (
    <div data-testid="reauthentication-panel">
      <p>Verify it’s you before you {purpose}.</p>
      <button type="button" onClick={onReauthenticated}>
        Complete verification
      </button>
      <button type="button" onClick={onCancel}>
        Cancel verification
      </button>
    </div>
  ),
}));

const reauthRequired = () =>
  new AuthenticatorEnrollmentApiError(
    401,
    'REAUTHENTICATION_REQUIRED',
    'Recent reauthentication is required to change authenticator settings. Please sign in again.'
  );

const activeStatus = {
  authenticator: { status: 'active' as const, activatedAt: '2026-11-11T18:05:00.000Z' },
  availableChallengeMethods: ['authenticator_totp', 'email_otp'] as Array<
    'authenticator_totp' | 'email_otp'
  >,
  emailOtpFallback: true as const,
};

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
    vi.mocked(getRecoveryCodeStatus).mockResolvedValue({
      status: 'not_generated',
      total: 0,
      remaining: 0,
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
    // #269 replaces the #268 "sign out and sign in again" message with in-place verification.
    vi.mocked(confirmAuthenticatorEnrollment).mockRejectedValueOnce(
      new AuthenticatorEnrollmentApiError(
        401,
        'REAUTHENTICATION_REQUIRED',
        'server wording'
      )
    );
    vi.mocked(restartAuthenticatorEnrollment).mockResolvedValueOnce(restarted);
    render(<AuthenticatorEnrollmentCard identityKey="part-1" />);
    await beginSetup();
    fireEvent.change(screen.getByLabelText(/authenticator code/i), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm authenticator/i }));

    expect(await screen.findByTestId('reauthentication-panel')).toHaveTextContent(
      /continue setting up your authenticator app/i
    );
    expect(screen.queryByTestId('authenticator-qr-code')).not.toBeInTheDocument();
    expect(screen.queryByText('OWNERONLY')).not.toBeInTheDocument();

    // After verification the user returns to setup with fresh owner-only material.
    fireEvent.click(screen.getByRole('button', { name: /complete verification/i }));
    expect(await screen.findByText('FRESHOWNER')).toBeInTheDocument();
    expect(restartAuthenticatorEnrollment).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('reauthentication-panel')).not.toBeInTheDocument();
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

const replacement: PendingAuthenticatorReplacement = {
  authenticator: {
    ...pending.authenticator,
    enrollmentId: 'replacement_9999',
  },
  setup: {
    otpauthUri: 'otpauth://totp/HackMatch%3AHackMatch%20account?secret=NEWDEVICE&issuer=HackMatch',
    manualEntryKey: 'NEWDEVICE',
  },
  currentAuthenticator: { status: 'active' },
  availableChallengeMethods: ['authenticator_totp', 'email_otp'],
  emailOtpFallback: true,
};

describe('AuthenticatorEnrollmentCard reauthentication and recovery controls (US-029 / #269)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatorEnrollmentStatus).mockResolvedValue({
      authenticator: { status: 'not_enrolled' },
      availableChallengeMethods: ['email_otp'],
      emailOtpFallback: true,
    });
    vi.mocked(getRecoveryCodeStatus).mockResolvedValue({
      status: 'not_generated',
      total: 0,
      remaining: 0,
    });
  });

  it('asks for verification when the server says the sign-in is stale, then retries the same action', async () => {
    vi.mocked(beginAuthenticatorEnrollment)
      .mockRejectedValueOnce(reauthRequired())
      .mockResolvedValueOnce(pending);
    render(<AuthenticatorEnrollmentCard identityKey="part-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /set up authenticator app/i }));

    const panel = await screen.findByTestId('reauthentication-panel');
    expect(panel).toHaveTextContent(/before you set up an authenticator app/i);
    expect(screen.queryByTestId('authenticator-qr-code')).not.toBeInTheDocument();
    expect(beginAuthenticatorEnrollment).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /complete verification/i }));
    expect(await screen.findByTestId('authenticator-qr-code')).toBeInTheDocument();
    expect(beginAuthenticatorEnrollment).toHaveBeenCalledTimes(2);
  });

  it('does not perform the action when verification is cancelled', async () => {
    vi.mocked(beginAuthenticatorEnrollment).mockRejectedValueOnce(reauthRequired());
    render(<AuthenticatorEnrollmentCard identityKey="part-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /set up authenticator app/i }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel verification/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/verification was cancelled.*no changes/i);
    expect(beginAuthenticatorEnrollment).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /set up authenticator app/i })).toBeEnabled();
  });

  it('keeps the server authoritative when a retry is still not recent enough', async () => {
    vi.mocked(beginAuthenticatorEnrollment)
      .mockRejectedValueOnce(reauthRequired())
      .mockRejectedValueOnce(reauthRequired());
    render(<AuthenticatorEnrollmentCard identityKey="part-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /set up authenticator app/i }));
    fireEvent.click(await screen.findByRole('button', { name: /complete verification/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not confirm a recent sign-in/i);
    expect(screen.queryByTestId('authenticator-qr-code')).not.toBeInTheDocument();
    expect(beginAuthenticatorEnrollment).toHaveBeenCalledTimes(2);
  });

  it('does not auto-prompt for a stale status check and loads after the user verifies', async () => {
    vi.mocked(getAuthenticatorEnrollmentStatus)
      .mockRejectedValueOnce(reauthRequired())
      .mockRejectedValueOnce(reauthRequired())
      .mockResolvedValueOnce(activeStatus);
    render(<AuthenticatorEnrollmentCard identityKey="part-1" />);

    const verify = await screen.findByRole('button', { name: /verify identity to manage authenticator/i });
    expect(screen.queryByTestId('reauthentication-panel')).not.toBeInTheDocument();
    fireEvent.click(verify);
    fireEvent.click(await screen.findByRole('button', { name: /complete verification/i }));
    expect(await screen.findByText(/authenticator app is active/i)).toBeInTheDocument();
  });

  it('clears pending verification and its operation when the account changes', async () => {
    vi.mocked(beginAuthenticatorEnrollment).mockRejectedValueOnce(reauthRequired());
    const { rerender } = render(<AuthenticatorEnrollmentCard identityKey="part-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /set up authenticator app/i }));
    await screen.findByTestId('reauthentication-panel');

    rerender(<AuthenticatorEnrollmentCard identityKey="admin-2" />);
    await waitFor(() => expect(screen.queryByTestId('reauthentication-panel')).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: /set up authenticator app/i })).toBeEnabled();
    expect(beginAuthenticatorEnrollment).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('turns off an active authenticator after confirmation and keeps email OTP as fallback', async () => {
    vi.mocked(getAuthenticatorEnrollmentStatus).mockResolvedValueOnce(activeStatus);
    vi.mocked(disableAuthenticator)
      .mockRejectedValueOnce(reauthRequired())
      .mockResolvedValueOnce({
        authenticator: { status: 'not_enrolled' },
        disabledAt: '2026-11-11T18:30:00.000Z',
        availableChallengeMethods: ['email_otp'],
        emailOtpFallback: true,
      });
    render(<AuthenticatorEnrollmentCard identityKey="admin-1" />);

    fireEvent.click(await screen.findByRole('button', { name: /turn off authenticator app/i }));
    expect(screen.getByText(/turn off your authenticator app\?/i)).toBeInTheDocument();
    expect(screen.getByText(/email verification codes stay required/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^turn off authenticator app$/i }));

    fireEvent.click(await screen.findByRole('button', { name: /complete verification/i }));
    expect(await screen.findByTestId('authenticator-enrollment-notice')).toHaveTextContent(
      /turned off.*recovery codes no longer work.*email verification codes still protect/i
    );
    expect(disableAuthenticator).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: /set up authenticator app/i })).toBeEnabled();
    expect(screen.getByText(/email verification codes remain available/i)).toBeInTheDocument();
    expect(screen.queryByTestId('recovery-codes-panel')).not.toBeInTheDocument();
  });

  it('keeps the active authenticator when turning it off is declined or fails', async () => {
    vi.mocked(getAuthenticatorEnrollmentStatus).mockResolvedValueOnce(activeStatus);
    vi.mocked(disableAuthenticator).mockRejectedValueOnce(
      new AuthenticatorEnrollmentApiError(
        503,
        'AUTHENTICATOR_ENROLLMENT_UNAVAILABLE',
        'Authenticator enrollment is temporarily unavailable. Please try again later.',
        true
      )
    );
    render(<AuthenticatorEnrollmentCard identityKey="part-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /turn off authenticator app/i }));
    fireEvent.click(screen.getByRole('button', { name: /keep authenticator app/i }));
    expect(disableAuthenticator).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /turn off authenticator app/i }));
    fireEvent.click(screen.getByRole('button', { name: /^turn off authenticator app$/i }));
    expect(await screen.findByTestId('authenticator-enrollment-error')).toHaveTextContent(
      /temporarily unavailable/i
    );
    expect(screen.getByText(/authenticator app is active/i)).toBeInTheDocument();
  });

  it.each(['part-1', 'admin-1'])(
    'replaces the %s authenticator and shows the fresh recovery set exactly once after confirmation',
    async (identity) => {
      vi.mocked(getAuthenticatorEnrollmentStatus).mockResolvedValueOnce(activeStatus);
      vi.mocked(getRecoveryCodeStatus).mockResolvedValue({
        status: 'generated',
        batchId: '30000000-0000-4000-8000-00000000000a',
        total: 10,
        remaining: 10,
        generatedAt: '2026-11-11T18:20:00.000Z',
      });
      vi.mocked(beginAuthenticatorReplacement).mockResolvedValueOnce(replacement);
      vi.mocked(confirmAuthenticatorReplacement).mockResolvedValueOnce({
        authenticator: { status: 'active', activatedAt: '2026-11-11T18:40:00.000Z' },
        recoveryCodes: {
          status: 'generated',
          batchId: '30000000-0000-4000-8000-0000000000ff',
          total: 2,
          remaining: 2,
          generatedAt: '2026-11-11T18:40:00.000Z',
          codes: ['FRES-HCOD-E222', 'FRES-HCOD-E333'],
        },
        availableChallengeMethods: ['authenticator_totp', 'email_otp'],
        emailOtpFallback: true,
      });
      render(<AuthenticatorEnrollmentCard identityKey={identity} />);
      expect(await screen.findByText(/of 10 recovery codes unused/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /replace authenticator app/i }));
      expect(await screen.findByText('NEWDEVICE')).toBeInTheDocument();
      expect(screen.getByTestId('authenticator-replacement-notice')).toHaveTextContent(
        /current app and recovery codes keep working until you confirm/i
      );
      fireEvent.change(screen.getByLabelText(/authenticator code/i), { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: /confirm new authenticator/i }));

      expect(await screen.findByTestId('authenticator-enrollment-notice')).toHaveTextContent(
        /new authenticator app is active.*previous recovery codes no longer work/i
      );
      expect(confirmAuthenticatorReplacement).toHaveBeenCalledWith('replacement_9999', '123456');
      // The plain #268 confirm path is never used for a replacement.
      expect(confirmAuthenticatorEnrollment).not.toHaveBeenCalled();
      expect(screen.queryByText('NEWDEVICE')).not.toBeInTheDocument();

      const list = await screen.findByTestId('recovery-codes-list');
      expect(list).toHaveValue('FRES-HCOD-E222\nFRES-HCOD-E333');
      expect(screen.getByTestId('recovery-codes-replacement-note')).toHaveTextContent(
        /previous recovery codes no longer work/i
      );
      expect(localStorage).toHaveLength(0);
      expect(sessionStorage).toHaveLength(0);

      fireEvent.click(screen.getByRole('button', { name: /i have saved these codes/i }));
      expect(screen.queryByTestId('recovery-codes-list')).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue(/FRES-HCOD/)).not.toBeInTheDocument();
    }
  );

  it('keeps the old recovery set (no fresh codes) when a replacement code is wrong', async () => {
    vi.mocked(getAuthenticatorEnrollmentStatus).mockResolvedValueOnce(activeStatus);
    vi.mocked(beginAuthenticatorReplacement).mockResolvedValueOnce(replacement);
    vi.mocked(confirmAuthenticatorReplacement).mockRejectedValueOnce(
      new AuthenticatorEnrollmentApiError(401, 'INVALID_AUTHENTICATOR_CODE', 'The authenticator code is incorrect or expired.')
    );
    render(<AuthenticatorEnrollmentCard identityKey="part-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /replace authenticator app/i }));
    const input = await screen.findByLabelText(/authenticator code/i);
    fireEvent.change(input, { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm new authenticator/i }));

    expect(await screen.findByTestId('authenticator-enrollment-error')).toHaveTextContent(/incorrect/i);
    expect(input).toHaveValue('654321');
    expect(screen.getByText('NEWDEVICE')).toBeInTheDocument();
    expect(screen.queryByTestId('recovery-codes-list')).not.toBeInTheDocument();
  });

  it('returns to the still-active authenticator when a replacement is cancelled or expires', async () => {
    vi.mocked(getAuthenticatorEnrollmentStatus).mockResolvedValueOnce(activeStatus);
    vi.mocked(beginAuthenticatorReplacement)
      .mockResolvedValueOnce(replacement)
      .mockResolvedValueOnce(replacement);
    vi.mocked(confirmAuthenticatorReplacement).mockRejectedValueOnce(
      new AuthenticatorEnrollmentApiError(
        410,
        'AUTHENTICATOR_ENROLLMENT_EXPIRED',
        'The authenticator enrollment has expired. Start enrollment again.'
      )
    );
    render(<AuthenticatorEnrollmentCard identityKey="part-1" />);

    fireEvent.click(await screen.findByRole('button', { name: /replace authenticator app/i }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel replacement/i }));
    expect(screen.getByTestId('authenticator-enrollment-notice')).toHaveTextContent(
      /current authenticator app is still active/i
    );
    expect(screen.queryByText('NEWDEVICE')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /replace authenticator app/i }));
    fireEvent.change(await screen.findByLabelText(/authenticator code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm new authenticator/i }));
    expect(await screen.findByTestId('authenticator-enrollment-error')).toHaveTextContent(/expired/i);
    expect(screen.getByText(/authenticator app is active/i)).toBeInTheDocument();
    expect(screen.queryByText('NEWDEVICE')).not.toBeInTheDocument();
  });

  it('shows recovery-code controls only while the authenticator is active', async () => {
    const { unmount } = render(<AuthenticatorEnrollmentCard identityKey="part-1" />);
    await screen.findByRole('button', { name: /set up authenticator app/i });
    expect(screen.queryByTestId('recovery-codes-panel')).not.toBeInTheDocument();
    unmount();

    vi.mocked(getAuthenticatorEnrollmentStatus).mockResolvedValueOnce(activeStatus);
    render(<AuthenticatorEnrollmentCard identityKey="admin-1" />);
    expect(await screen.findByTestId('recovery-codes-panel')).toBeInTheDocument();
    expect(await screen.findByTestId('recovery-codes-empty')).toBeInTheDocument();
  });

  it('drops displayed recovery codes on sign-out or account switch (identity change)', async () => {
    vi.mocked(getAuthenticatorEnrollmentStatus).mockResolvedValue(activeStatus);
    vi.mocked(generateRecoveryCodes).mockResolvedValueOnce({
      status: 'generated',
      batchId: '30000000-0000-4000-8000-00000000000a',
      total: 1,
      remaining: 1,
      generatedAt: '2026-11-11T18:20:00.000Z',
      codes: ['SECR-ETCO-DE22'],
    });
    const { rerender } = render(<AuthenticatorEnrollmentCard identityKey="part-1:0" />);
    fireEvent.click(await screen.findByRole('button', { name: /^generate recovery codes$/i }));
    expect(await screen.findByTestId('recovery-codes-list')).toHaveValue('SECR-ETCO-DE22');

    rerender(<AuthenticatorEnrollmentCard identityKey="part-1:1" />);
    await waitFor(() => expect(screen.queryByTestId('recovery-codes-list')).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue(/SECR-ETCO-DE22/)).not.toBeInTheDocument();
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });
});

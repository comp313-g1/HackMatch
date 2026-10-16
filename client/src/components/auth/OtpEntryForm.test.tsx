import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { getIdToken, type User } from 'firebase/auth';
import { OtpEntryForm } from './OtpEntryForm';
import { requestMfaChallenge } from './mfaChallenge';
import { verifyMfaCode } from './mfaVerify';
import { logout } from './logout';
import type { OtpChallenge } from './providerSignIn';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    getIdToken: vi.fn(),
  };
});

vi.mock('./mfaChallenge', () => ({
  requestMfaChallenge: vi.fn(),
}));

vi.mock('./mfaVerify', () => ({
  verifyMfaCode: vi.fn(),
}));

vi.mock('./logout', () => ({
  logout: vi.fn(),
}));

const mockRequestMfaChallenge = vi.mocked(requestMfaChallenge);
const mockVerifyMfaCode = vi.mocked(verifyMfaCode);
const mockGetIdToken = vi.mocked(getIdToken);
const mockLogout = vi.mocked(logout);

const user = { uid: 'fb-uid-1', email: 'jane@example.com' } as User;

const challenge: OtpChallenge = {
  challengeId: 'challenge-abc',
  email: 'j***e@example.com',
  expiresInSeconds: 600,
  message: 'A 6-digit verification code has been sent to your email.',
};

const renderForm = (props?: Partial<ComponentProps<typeof OtpEntryForm>>) => {
  const onVerified = vi.fn();
  const onSignedOut = vi.fn();
  render(
    <OtpEntryForm
      user={user}
      initialChallenge={challenge}
      onVerified={onVerified}
      onSignedOut={onSignedOut}
      {...props}
    />
  );
  return { onVerified, onSignedOut };
};

describe('OtpEntryForm (US-004 S1-P1-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetIdToken.mockResolvedValue('fresh-token');
    mockLogout.mockResolvedValue(undefined);
    mockRequestMfaChallenge.mockResolvedValue({
      requiresOtp: true,
      challengeId: 'challenge-resend',
      email: 'j***e@example.com',
      expiresInSeconds: 600,
      message: 'A new code has been sent.',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loading: requests a challenge when none is provided', async () => {
    mockRequestMfaChallenge.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                requiresOtp: true,
                challengeId: 'challenge-boot',
                email: 'j***e@example.com',
                expiresInSeconds: 600,
                message: 'sent',
              }),
            50
          );
        })
    );

    renderForm({ initialChallenge: null });

    expect(screen.getByRole('status')).toHaveTextContent(/sending a verification code/i);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(await screen.findByLabelText(/6-digit code/i)).toBeInTheDocument();
    expect(mockRequestMfaChallenge).toHaveBeenCalledWith(user);
  });

  it('empty: shows helper text and validates blank submit', async () => {
    renderForm();

    expect(screen.getByText(/enter the code from your email/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/enter the 6-digit verification code/i);
    expect(mockVerifyMfaCode).not.toHaveBeenCalled();
  });

  it('validation: rejects non-6-digit input on submit', async () => {
    renderForm();

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '12ab' } });
    expect(screen.getByLabelText(/6-digit code/i)).toHaveValue('12');

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/enter the 6-digit verification code/i);
    expect(mockVerifyMfaCode).not.toHaveBeenCalled();
  });

  it('happy path: verifies a valid code, refreshes the token, and reports success', async () => {
    mockVerifyMfaCode.mockResolvedValueOnce({
      verified: true,
      message: 'ok',
    });
    const { onVerified } = renderForm();

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/code accepted/i);
    expect(mockVerifyMfaCode).toHaveBeenCalledWith(user, 'challenge-abc', '123456');
    expect(mockGetIdToken).toHaveBeenCalledWith(user, true);
    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  it('loading while submitting: disables controls and shows verifying label', async () => {
    let resolveVerify: (value: { verified: true; message: string }) => void = () => {};
    mockVerifyMfaCode.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveVerify = resolve;
      })
    );
    renderForm();

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    const verifying = await screen.findByRole('button', { name: /verifying/i });
    expect(verifying).toBeDisabled();
    expect(verifying).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText(/6-digit code/i)).toBeDisabled();

    await act(async () => {
      resolveVerify({ verified: true, message: 'ok' });
    });

    expect(await screen.findByText(/code accepted/i)).toBeInTheDocument();
  });

  it('error: shows server failure for invalid OTP (unauthorized / wrong code)', async () => {
    mockVerifyMfaCode.mockRejectedValueOnce(
      Object.assign(new Error('Invalid verification code.'), { code: 'INVALID_OTP' })
    );
    renderForm();

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid verification code/i);
    expect(screen.getByLabelText(/6-digit code/i)).toHaveValue('');
    expect(screen.queryByText(/code accepted/i)).not.toBeInTheDocument();
  });

  it('error: surfaces unauthorized / auth failure from verify', async () => {
    mockVerifyMfaCode.mockRejectedValueOnce(
      Object.assign(new Error('Authentication required.'), { code: 'UNAUTHORIZED' })
    );
    renderForm();

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '111111' } });
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/authentication required/i);
  });

  it('expiry: disables submit when the countdown reaches zero and prompts resend', async () => {
    renderForm({
      initialChallenge: { ...challenge, expiresInSeconds: 2 },
    });

    expect(screen.getByText(/code expires in/i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/this code has expired/i);
    expect(screen.getByRole('button', { name: /verify code/i })).toBeDisabled();
    expect(screen.getByLabelText(/6-digit code/i)).toBeDisabled();
  });

  it('resend: requests a new challenge and starts a cooldown', async () => {
    renderForm({
      initialChallenge: { ...challenge, expiresInSeconds: 1 },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: /resend code/i }));

    await waitFor(() => expect(mockRequestMfaChallenge).toHaveBeenCalledWith(user));
    expect(await screen.findByRole('button', { name: /resend code \(60s\)/i })).toBeDisabled();
    expect(screen.getByText(/code expires in/i)).toBeInTheDocument();
  });

  it('resend: replaces predecessor challengeId so verify uses only the new challenge (AC 5)', async () => {
    mockRequestMfaChallenge.mockResolvedValueOnce({
      requiresOtp: true,
      challengeId: 'challenge-resend',
      email: 'j***e@example.com',
      expiresInSeconds: 600,
      message: 'A new code has been sent.',
    });
    mockVerifyMfaCode.mockResolvedValueOnce({ verified: true, message: 'ok' });
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: /resend code/i }));
    await waitFor(() => expect(mockRequestMfaChallenge).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    await waitFor(() =>
      expect(mockVerifyMfaCode).toHaveBeenCalledWith(user, 'challenge-resend', '654321')
    );
    expect(mockVerifyMfaCode).not.toHaveBeenCalledWith(user, 'challenge-abc', expect.anything());
  });

  it('resend failure: shows error and applies rate-limit cooldown', async () => {
    mockRequestMfaChallenge.mockRejectedValueOnce(
      Object.assign(new Error('Too many requests. Try again later.'), { code: 'RATE_LIMITED' })
    );
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: /resend code/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many requests/i);
    expect(screen.getByRole('button', { name: /resend code \(60s\)/i })).toBeDisabled();
  });

  it('boundary: accepts exactly 6 digits and strips non-digits beyond maxLength', () => {
    renderForm();
    const input = screen.getByLabelText(/6-digit code/i);

    fireEvent.change(input, { target: { value: '1234567' } });
    expect(input).toHaveValue('123456');

    fireEvent.change(input, { target: { value: '12-34-56' } });
    expect(input).toHaveValue('123456');
  });

  it('bootstrap failure: shows error when initial challenge cannot be sent', async () => {
    mockRequestMfaChallenge.mockRejectedValueOnce(
      Object.assign(new Error('Failed to send verification code.'), {
        code: 'MFA_STORE_UNAVAILABLE',
      })
    );

    renderForm({ initialChallenge: null });

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to send verification code/i);
  });

  it('sign out: calls logout and notifies the parent', async () => {
    const { onSignedOut } = renderForm();

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(mockLogout).toHaveBeenCalledWith(user));
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('lockout: fifth failure disables verify/resend and shows countdown (FR-010)', async () => {
    mockVerifyMfaCode.mockRejectedValueOnce(
      Object.assign(new Error('Account temporarily locked.'), {
        code: 'ACCOUNT_LOCKED',
        retryAfter: 900,
      })
    );
    renderForm();

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    expect(await screen.findByText(/account locked/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify code/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /locked/i })).toBeDisabled();
    expect(screen.getByLabelText(/6-digit code/i)).toBeDisabled();
  });

  it('lockout: resend while locked surfaces ACCOUNT_LOCKED and blocks further sends', async () => {
    mockRequestMfaChallenge.mockRejectedValueOnce(
      Object.assign(new Error('Account temporarily locked.'), {
        code: 'ACCOUNT_LOCKED',
        retryAfter: 600,
      })
    );
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: /resend code/i }));

    expect(await screen.findByText(/account locked/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /locked/i })).toBeDisabled();
  });
});

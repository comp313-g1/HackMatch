/**
 * US-005 password-recovery integration tests (React / S1-P3-05).
 *
 * Covers recovery request + reset-form flows with fetch + helpers mocked at the network
 * boundary. Maps to US-005-T1 … US-005-T5 user-visible outcomes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PasswordRecoveryRequestForm } from './PasswordRecoveryRequestForm';
import { PasswordResetForm } from './PasswordResetForm';
import { GENERIC_PASSWORD_RECOVERY_CONFIRMATION } from './passwordRecoveryRequest';
import { PASSWORD_POLICY_MESSAGE } from './validation';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    signOut: vi.fn().mockResolvedValue(undefined),
  };
});

const fillRecoveryEmail = (value: string) => {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value } });
};

const fillNewPasswords = (password: string, confirm = password) => {
  fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), {
    target: { value: confirm },
  });
};

describe('US-005 password recovery integration (React)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('US-005-T1: recovery request page', () => {
    it('happy path: known or unknown email shows the same generic confirmation', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ message: GENERIC_PASSWORD_RECOVERY_CONFIRMATION }),
      });

      render(<PasswordRecoveryRequestForm />);
      fillRecoveryEmail('jane@example.com');
      fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

      const status = await screen.findByRole('status');
      expect(status).toHaveTextContent(GENERIC_PASSWORD_RECOVERY_CONFIRMATION);
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/password-reset',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'jane@example.com' }),
        })
      );
    });

    it('invalid input: keeps typed email on validation failure', async () => {
      render(<PasswordRecoveryRequestForm />);
      fillRecoveryEmail('not-an-email');
      fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/i);
      expect(screen.getByLabelText(/email address/i)).toHaveValue('not-an-email');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('failure handling: rate limit keeps email and shows retry guidance', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          error: 'Too many requests.',
          code: 'RATE_LIMITED',
          retryAfter: 60,
        }),
      });

      render(<PasswordRecoveryRequestForm />);
      fillRecoveryEmail('jane@example.com');
      fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/too many/i);
      expect(screen.getByLabelText(/email address/i)).toHaveValue('jane@example.com');
    });
  });

  describe('US-005-T2: valid reset link + compliant password', () => {
    it('happy path: validate → form → confirm → success without auto-login', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            state: 'valid',
            email: 'jane@example.com',
            accountType: 'credential',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            message: 'Password updated.',
            signedIn: false,
            sessionIssued: false,
            requiresMfa: true,
            email: 'jane@example.com',
          }),
        });

      const onNavigateToSignIn = vi.fn();
      render(
        <PasswordResetForm
          actionCode="fresh-oob"
          mode="resetPassword"
          onNavigateToSignIn={onNavigateToSignIn}
        />
      );

      expect(await screen.findByText(/jane@example.com/i)).toBeInTheDocument();
      fillNewPasswords('Valid1@Password');
      fireEvent.click(screen.getByRole('button', { name: /update password/i }));

      expect(await screen.findByRole('status')).toHaveTextContent(/password updated/i);
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/auth/password-reset/confirm',
        expect.objectContaining({
          body: JSON.stringify({
            oobCode: 'fresh-oob',
            newPassword: 'Valid1@Password',
            confirmPassword: 'Valid1@Password',
          }),
        })
      );

      fireEvent.click(screen.getByRole('button', { name: /continue to sign in/i }));
      expect(onNavigateToSignIn).toHaveBeenCalled();
    });

    it('invalid input: policy failure preserves entered passwords', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          state: 'valid',
          email: 'jane@example.com',
          accountType: 'credential',
        }),
      });

      render(<PasswordResetForm actionCode="fresh-oob" mode="resetPassword" />);
      await screen.findByLabelText(/^new password$/i);
      fillNewPasswords('weak');
      fireEvent.click(screen.getByRole('button', { name: /update password/i }));

      expect(await screen.findByText(PASSWORD_POLICY_MESSAGE)).toBeInTheDocument();
      expect(screen.getByLabelText(/^new password$/i)).toHaveValue('weak');
      expect(fetchMock).toHaveBeenCalledTimes(1); // validate only
    });
  });

  describe('US-005-T3: expired, invalid, and used link states', () => {
    it.each([
      {
        label: 'expired',
        body: {
          code: 'EXPIRED_ACTION_CODE',
          state: 'expired',
          error: 'This password reset link has expired.',
        },
        heading: /reset link expired/i,
      },
      {
        label: 'invalid',
        body: {
          code: 'INVALID_ACTION_CODE',
          state: 'invalid',
          error: 'This password reset link is invalid or has been tampered with.',
        },
        heading: /reset link invalid/i,
      },
      {
        label: 'used',
        body: {
          code: 'USED_ACTION_CODE',
          state: 'used',
          error: 'This password reset link has already been used.',
        },
        heading: /reset link already used/i,
      },
    ])('$label link shows distinct error and no password form', async ({ body, heading }) => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => body,
      });

      render(
        <PasswordResetForm
          actionCode={`${body.state}-oob`}
          mode="resetPassword"
          onNavigateToRecover={vi.fn()}
        />
      );

      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
      expect(screen.queryByLabelText(/^new password$/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /request a new reset link/i })).toBeInTheDocument();
    });
  });

  describe('US-005-T4: success copy requires MFA / no auto-login', () => {
    it('success state tells the user OTP is still required', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            state: 'valid',
            email: 'jane@example.com',
            accountType: 'credential',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            signedIn: false,
            sessionIssued: false,
            requiresMfa: true,
          }),
        });

      render(<PasswordResetForm actionCode="mfa-oob" mode="resetPassword" />);
      await screen.findByLabelText(/^new password$/i);
      fillNewPasswords('Valid1@Password');
      fireEvent.click(screen.getByRole('button', { name: /update password/i }));

      const status = await screen.findByRole('status');
      expect(status).toHaveTextContent(/otp|email verification/i);
      expect(status).toHaveTextContent(/password updated/i);
    });
  });

  describe('US-005-T5: OAuth recovery state', () => {
    it('shows provider recovery guidance without a password form', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          state: 'oauth',
          code: 'OAUTH_RECOVERY_REQUIRED',
          email: 'oauth@example.com',
          message: 'This account signs in with Google or GitHub.',
        }),
      });

      const onNavigateToSignIn = vi.fn();
      render(
        <PasswordResetForm
          actionCode="oauth-oob"
          mode="resetPassword"
          onNavigateToSignIn={onNavigateToSignIn}
        />
      );

      expect(
        await screen.findByRole('heading', { name: /use your sign-in provider/i })
      ).toBeInTheDocument();
      expect(screen.queryByLabelText(/^new password$/i)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /sign in with google or github/i }));
      expect(onNavigateToSignIn).toHaveBeenCalled();
    });
  });

  describe('App routing hand-off (boundary)', () => {
    it('empty reset URL shows reset-link-required without calling validate', async () => {
      render(<PasswordResetForm actionCode={null} mode="resetPassword" />);

      expect(await screen.findByRole('heading', { name: /reset link required/i })).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
